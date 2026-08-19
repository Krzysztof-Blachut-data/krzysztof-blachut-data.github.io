#!/usr/bin/env python3
"""From Barrel to Pump — ETL for oil/fuel prices in Poland.

Sources: EIA (Brent/WTI), NBP (FX), EC Oil Bulletin (Pb95/diesel).
Output: SQLite + energy_market.csv (+ daily layer).

    python pipeline.py
    python pipeline.py --date 2026-08-18
"""
from __future__ import annotations

import argparse
import io
import json
import logging
import os
import sqlite3
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    import pandas as pd
    import requests
except ImportError as exc:
    sys.stderr.write(
        "Brak bibliotek (%s).\n"
        "W PowerShell:\n"
        "  cd projects\\energy-pipeline\n"
        "  pip install -r requirements.txt\n"
        "  python pipeline.py\n" % exc
    )
    sys.exit(1)

from config import (
    DATA,
    DATABASE,
    EIA_PUBLIC_BASE,
    EIA_PUBLIC_XLS,
    EIA_SERIES,
    EU_FUEL_BULLETIN_EDITION,
    EU_FUEL_WITH_TAX_URL,
    EU_FUEL_NO_TAX_URL,
    LITRE_PER_BBL,
    NBP_CURRENCIES,
    NBP_TABLE,
    PROCESSED,
    RAW,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("energy-pipeline")

EIA_API_KEY = os.environ.get("EIA_API_KEY", "")
EIA_BASE = "https://api.eia.gov/v2/petroleum/pri/spt/data/"
NBP_BASE = f"https://api.nbp.pl/api/exchangerates/rates/{NBP_TABLE.lower()}/"


def ensure_dirs() -> None:
    for sub in ("eia", "nbp", "eu_fuel"):
        (RAW / sub).mkdir(parents=True, exist_ok=True)
    PROCESSED.mkdir(parents=True, exist_ok=True)
    DATABASE.mkdir(parents=True, exist_ok=True)


def save_raw(source: str, payload: Any, run_date: str) -> Path:
    path = RAW / source / f"{run_date}.json"
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2, default=str)
    logger.info("RAW saved: %s", path.relative_to(DATA.parent))
    return path


def fetch_eia(facet: str, start: str, end: str, frequency: str = "monthly") -> dict[str, Any]:
    """API key -> public XLS workbook -> offline reference anchors."""
    if EIA_API_KEY:
        url = (
            f"{EIA_BASE}?api_key={EIA_API_KEY}&frequency={frequency}&data[0]=value"
            f"&facets[series][]={facet}&start={start}&end={end}"
            f"&sort[0][column]=period&sort[0][direction]=asc&length=5000"
        )
        try:
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            payload = response.json()
            payload["source"] = "eia_api"
            logger.info("EIA API: %s %s fetched with key", facet, frequency)
            return payload
        except requests.RequestException as exc:
            logger.warning("EIA API failed for %s (%s) — trying keyless workbook", facet, exc)
    else:
        logger.info("EIA_API_KEY not set — using EIA's public %s workbook for %s",
                    frequency, facet)

    public = fetch_eia_public(facet, frequency)
    if public:
        return {"source": "eia_public_xls", "series": facet, "data": public}

    logger.warning(
        "No real EIA series available for %s — falling back to reference anchors. "
        "This output is NOT market data.", facet,
    )
    return {"source": "reference_fallback", "series": facet, "data": fallback_eia_monthly(facet)}


def fetch_eia_public(facet: str, frequency: str = "monthly") -> list[dict[str, Any]]:
    """Official EIA spot series from the public hist_xls workbooks (no key)."""
    workbook = EIA_PUBLIC_XLS.get(frequency, {}).get(facet)
    if not workbook:
        return []
    fmt = "%Y-%m-%d" if frequency == "daily" else "%Y-%m"
    url = f"{EIA_PUBLIC_BASE}{workbook}.xls"
    try:
        response = requests.get(url, timeout=60)
        response.raise_for_status()
        # sheet "Data 1", first two rows are headers/notes
        frame = pd.read_excel(io.BytesIO(response.content), sheet_name="Data 1", skiprows=2)
        frame.columns = ["period", "value"]
        frame = frame.dropna()
        rows = [
            {"period": pd.Timestamp(row.period).strftime(fmt), "value": float(row.value)}
            for row in frame.itertuples(index=False)
        ]
        logger.info("EIA public workbook %s: %s → %d %s observations",
                    workbook, facet, len(rows), frequency)
        return rows
    except Exception as exc:  # noqa: BLE001 - any parse/network problem must fall through
        logger.warning("EIA public workbook failed for %s (%s): %s", facet, frequency, exc)
        return []


def fallback_eia_monthly(facet: str) -> list[dict[str, Any]]:
    """Offline placeholders so the pipeline still runs. Not market data."""
    anchors = {
        "RBRTE": {2018: 71, 2020: 42, 2022: 100, 2024: 80, 2025: 68},
        "RWTC": {2018: 65, 2020: 39, 2022: 95, 2024: 75, 2025: 63},
    }
    base = anchors.get(facet, anchors["RBRTE"])
    years = sorted(base.keys())
    rows: list[dict[str, Any]] = []
    for year in range(2018, date.today().year + 1):
        for month in range(1, 13):
            if year == date.today().year and month > date.today().month:
                break
            val = base[years[0]]
            for y in years:
                if y <= year:
                    val = base[y]
            rows.append({"period": f"{year}-{month:02d}", "value": float(val)})
    return rows


def _eia_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    if isinstance(payload.get("data"), list) and payload["data"] and "period" in payload["data"][0]:
        return payload["data"]
    return (payload.get("response") or {}).get("data") or []


def eia_to_monthly(payload: dict[str, Any], col: str) -> pd.DataFrame:
    rows = _eia_rows(payload)
    if not rows:
        return pd.DataFrame(columns=["date", col])
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["period"].str[:7] + "-01")
    df[col] = pd.to_numeric(df["value"], errors="coerce")
    return df.groupby("date", as_index=False)[col].mean()


def eia_to_daily(payload: dict[str, Any], col: str) -> pd.DataFrame:
    """Daily quotes only. Monthly payloads are skipped (no fake daily points)."""
    rows = _eia_rows(payload)
    if not rows:
        return pd.DataFrame(columns=["date", col])
    df = pd.DataFrame(rows)
    if not df["period"].astype(str).str.match(r"^\d{4}-\d{2}-\d{2}").all():
        logger.warning("Daily layer: %s payload is not daily — skipping", col)
        return pd.DataFrame(columns=["date", col])
    df["date"] = pd.to_datetime(df["period"])
    df[col] = pd.to_numeric(df["value"], errors="coerce")
    return df.groupby("date", as_index=False)[col].mean()


def fetch_nbp(currency: str, start: date, end: date, retries: int = 2) -> dict[str, Any]:
    """One NBP window with retries."""
    url = f"{NBP_BASE}{currency}/{start.isoformat()}/{end.isoformat()}/?format=json"
    last_exc: Exception | None = None
    for attempt in range(retries + 1):
        try:
            response = requests.get(url, headers={"Accept": "application/json"}, timeout=30)
            # 404 = no fixings in that window (holidays only)
            if response.status_code == 404:
                logger.warning("NBP: no rates for %s %s..%s", currency, start, end)
                return {"rates": []}
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            last_exc = exc
            logger.warning(
                "NBP request failed (%s %s..%s, attempt %d/%d): %s",
                currency, start, end, attempt + 1, retries + 1, exc,
            )
    logger.error("NBP API unavailable for %s %s..%s: %s", currency, start, end, last_exc)
    raise RuntimeError(f"NBP API unavailable for {currency}") from last_exc


def nbp_to_daily(payload: dict[str, Any], col: str) -> pd.DataFrame:
    """One row per NBP publication day."""
    rates = payload.get("rates") or []
    rows = [{"date": pd.to_datetime(r["effectiveDate"]), col: float(r["mid"])} for r in rates]
    if not rows:
        return pd.DataFrame(columns=["date", col])
    return pd.DataFrame(rows)


def fetch_nbp_history(
    currency: str, col: str, start_year: int = 2018
) -> tuple[pd.DataFrame, pd.DataFrame, list[dict]]:
    """Daily fixings + monthly averages from the same NBP download."""
    chunks: list[pd.DataFrame] = []
    raw_payloads: list[dict] = []
    start = date(start_year, 1, 1)
    end_limit = date.today()
    while start < end_limit:
        # NBP max window is 367 days
        chunk_end = min(start + timedelta(days=366), end_limit)
        payload = fetch_nbp(currency, start, chunk_end)
        raw_payloads.append(payload)
        chunks.append(nbp_to_daily(payload, col))
        start = chunk_end + timedelta(days=1)
    empty = pd.DataFrame(columns=["date", col])
    if not chunks:
        return empty, empty, raw_payloads
    daily = (pd.concat(chunks, ignore_index=True)
             .drop_duplicates("date")
             .sort_values("date")
             .reset_index(drop=True))
    monthly = (daily.assign(date=daily["date"].values.astype("datetime64[M]"))
               .groupby("date", as_index=False)[col].mean())
    return daily, monthly, raw_payloads


def _fetch_ec_bulletin(url: str) -> pd.Series:
    """Download EC Oil Bulletin XLSX and return Poland row."""
    import io

    response = requests.get(url, timeout=60)
    response.raise_for_status()
    xls = pd.read_excel(io.BytesIO(response.content), header=None)
    poland = xls[xls.iloc[:, 0].astype(str).str.lower() == "poland"]
    if poland.empty:
        raise ValueError("Poland row not found in EC bulletin")
    return poland.iloc[0]


def fetch_eu_fuel_poland() -> dict[str, Any]:
    """Fetch both gross (with-tax) and net (without-tax) pump prices for Poland."""
    try:
        row_gross = _fetch_ec_bulletin(EU_FUEL_WITH_TAX_URL)
        row_net = _fetch_ec_bulletin(EU_FUEL_NO_TAX_URL)
        return {
            "source": "ec_weekly_oil_bulletin",
            "country": "Poland",
            # gross (with taxes) — what driver pays at the pump
            "pb95_eur_per_1000l": float(row_gross.iloc[1]),
            "diesel_eur_per_1000l": float(row_gross.iloc[2]),
            # net (without taxes) — reflects actual fuel cost
            "pb95_net_eur_per_1000l": float(row_net.iloc[1]),
            "diesel_net_eur_per_1000l": float(row_net.iloc[2]),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        logger.error("EU fuel download failed: %s", exc)
        return {
            "source": "fallback",
            "country": "Poland",
            "pb95_eur_per_1000l": 1696.0,
            "diesel_eur_per_1000l": 1864.0,
            "pb95_net_eur_per_1000l": 1481.0,
            "diesel_net_eur_per_1000l": 1686.0,
            "error": str(exc),
        }


def load_fuel_history() -> pd.DataFrame:
    """Load bundled monthly fuel history (from fuel-prices.eu / EC bulletin)."""
    hist_path = PROCESSED / "fuel_poland_monthly.csv"
    if hist_path.exists():
        df = pd.read_csv(hist_path, parse_dates=["date"])
        return df
    return pd.DataFrame()


def transform(
    brent: pd.DataFrame,
    wti: pd.DataFrame,
    usd_pln: pd.DataFrame,
    eur_pln: pd.DataFrame,
    fuel: pd.DataFrame,
    eia_source: str = "unknown",
) -> pd.DataFrame:
    df = brent.merge(wti, on="date", how="outer")
    df = df.merge(usd_pln, on="date", how="left")
    df = df.merge(eur_pln, on="date", how="left")
    if not fuel.empty:
        df = df.merge(fuel, on="date", how="outer")

    df = df.sort_values("date").reset_index(drop=True)

    # drop months with no crude yet (EIA lag)
    missing_crude = int(df["brent_usd"].isna().sum())
    if missing_crude:
        logger.info("Trimming %d month(s) with no crude quote yet", missing_crude)
        df = df.dropna(subset=["brent_usd"]).reset_index(drop=True)

    # USD/bbl -> PLN/l
    df["brent_pln_bbl"] = df["brent_usd"] * df["usd_pln"]
    df["brent_pln_l"] = df["brent_pln_bbl"] / LITRE_PER_BBL

    # pump price is EUR/l -> PLN/l so the spread is same-currency
    if "pb95_eur_l" in df.columns:
        df["pb95_pln_l"] = df["pb95_eur_l"] * df["eur_pln"]
        # taxes + margin
        df["spread_retail_vs_crude"] = df["pb95_pln_l"] - df["brent_pln_l"]
    if "diesel_eur_l" in df.columns:
        df["diesel_pln_l"] = df["diesel_eur_l"] * df["eur_pln"]
    if "pb95_net_eur_l" in df.columns:
        df["pb95_net_pln_l"] = df["pb95_net_eur_l"] * df["eur_pln"]
        # without taxes
        df["spread_net_vs_crude"] = df["pb95_net_pln_l"] - df["brent_pln_l"]

    df["brent_usd_mom_pct"] = df["brent_usd"].pct_change() * 100
    df["brent_usd_yoy_pct"] = df["brent_usd"].pct_change(12) * 100
    if "pb95_pln_l" in df.columns:
        df["pb95_pln_l_mom_pct"] = df["pb95_pln_l"].pct_change() * 100
        df["pb95_pln_l_yoy_pct"] = df["pb95_pln_l"].pct_change(12) * 100

    df["crude_source"] = eia_source
    return df


def transform_daily(
    brent: pd.DataFrame,
    wti: pd.DataFrame,
    usd_pln: pd.DataFrame,
    eur_pln: pd.DataFrame,
    eia_source: str = "unknown",
) -> pd.DataFrame:
    """Daily crude in PLN/l. No pump prices here (EC bulletin is weekly at best).

    FX is merge_asof backward: last NBP fixing on or before the quote date.
    """
    if brent.empty:
        return pd.DataFrame()

    df = brent.merge(wti, on="date", how="outer").sort_values("date").reset_index(drop=True)
    df = df.dropna(subset=["brent_usd"]).reset_index(drop=True)

    for rates in (usd_pln, eur_pln):
        if not rates.empty:
            df = pd.merge_asof(df, rates.sort_values("date"), on="date", direction="backward")

    before = len(df)
    df = df.dropna(subset=["usd_pln"]).reset_index(drop=True)
    if len(df) < before:
        logger.info("Daily layer: dropped %d day(s) with no FX fixing available",
                    before - len(df))

    df["brent_pln_bbl"] = df["brent_usd"] * df["usd_pln"]
    df["brent_pln_l"] = df["brent_pln_bbl"] / LITRE_PER_BBL
    if "wti_usd" in df.columns:
        df["brent_wti_spread_usd"] = df["brent_usd"] - df["wti_usd"]

    df["brent_usd_dod_pct"] = df["brent_usd"].pct_change() * 100
    df["brent_pln_l_ma30"] = df["brent_pln_l"].rolling(30, min_periods=5).mean()
    df["crude_source"] = eia_source
    return df


def validate_daily(df: pd.DataFrame) -> None:
    """Daily checks. Wide band (Brent ~9 USD Apr 2020)."""
    errors: list[str] = []
    if df["date"].duplicated().any():
        errors.append("duplicate dates in daily layer")
    if df[["brent_usd", "usd_pln", "brent_pln_l"]].isna().any().any():
        errors.append("missing values in daily crude/FX columns")
    if (df["brent_usd"] <= 0).any():
        errors.append("non-positive Brent USD in daily layer")
    if (df["usd_pln"] <= 0).any():
        errors.append("non-positive USD/PLN in daily layer")
    if not df["brent_pln_l"].between(0.1, 6).all():
        errors.append("daily brent_pln_l outside a plausible 0.1–6 PLN/l band")
    # monthly averages disguised as daily
    if df["brent_usd"].nunique() < len(df) * 0.5:
        errors.append("daily crude series has too few distinct values to be daily")
    span_days = (df["date"].max() - df["date"].min()).days
    if span_days and len(df) < span_days / 7:
        errors.append(f"only {len(df)} quotes across {span_days} days — too sparse to be daily")
    if errors:
        raise ValueError("Daily validation failed: " + "; ".join(errors))
    logger.info("Daily validation passed (%d rows)", len(df))


def validate(df: pd.DataFrame) -> None:
    errors: list[str] = []
    if df["date"].duplicated().any():
        errors.append("duplicate dates in analytical layer")
    if (df["brent_usd"].dropna() <= 0).any():
        errors.append("non-positive Brent USD values")
    if (df["usd_pln"].dropna() <= 0).any():
        errors.append("non-positive USD/PLN values")
    if "eur_pln" in df.columns and (df["eur_pln"].dropna() <= 0).any():
        errors.append("non-positive EUR/PLN values")

    # A PLN-denominated crude litre outside this band means the FX join or the
    # barrel conversion broke.
    crude = df["brent_pln_l"].dropna()
    if not crude.empty and not crude.between(0.1, 20).all():
        errors.append("brent_pln_l outside plausible 0.1–20 PLN/l range")

    # negative gross spread usually means EUR vs PLN mixed up
    if "spread_retail_vs_crude" in df.columns:
        gross = df["spread_retail_vs_crude"].dropna()
        if not gross.empty and (gross <= 0).any():
            errors.append(
                "non-positive gross retail-vs-crude spread — check that pump price "
                "and crude are both expressed in PLN/l"
            )
    if errors:
        raise ValueError("Validation failed: " + "; ".join(errors))
    logger.info("Validation passed (%d rows)", len(df))


def load_sql(frames: dict[str, pd.DataFrame], db_path: Path) -> None:
    """Upsert into schema.sql tables (keeps PK/indexes, unlike to_sql replace)."""
    schema_path = Path(__file__).parent / "sql" / "schema.sql"
    if not schema_path.exists():
        raise FileNotFoundError(f"missing schema: {schema_path}")
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(schema_path.read_text(encoding="utf-8"))
        for table, df in frames.items():
            if df is None or df.empty:
                logger.info("Skipping %s — nothing to load", table)
                continue
            _upsert_table(conn, table, df)
        conn.commit()
    finally:
        conn.close()


def _upsert_table(conn: sqlite3.Connection, table: str, df: pd.DataFrame) -> None:
    table_cols = [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]
    if not table_cols:
        raise ValueError(f"schema.sql defines no table named {table}")
    target = [c for c in table_cols if c in df.columns and c != "loaded_at"]
    missing = [c for c in df.columns if c not in table_cols]
    if missing:
        raise ValueError(
            "schema.sql is out of sync with the analytical layer; "
            f"columns absent from {table}: {missing}"
        )

    out = df[target].copy()
    out["date"] = pd.to_datetime(out["date"]).dt.strftime("%Y-%m-%d")
    out = out.astype(object).where(pd.notnull(out), None)

    placeholders = ", ".join("?" for _ in target)
    updates = ", ".join(f"{c}=excluded.{c}" for c in target if c != "date")
    conn.executemany(
        f"INSERT INTO {table} ({', '.join(target)}) VALUES ({placeholders}) "
        f"ON CONFLICT(date) DO UPDATE SET {updates}, loaded_at=datetime('now')",
        out.itertuples(index=False, name=None),
    )

    # drop rows that fell out of the recompute
    keep = list(out["date"])
    removed = conn.execute(
        f"DELETE FROM {table} WHERE date NOT IN ({', '.join('?' for _ in keep)})", keep
    ).rowcount
    if removed:
        logger.info("%s: removed %d stale row(s)", table, removed)
    logger.info("Upserted %d rows into %s (%d columns)", len(out), table, len(target))


def run(run_date: str | None = None) -> pd.DataFrame:
    run_date = run_date or date.today().isoformat()
    ensure_dirs()
    start = "2018-01-01"
    end = date.today().isoformat()

    brent_raw = fetch_eia(EIA_SERIES["brent"], start, end, frequency="monthly")
    wti_raw = fetch_eia(EIA_SERIES["wti"], start, end, frequency="monthly")
    brent_daily_raw = fetch_eia(EIA_SERIES["brent"], start, end, frequency="daily")
    wti_daily_raw = fetch_eia(EIA_SERIES["wti"], start, end, frequency="daily")
    save_raw("eia", {
        "brent": brent_raw, "wti": wti_raw,
        "brent_daily": brent_daily_raw, "wti_daily": wti_daily_raw,
        "fetched_at": run_date,
    }, run_date)

    eia_source = brent_raw.get("source", "reference_fallback")
    if eia_source == "reference_fallback":
        logger.warning(
            "Crude series is REFERENCE FALLBACK, not real EIA data — check network access"
        )
    else:
        logger.info("Crude series provenance: %s (real EIA data)", eia_source)

    usd_daily, usd_pln, usd_raw = fetch_nbp_history("usd", "usd_pln")
    eur_daily, eur_pln, eur_raw = fetch_nbp_history("eur", "eur_pln")
    save_raw("nbp", {"usd": usd_raw, "eur": eur_raw, "fetched_at": run_date}, run_date)

    eu_raw = fetch_eu_fuel_poland()
    save_raw("eu_fuel", eu_raw, run_date)

    # analytical window from 2018
    window_start = pd.Timestamp(start)
    brent = eia_to_monthly(brent_raw, "brent_usd")
    wti = eia_to_monthly(wti_raw, "wti_usd")
    brent = brent[brent["date"] >= window_start].reset_index(drop=True)
    wti = wti[wti["date"] >= window_start].reset_index(drop=True)
    fuel = load_fuel_history()

    # bulletin is EUR/1000l; stamp with edition date, not today
    if "pb95_net_eur_per_1000l" in eu_raw and eu_raw.get("source") != "fallback":
        edition_month = pd.Timestamp(EU_FUEL_BULLETIN_EDITION).replace(day=1)
        bulletin_row = pd.DataFrame([{
            "date": edition_month,
            "pb95_eur_l": eu_raw["pb95_eur_per_1000l"] / 1000,
            "diesel_eur_l": eu_raw["diesel_eur_per_1000l"] / 1000,
            "pb95_net_eur_l": eu_raw["pb95_net_eur_per_1000l"] / 1000,
            "diesel_net_eur_l": eu_raw["diesel_net_eur_per_1000l"] / 1000,
        }])
        fuel = pd.concat([fuel, bulletin_row], ignore_index=True).drop_duplicates("date", keep="last")
        logger.info("EC bulletin edition %s merged into %s", EU_FUEL_BULLETIN_EDITION, edition_month.date())

    df = transform(brent, wti, usd_pln, eur_pln, fuel, eia_source=eia_source)
    validate(df)

    brent_daily = eia_to_daily(brent_daily_raw, "brent_usd")
    wti_daily = eia_to_daily(wti_daily_raw, "wti_usd")
    brent_daily = brent_daily[brent_daily["date"] >= window_start].reset_index(drop=True)
    wti_daily = wti_daily[wti_daily["date"] >= window_start].reset_index(drop=True)
    daily = transform_daily(brent_daily, wti_daily, usd_daily, eur_daily,
                            eia_source=brent_daily_raw.get("source", "reference_fallback"))
    if daily.empty:
        logger.warning("Daily layer unavailable — the site will show the monthly grain only")
    else:
        validate_daily(daily)
        logger.info("Daily layer: %d quotes, %s..%s", len(daily),
                    daily["date"].min().date(), daily["date"].max().date())

    csv_path = PROCESSED / "energy_market.csv"
    df.to_csv(csv_path, index=False)
    logger.info("Processed CSV: %s", csv_path.relative_to(DATA.parent))
    if not daily.empty:
        daily_path = PROCESSED / "energy_market_daily.csv"
        daily.to_csv(daily_path, index=False)
        logger.info("Processed CSV: %s", daily_path.relative_to(DATA.parent))

    load_sql({"energy_market": df, "energy_market_daily": daily}, DATABASE / "energy.db")
    return df


def main() -> int:
    parser = argparse.ArgumentParser(description="Energy market ETL pipeline")
    parser.add_argument("--date", help="Run date for raw layer (YYYY-MM-DD)")
    args = parser.parse_args()
    try:
        df = run(args.date)
        logger.info("Pipeline complete — %d analytical rows", len(df))
        return 0
    except Exception as exc:
        logger.exception("Pipeline failed: %s", exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
