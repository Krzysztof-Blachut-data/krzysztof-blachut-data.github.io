#!/usr/bin/env python3
"""Build pipeline-data.js from energy_market.csv (+ daily if present).

    python scripts/build_pipeline_data.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import PROCESSED, RAW  # noqa: E402

CSV = PROCESSED / "energy_market.csv"
DAILY_CSV = PROCESSED / "energy_market_daily.csv"
OUT = ROOT / "pipeline-data.js"
MAX_LAG = 3


def _round(value, digits: int):
    if value is None or pd.isna(value):
        return None
    return round(float(value), digits)


def lag_correlations(df: pd.DataFrame, crude: str, retail: str) -> dict[str, float]:
    """Correlate crude at month t with the pump price at month t+n."""
    out: dict[str, float] = {}
    for lag in range(MAX_LAG + 1):
        shifted = pd.DataFrame({"crude": df[crude], "retail": df[retail].shift(-lag)}).dropna()
        if len(shifted) > 2:
            out[str(lag)] = round(float(shifted["crude"].corr(shifted["retail"])), 3)
    return out


def build_daily(monthly: pd.DataFrame) -> dict | None:
    """Daily series as parallel arrays (smaller than list-of-objects)."""
    if not DAILY_CSV.exists():
        return None
    df = pd.read_csv(DAILY_CSV, parse_dates=["date"]).sort_values("date").reset_index(drop=True)
    if df.empty:
        return None

    low, high = df["brent_usd"].idxmin(), df["brent_usd"].idxmax()
    m_low, m_high = monthly["brent_usd"].idxmin(), monthly["brent_usd"].idxmax()

    return {
        "rows": int(len(df)),
        "dateFrom": df["date"].min().strftime("%Y-%m-%d"),
        "dateTo": df["date"].max().strftime("%Y-%m-%d"),
        "crudeSource": sorted(df["crude_source"].dropna().unique().tolist())[0],
        "dates": df["date"].dt.strftime("%Y-%m-%d").tolist(),
        "brent_usd": [_round(v, 2) for v in df["brent_usd"]],
        "wti_usd": [_round(v, 2) for v in df["wti_usd"]],
        "brent_pln_l": [_round(v, 3) for v in df["brent_pln_l"]],
        "ma30": [_round(v, 3) for v in df["brent_pln_l_ma30"]],
        "latest": {
            "date": df.iloc[-1]["date"].strftime("%Y-%m-%d"),
            "brent_usd": _round(df.iloc[-1]["brent_usd"], 2),
            "wti_usd": _round(df.iloc[-1]["wti_usd"], 2),
            "brent_pln_l": _round(df.iloc[-1]["brent_pln_l"], 3),
            "usd_pln": _round(df.iloc[-1]["usd_pln"], 4),
            "dod_pct": _round(df.iloc[-1]["brent_usd_dod_pct"], 2),
        },
        "extremes": {
            "daily_low": _round(df.loc[low, "brent_usd"], 2),
            "daily_low_date": df.loc[low, "date"].strftime("%Y-%m-%d"),
            "daily_high": _round(df.loc[high, "brent_usd"], 2),
            "daily_high_date": df.loc[high, "date"].strftime("%Y-%m-%d"),
            "monthly_low": _round(monthly.loc[m_low, "brent_usd"], 2),
            "monthly_low_date": monthly.loc[m_low, "date"].strftime("%Y-%m"),
            "monthly_high": _round(monthly.loc[m_high, "brent_usd"], 2),
            "monthly_high_date": monthly.loc[m_high, "date"].strftime("%Y-%m"),
        },
        "biggestMove": {
            "pct": _round(df["brent_usd_dod_pct"].abs().max(), 2),
            "date": df.loc[df["brent_usd_dod_pct"].abs().idxmax(), "date"].strftime("%Y-%m-%d"),
        },
        # Apr 2020 negative WTI print
        "negativeWti": _negative_wti(df),
    }


def _negative_wti(df: pd.DataFrame) -> dict | None:
    negative = df[df["wti_usd"].notna() & (df["wti_usd"] < 0)]
    if negative.empty:
        return None
    worst = negative.loc[negative["wti_usd"].idxmin()]
    return {
        "value": _round(worst["wti_usd"], 2),
        "date": worst["date"].strftime("%Y-%m-%d"),
        "days": int(len(negative)),
    }


def raw_runs() -> list[str]:
    runs: set[str] = set()
    for source in ("eia", "nbp", "eu_fuel"):
        folder = RAW / source
        if folder.exists():
            runs.update(p.stem for p in folder.glob("*.json"))
    return sorted(runs)


def build() -> dict:
    df = pd.read_csv(CSV, parse_dates=["date"]).sort_values("date").reset_index(drop=True)
    latest = df.iloc[-1]

    spread = df["spread_retail_vs_crude"].dropna()
    net_spread = df["spread_net_vs_crude"].dropna()
    pb95_peak_idx = df["pb95_pln_l"].idxmax()
    brent_peak_idx = df["brent_usd"].idxmax()

    sources = sorted(df["crude_source"].dropna().unique().tolist())

    return {
        "rows": int(len(df)),
        "dateFrom": df["date"].min().strftime("%Y-%m-%d"),
        "dateTo": df["date"].max().strftime("%Y-%m-%d"),
        # provenance so the UI can label the crude series honestly
        "crudeSource": sources[0] if len(sources) == 1 else "mixed",
        "crudeIsReal": bool(sources) and set(sources) <= {"eia_api", "eia_public_xls"},
        "daily": build_daily(df),
        "latest": {
            "date": latest["date"].strftime("%Y-%m-%d"),
            "brent_usd": _round(latest["brent_usd"], 2),
            "usd_pln": _round(latest["usd_pln"], 4),
            "eur_pln": _round(latest["eur_pln"], 4),
            "brent_pln_l": _round(latest["brent_pln_l"], 3),
            "pb95_eur_l": _round(latest["pb95_eur_l"], 3),
            "pb95_pln_l": _round(latest["pb95_pln_l"], 3),
            "pb95_net_pln_l": _round(latest.get("pb95_net_pln_l"), 3),
            "spread_retail": _round(latest["spread_retail_vs_crude"], 3),
            "spread_net": _round(latest.get("spread_net_vs_crude"), 3),
            "pb95_yoy_pct": _round(latest.get("pb95_pln_l_yoy_pct"), 1),
        },
        "corrBrentPb95": round(float(df["brent_usd"].corr(df["pb95_pln_l"])), 3),
        "lags": lag_correlations(df, "brent_usd", "pb95_pln_l"),
        "stats": {
            "spread_min": _round(spread.min(), 3),
            "spread_max": _round(spread.max(), 3),
            "spread_mean": _round(spread.mean(), 3),
            "net_spread_obs": int(len(net_spread)),
            "net_spread_latest": _round(net_spread.iloc[-1], 3) if len(net_spread) else None,
            "brent_peak": _round(df.loc[brent_peak_idx, "brent_usd"], 1),
            "brent_peak_date": df.loc[brent_peak_idx, "date"].strftime("%Y-%m"),
            "pb95_peak": _round(df.loc[pb95_peak_idx, "pb95_pln_l"], 3),
            "pb95_peak_date": df.loc[pb95_peak_idx, "date"].strftime("%Y-%m"),
        },
        "rawRuns": raw_runs(),
        "chart": [
            {
                "date": row["date"].strftime("%Y-%m"),
                "brent_usd": _round(row["brent_usd"], 2),
                "brent_pln_l": _round(row["brent_pln_l"], 3),
                "pb95_pln_l": _round(row["pb95_pln_l"], 3),
                "pb95_net_pln_l": _round(row.get("pb95_net_pln_l"), 3),
                "spread_retail_vs_crude": _round(row["spread_retail_vs_crude"], 3),
                "spread_net_vs_crude": _round(row.get("spread_net_vs_crude"), 3),
            }
            for _, row in df.iterrows()
        ],
    }


def main() -> int:
    if not CSV.exists():
        sys.stderr.write(f"missing {CSV} — run pipeline.py first\n")
        return 1
    data = build()
    payload = json.dumps(data, indent=2, ensure_ascii=False)
    OUT.write_text(
        "// Generated by scripts/build_pipeline_data.py — do not edit by hand.\n"
        "// Every figure here is derived from data/processed/energy_market.csv.\n"
        f"window.__PIPELINE_DATA = {payload};\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT.relative_to(ROOT)} — {data['rows']} rows, corr={data['corrBrentPb95']}")
    print(f"crude source: {data['crudeSource']} (real={data['crudeIsReal']})")
    if data["daily"]:
        d = data["daily"]
        ex = d["extremes"]
        print(f"daily layer: {d['rows']} quotes {d['dateFrom']}..{d['dateTo']}")
        print(f"  daily low {ex['daily_low']} on {ex['daily_low_date']} vs "
              f"monthly low {ex['monthly_low']} in {ex['monthly_low_date']}")
        print(f"  file size: {OUT.stat().st_size / 1024:.0f} KB")
    else:
        print("daily layer: absent — run pipeline.py to build it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
