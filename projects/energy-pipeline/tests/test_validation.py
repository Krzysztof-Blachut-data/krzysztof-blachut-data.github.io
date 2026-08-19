"""Tests for energy_market.csv / energy_market_daily.csv."""
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]

# avoid colliding with ecom-cleaning's config.py / pipeline.py when pytest runs from repo root
sys.path.insert(0, str(ROOT))
for _shadowed in ("config", "pipeline"):
    sys.modules.pop(_shadowed, None)

from config import LITRE_PER_BBL  # noqa: E402

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "processed"
PROCESSED = DATA_DIR / "energy_market.csv"
DAILY = DATA_DIR / "energy_market_daily.csv"


@pytest.fixture
def df() -> pd.DataFrame:
    if not PROCESSED.exists():
        pytest.skip("Run pipeline.py first to generate energy_market.csv")
    return pd.read_csv(PROCESSED, parse_dates=["date"])


# --- structural ---------------------------------------------------------------

def test_dates_unique(df: pd.DataFrame) -> None:
    assert not df["date"].duplicated().any()


def test_one_row_per_month(df: pd.DataFrame) -> None:
    periods = df["date"].dt.to_period("M")
    assert not periods.duplicated().any()
    # no gaps in the monthly series
    expected = pd.period_range(periods.min(), periods.max(), freq="M")
    assert len(expected) == len(periods), f"missing months: {set(expected) - set(periods)}"


def test_all_dates_are_month_start(df: pd.DataFrame) -> None:
    assert (df["date"].dt.day == 1).all()


# --- positivity ---------------------------------------------------------------

def test_usd_pln_positive(df: pd.DataFrame) -> None:
    assert df["usd_pln"].dropna().gt(0).all()


def test_eur_pln_positive(df: pd.DataFrame) -> None:
    assert df["eur_pln"].dropna().gt(0).all()


def test_brent_positive(df: pd.DataFrame) -> None:
    assert df["brent_usd"].dropna().gt(0).all()


# --- FX sanity ----------------------------------------------------------------

def test_eur_pln_in_plausible_band(df: pd.DataFrame) -> None:
    """EUR/PLN has stayed between 3.5 and 5.5 for the covered period."""
    rates = df["eur_pln"].dropna()
    assert rates.between(3.5, 5.5).all(), f"out of band: {rates[~rates.between(3.5, 5.5)].tolist()}"


def test_usd_pln_in_plausible_band(df: pd.DataFrame) -> None:
    """USD/PLN has stayed between 3.0 and 5.2 for the covered period."""
    rates = df["usd_pln"].dropna()
    assert rates.between(3.0, 5.2).all(), f"out of band: {rates[~rates.between(3.0, 5.2)].tolist()}"


def test_eur_usd_cross_rate_plausible(df: pd.DataFrame) -> None:
    """Implied EUR/USD in band (parity break allowed)."""
    both = df.dropna(subset=["eur_pln", "usd_pln"])
    cross = both["eur_pln"] / both["usd_pln"]
    assert cross.between(0.9, 1.35).all(), f"implied EUR/USD out of band: {cross.min():.3f}–{cross.max():.3f}"


# --- unit-conversion correctness ----------------------------------------------

def test_barrel_conversion_consistent(df: pd.DataFrame) -> None:
    both = df.dropna(subset=["brent_pln_bbl", "brent_pln_l"])
    expected = both["brent_pln_bbl"] / LITRE_PER_BBL
    assert (both["brent_pln_l"] - expected).abs().max() < 1e-9


def test_brent_pln_l_sane(df: pd.DataFrame) -> None:
    assert df["brent_pln_l"].dropna().between(0.1, 20).all()


def test_pump_price_converted_with_eur_rate(df: pd.DataFrame) -> None:
    """pb95_pln_l = pb95_eur_l * eur_pln."""
    both = df.dropna(subset=["pb95_eur_l", "eur_pln", "pb95_pln_l"])
    expected = both["pb95_eur_l"] * both["eur_pln"]
    assert (both["pb95_pln_l"] - expected).abs().max() < 1e-9


def test_spread_is_same_currency_subtraction(df: pd.DataFrame) -> None:
    """spread = pb95_pln_l - brent_pln_l."""
    both = df.dropna(subset=["pb95_pln_l", "brent_pln_l", "spread_retail_vs_crude"])
    expected = both["pb95_pln_l"] - both["brent_pln_l"]
    assert (both["spread_retail_vs_crude"] - expected).abs().max() < 1e-9


# --- economic plausibility ----------------------------------------------------

def test_gross_spread_positive(df: pd.DataFrame) -> None:
    """Gross spread always positive."""
    spread = df["spread_retail_vs_crude"].dropna()
    assert spread.gt(0).all(), f"non-positive spreads at rows: {spread[spread <= 0].index.tolist()}"


def test_gross_spread_in_plausible_band(df: pd.DataFrame) -> None:
    """Gross spread in 1.5–6 PLN/l."""
    assert df["spread_retail_vs_crude"].dropna().between(1.5, 6.0).all()


def test_net_spread_below_gross(df: pd.DataFrame) -> None:
    """Net spread < gross."""
    both = df.dropna(subset=["spread_net_vs_crude", "spread_retail_vs_crude"])
    if both.empty:
        pytest.skip("no net-price observations in the dataset")
    assert (both["spread_net_vs_crude"] < both["spread_retail_vs_crude"]).all()


def test_pump_price_above_crude(df: pd.DataFrame) -> None:
    both = df.dropna(subset=["pb95_pln_l", "brent_pln_l"])
    assert (both["pb95_pln_l"] > both["brent_pln_l"]).all()


# --- provenance ---------------------------------------------------------------

REAL_CRUDE_SOURCES = {"eia_api", "eia_public_xls"}
ALL_CRUDE_SOURCES = REAL_CRUDE_SOURCES | {"reference_fallback"}


def test_crude_source_recorded(df: pd.DataFrame) -> None:
    assert "crude_source" in df.columns
    assert df["crude_source"].notna().all()
    assert set(df["crude_source"].unique()) <= ALL_CRUDE_SOURCES


def test_reference_fallback_is_not_presented_as_real() -> None:
    """Real EIA has many distinct prices."""
    if not PROCESSED.exists():
        pytest.skip("Run pipeline.py first")
    data = pd.read_csv(PROCESSED)
    distinct = data["brent_usd"].dropna().nunique()
    source = set(data.get("crude_source", pd.Series(dtype=str)).dropna().unique())
    if source & REAL_CRUDE_SOURCES:
        assert distinct >= len(data) * 0.5, (
            f"crude_source claims {source} but brent_usd has only {distinct} distinct "
            f"values across {len(data)} months — that is reference data, not market data"
        )


def test_real_crude_spans_a_plausible_range(df: pd.DataFrame) -> None:
    """2020 low and 2022 spike present."""
    if not (set(df["crude_source"].unique()) & REAL_CRUDE_SOURCES):
        pytest.skip("crude series is reference data")
    assert df["brent_usd"].min() < 40, "no sign of the 2020 price collapse"
    assert df["brent_usd"].max() > 100, "no sign of the 2022 price spike"


# --- daily layer --------------------------------------------------------------

@pytest.fixture
def daily() -> pd.DataFrame:
    if not DAILY.exists():
        pytest.skip("Run pipeline.py first to generate energy_market_daily.csv")
    return pd.read_csv(DAILY, parse_dates=["date"])


def test_daily_dates_unique(daily: pd.DataFrame) -> None:
    assert not daily["date"].duplicated().any()


def test_daily_has_no_missing_crude_or_fx(daily: pd.DataFrame) -> None:
    assert not daily[["brent_usd", "usd_pln", "brent_pln_l"]].isna().any().any()


def test_daily_is_actually_daily(daily: pd.DataFrame) -> None:
    """Looks like a daily series."""
    per_month = daily.groupby(daily["date"].dt.to_period("M")).size()
    assert per_month.median() > 15, "fewer than ~15 quotes a month is not a daily series"
    assert (daily["date"].dt.day.nunique() > 20), "quotes cluster on too few days of the month"


def test_daily_carries_more_variation_than_monthly(
    daily: pd.DataFrame, df: pd.DataFrame
) -> None:
    """Daily extremes >= monthly."""
    assert daily["brent_usd"].min() <= df["brent_usd"].min() + 1e-6
    assert daily["brent_usd"].max() >= df["brent_usd"].max() - 1e-6


def test_daily_barrel_conversion(daily: pd.DataFrame) -> None:
    expected = daily["brent_usd"] * daily["usd_pln"] / LITRE_PER_BBL
    assert (daily["brent_pln_l"] - expected).abs().max() < 1e-6


def test_daily_fx_is_never_dated_after_the_quote(daily: pd.DataFrame) -> None:
    """FX firsts fall on weekdays."""
    firsts = daily.groupby("usd_pln")["date"].min()
    assert (firsts.dt.dayofweek < 5).all(), "an FX fixing first appears on a weekend"


def test_daily_has_no_pump_prices(daily: pd.DataFrame) -> None:
    """No Pb95/spread on daily."""
    forbidden = {"pb95_pln_l", "pb95_eur_l", "spread_retail_vs_crude", "spread_net_vs_crude"}
    assert not forbidden & set(daily.columns), "daily layer should not carry retail/spread cols"


def test_negative_wti_print_is_preserved(daily: pd.DataFrame) -> None:
    """Apr 2020 negative WTI kept."""
    window = daily[(daily["date"] >= "2020-04-01") & (daily["date"] <= "2020-04-30")]
    if window.empty or window["wti_usd"].isna().all():
        pytest.skip("April 2020 not covered by the daily window")
    assert window["wti_usd"].min() < 0, (
        "no negative WTI quote in April 2020 — the print was probably filtered out"
    )


def test_daily_moving_average_smooths(daily: pd.DataFrame) -> None:
    ma = daily["brent_pln_l_ma30"].dropna()
    assert len(ma) > 0
    assert ma.std() < daily["brent_pln_l"].std(), "the 30-quote average is not smoothing"
