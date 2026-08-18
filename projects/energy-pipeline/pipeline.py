#!/usr/bin/env python3
"""
From Barrel to Pump — automated API data pipeline.

Extract:  EIA (Brent/WTI), NBP (USD/PLN), EC Weekly Oil Bulletin (Pb95/Diesel)
Transform: merge monthly series, compute PLN equivalents, spreads, changes
Load:     SQLite (energy.db) + processed/energy_market.csv

Usage:
    python pipeline.py              # full run
    python pipeline.py --date 2026-08-18
    EIA_API_KEY=... python pipeline.py
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from config import (
    DATA,
    DATABASE,
    EIA_SERIES,
    EU_FUEL_WITH_TAX_URL,
    LITRE_PER_BBL,
    NBP_CURRENCY,
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
NBP_BASE = f"https://api.nbp.pl/api/exchangerates/rates/{NBP_TABLE.lower()}/{NBP_CURRENCY}/"


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


def fetch_eia(series_id: str, facet: str, start: str, end: str) -> dict[str, Any]:
    if not EIA_API_KEY:
        logger.warning("EIA_API_KEY not set — using reference series from fallback")
        return {"source": "reference", "series": facet, "data": fallback_eia_monthly(facet)}
    url = (
        f"{EIA_BASE}?api_key={EIA_API_KEY}&frequency=daily&data[0]=value"
        f"&facets[series][]={facet}&start={start}&end={end}"
        f"&sort[0][column]=period&sort[0][direction]=asc&length=5000"
    )
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as exc:
        logger.error("EIA API request failed (%s): %s", facet, exc)
        return {"source": "fallback", "series": facet, "error": str(exc), "data": fallback_eia_monthly(facet)}


def fallback_eia_monthly(facet: str) -> list[dict[str, Any]]:
    """Reference monthly averages when EIA key unavailable."""
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


def eia_to_monthly(payload: dict[str, Any], col: str) -> pd.DataFrame:
    if isinstance(payload.get("data"), list) and payload["data"] and "period" in payload["data"][0]:
        rows = payload["data"]
    else:
        rows = (payload.get("response") or {}).get("data") or []
    if not rows:
        return pd.DataFrame(columns=["date", col])
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["period"].str[:7] + "-01")
    df[col] = pd.to_numeric(df["value"], errors="coerce")
    return df.groupby("date", as_index=False)[col].mean()


def fetch_nbp(start: date, end: date) -> dict[str, Any]:
    url = f"{NBP_BASE}{start.isoformat()}/{end.isoformat()}/?format=json"
    try:
        response = requests.get(url, headers={"Accept": "application/json"}, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as exc:
        logger.error("NBP API request failed: %s", exc)
        raise


def nbp_to_monthly(payload: dict[str, Any]) -> pd.DataFrame:
    rates = payload.get("rates") or []
    rows = []
    for r in rates:
        dt = pd.to_datetime(r["effectiveDate"])
        rows.append({"date": dt.replace(day=1), "value": float(r["mid"])})
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    return df.groupby("date", as_index=False)["value"].mean()


def fetch_nbp_history(start_year: int = 2018) -> pd.DataFrame:
    chunks: list[pd.DataFrame] = []
    start = date(start_year, 1, 1)
    end_limit = date.today()
    while start < end_limit:
        chunk_end = min(start + timedelta(days=366), end_limit)
        payload = fetch_nbp(start, chunk_end)
        chunks.append(nbp_to_monthly(payload))
        start = chunk_end + timedelta(days=1)
    return pd.concat(chunks, ignore_index=True).drop_duplicates("date") if chunks else pd.DataFrame()


def fetch_eu_fuel_poland() -> dict[str, Any]:
    try:
        response = requests.get(EU_FUEL_WITH_TAX_URL, timeout=60)
        response.raise_for_status()
        import io

        xls = pd.read_excel(io.BytesIO(response.content), header=None)
        poland = xls[xls.iloc[:, 0].astype(str).str.lower() == "poland"]
        if poland.empty:
            raise ValueError("Poland row not found in EC bulletin")
        row = poland.iloc[0]
        return {
            "source": "ec_weekly_oil_bulletin",
            "country": "Poland",
            "pb95_eur_per_1000l": float(row.iloc[1]),
            "diesel_eur_per_1000l": float(row.iloc[2]),
            "fetched_at": datetime.utcnow().isoformat() + "Z",
        }
    except Exception as exc:
        logger.error("EU fuel download failed: %s", exc)
        return {
            "source": "fallback",
            "country": "Poland",
            "pb95_eur_per_1000l": 1696.0,
            "diesel_eur_per_1000l": 1864.0,
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
    fuel: pd.DataFrame,
) -> pd.DataFrame:
    df = brent.merge(wti, on="date", how="outer")
    df = df.merge(usd_pln, on="date", how="left")
    if not fuel.empty:
        df = df.merge(fuel, on="date", how="outer")

    df = df.sort_values("date").reset_index(drop=True)
    df["brent_pln_bbl"] = df["brent_usd"] * df["usd_pln"]
    df["brent_pln_l"] = df["brent_pln_bbl"] / LITRE_PER_BBL
    if "pb95_eur_l" in df.columns:
        df["spread_retail_vs_crude"] = df["pb95_eur_l"] - df["brent_pln_l"]
    df["brent_usd_mom_pct"] = df["brent_usd"].pct_change() * 100
    df["brent_usd_yoy_pct"] = df["brent_usd"].pct_change(12) * 100
    if "pb95_eur_l" in df.columns:
        df["pb95_eur_l_mom_pct"] = df["pb95_eur_l"].pct_change() * 100
        df["pb95_eur_l_yoy_pct"] = df["pb95_eur_l"].pct_change(12) * 100
    return df


def validate(df: pd.DataFrame) -> None:
    errors: list[str] = []
    if df["date"].duplicated().any():
        errors.append("duplicate dates in analytical layer")
    if (df["brent_usd"].dropna() <= 0).any():
        errors.append("non-positive Brent USD values")
    if (df["usd_pln"].dropna() <= 0).any():
        errors.append("non-positive USD/PLN values")
    if errors:
        raise ValueError("Validation failed: " + "; ".join(errors))
    logger.info("Validation passed (%d rows)", len(df))


def load_sql(df: pd.DataFrame, db_path: Path) -> None:
    schema_path = Path(__file__).parent / "sql" / "schema.sql"
    conn = sqlite3.connect(db_path)
    try:
        if schema_path.exists():
            conn.executescript(schema_path.read_text(encoding="utf-8"))
        df.to_sql("energy_market", conn, if_exists="replace", index=False)
        conn.commit()
        logger.info("Loaded %d rows into %s", len(df), db_path.name)
    finally:
        conn.close()


def run(run_date: str | None = None) -> pd.DataFrame:
    run_date = run_date or date.today().isoformat()
    ensure_dirs()
    start = "2018-01-01"
    end = date.today().isoformat()

    brent_raw = fetch_eia("PET.RBRTE.D", EIA_SERIES["brent"], start, end)
    wti_raw = fetch_eia("PET.RWTC.D", EIA_SERIES["wti"], start, end)
    save_raw("eia", {"brent": brent_raw, "wti": wti_raw, "fetched_at": run_date}, run_date)

    nbp_chunks_raw: list[dict] = []
    start_d = date(2018, 1, 1)
    end_limit = date.today()
    while start_d < end_limit:
        chunk_end = min(start_d + timedelta(days=366), end_limit)
        nbp_chunks_raw.append(fetch_nbp(start_d, chunk_end))
        start_d = chunk_end + timedelta(days=1)
    save_raw("nbp", {"chunks": nbp_chunks_raw, "fetched_at": run_date}, run_date)

    eu_raw = fetch_eu_fuel_poland()
    save_raw("eu_fuel", eu_raw, run_date)

    brent = eia_to_monthly(brent_raw, "brent_usd")
    wti = eia_to_monthly(wti_raw, "wti_usd")
    usd_pln = fetch_nbp_history().rename(columns={"value": "usd_pln"})
    fuel = load_fuel_history()

    df = transform(brent, wti, usd_pln, fuel)
    validate(df)

    csv_path = PROCESSED / "energy_market.csv"
    df.to_csv(csv_path, index=False)
    logger.info("Processed CSV: %s", csv_path.relative_to(DATA.parent))

    db_path = DATABASE / "energy.db"
    load_sql(df, db_path)
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
