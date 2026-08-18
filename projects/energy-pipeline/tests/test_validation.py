"""Validation tests for the energy market analytical layer."""
from pathlib import Path

import pandas as pd
import pytest

PROCESSED = Path(__file__).resolve().parents[1] / "data" / "processed" / "energy_market.csv"


@pytest.fixture
def df() -> pd.DataFrame:
    if not PROCESSED.exists():
        pytest.skip("Run pipeline.py first to generate energy_market.csv")
    return pd.read_csv(PROCESSED, parse_dates=["date"])


def test_usd_pln_positive(df: pd.DataFrame) -> None:
    assert df["usd_pln"].dropna().gt(0).all()


def test_brent_positive(df: pd.DataFrame) -> None:
    assert df["brent_usd"].dropna().gt(0).all()


def test_dates_unique(df: pd.DataFrame) -> None:
    assert not df["date"].duplicated().any()


def test_brent_pln_l_sane(df: pd.DataFrame) -> None:
    subset = df.dropna(subset=["brent_pln_l"])
    assert subset["brent_pln_l"].between(0.1, 20).all()
