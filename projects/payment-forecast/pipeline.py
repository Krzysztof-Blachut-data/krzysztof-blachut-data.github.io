#!/usr/bin/env python3
"""AR invoices: clean dates, measure late cash, score open invoices.

    python pipeline.py
    python pipeline.py --sample-only   # use data/samples if offline
"""
from __future__ import annotations

import argparse
import json
import logging
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

from config import (
    CLEAN_CSV,
    HOLDOUT_FRAC,
    OPEN_PRIORITY_CSV,
    RAW_CSV,
    REPORT_JSON,
    SAMPLES,
    SOURCE_URL,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("payment")

RENAME = {
    "buisness_year": "business_year",
    "document type": "document_type",
    "document_create_date.1": "document_create_date_alt",
}


def fetch_raw(dest: Path = RAW_CSV) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        log.info("raw already present: %s", dest.name)
        return dest
    log.info("downloading %s", SOURCE_URL)
    urllib.request.urlretrieve(SOURCE_URL, dest)
    return dest


def parse_ymd(series: pd.Series) -> pd.Series:
    """Ints/floats like 20190307 -> Timestamp."""
    text = (
        series.astype("Float64")
        .astype("Int64")
        .astype(str)
        .str.replace("<NA>", "", regex=False)
        .str.replace(".0", "", regex=False)
    )
    return pd.to_datetime(text, format="%Y%m%d", errors="coerce")


def load_raw(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df.columns = [c.strip() for c in df.columns]
    return df.rename(columns=RENAME)


def transform(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    # load_raw already applied RENAME; keep a note of what we expect cleaned
    stats: dict = {
        "rows_in": int(len(df)),
        "cols_renamed": [k for k, v in RENAME.items() if v in df.columns],
    }

    out = df.copy()
    if "isOpen" not in out.columns and "is_open" in out.columns:
        out["isOpen"] = out["is_open"].astype(int)

    out["posting_date"] = pd.to_datetime(out["posting_date"], errors="coerce")
    out["clear_date"] = pd.to_datetime(out["clear_date"], errors="coerce")
    if not pd.api.types.is_datetime64_any_dtype(out["due_in_date"]):
        out["due_in_date"] = parse_ymd(out["due_in_date"])
    if not pd.api.types.is_datetime64_any_dtype(out["document_create_date"]):
        out["document_create_date"] = parse_ymd(out["document_create_date"])
    if "baseline_create_date" in out.columns and not pd.api.types.is_datetime64_any_dtype(out["baseline_create_date"]):
        out["baseline_create_date"] = parse_ymd(out["baseline_create_date"])
    if "document_create_date_alt" in out.columns and not pd.api.types.is_datetime64_any_dtype(out["document_create_date_alt"]):
        out["document_create_date_alt"] = parse_ymd(out["document_create_date_alt"])

    out["business_year"] = pd.to_numeric(out.get("business_year"), errors="coerce").astype("Int64")
    out["total_open_amount"] = pd.to_numeric(out["total_open_amount"], errors="coerce")
    out["is_open"] = out["isOpen"].astype(int).astype(bool)
    out = out.drop(columns=["isOpen", "area_business", "posting_id"], errors="ignore")

    out["days_to_pay"] = (out["clear_date"] - out["posting_date"]).dt.days
    out["days_late"] = (out["clear_date"] - out["due_in_date"]).dt.days
    out["credit_days"] = (out["due_in_date"] - out["posting_date"]).dt.days
    out.loc[out["is_open"], ["days_to_pay", "days_late"]] = np.nan

    out["is_late"] = (out["days_late"] > 0).astype("boolean")
    out.loc[out["is_open"], "is_late"] = pd.NA

    closed_ok = (~out["is_open"]) & out["clear_date"].notna() & out["posting_date"].notna() & out["due_in_date"].notna()
    open_ok = out["is_open"] & out["posting_date"].notna() & out["due_in_date"].notna()
    stats["closed_ok"] = int(closed_ok.sum())
    stats["open_ok"] = int(open_ok.sum())
    stats["dropped"] = int((~(closed_ok | open_ok)).sum())
    out = out.loc[closed_ok | open_ok].copy()

    stats["rows_out"] = int(len(out))
    stats["date_parse"] = {
        "posting_ok": int(out["posting_date"].notna().sum()),
        "due_ok": int(out["due_in_date"].notna().sum()),
        "clear_ok": int(out["clear_date"].notna().sum()),
    }
    return out, stats


def _aging_bucket(days: float) -> str:
    if pd.isna(days):
        return "unknown"
    if days <= 0:
        return "current"
    if days <= 7:
        return "1-7"
    if days <= 30:
        return "8-30"
    if days <= 60:
        return "31-60"
    return "60+"


def analyse(df: pd.DataFrame) -> tuple[dict, pd.DataFrame, pd.DataFrame]:
    closed = df.loc[~df["is_open"]].copy()
    open_inv = df.loc[df["is_open"]].copy()

    as_of = open_inv["posting_date"].max()
    if pd.isna(as_of):
        as_of = closed["clear_date"].max()

    open_inv = open_inv.copy()
    open_inv["days_past_due"] = (as_of - open_inv["due_in_date"]).dt.days
    open_inv["aging_bucket"] = open_inv["days_past_due"].map(_aging_bucket)

    late = closed["is_late"].fillna(False).astype(bool)
    report = {
        "source": SOURCE_URL,
        "as_of": as_of.strftime("%Y-%m-%d") if pd.notna(as_of) else None,
        "totals": {
            "rows": int(len(df)),
            "closed": int(len(closed)),
            "open": int(len(open_inv)),
            "customers": int(df["cust_number"].nunique()),
            "payment_terms": int(df["cust_payment_terms"].nunique()),
            "currencies": sorted(df["invoice_currency"].dropna().unique().tolist()),
            "amount_closed": round(float(closed["total_open_amount"].sum()), 2),
            "amount_open": round(float(open_inv["total_open_amount"].sum()), 2),
        },
        "cycle": {
            "mean_days_to_pay": round(float(closed["days_to_pay"].mean()), 2),
            "median_days_to_pay": round(float(closed["days_to_pay"].median()), 2),
            "p90_days_to_pay": round(float(closed["days_to_pay"].quantile(0.9)), 2),
            "late_rate": round(float(late.mean()), 4),
            "median_days_late_when_late": round(
                float(closed.loc[late, "days_late"].median()) if late.any() else 0, 2
            ),
            "late_amount": round(float(closed.loc[late, "total_open_amount"].sum()), 2),
            "on_time_amount": round(float(closed.loc[~late, "total_open_amount"].sum()), 2),
        },
        "by_terms": _by_terms(closed),
        "by_currency": _by_group(closed, "invoice_currency"),
        "by_business_code": _by_group(closed, "business_code"),
        "top_late_customers": _top_late_customers(closed),
        "open_aging": (
            open_inv.groupby("aging_bucket")["total_open_amount"]
            .agg(amount="sum", invoices="count")
            .reset_index()
            .assign(amount=lambda x: x["amount"].round(2))
            .to_dict(orient="records")
        ),
        "monthly": _monthly(closed),
    }
    return report, closed, open_inv


def _by_terms(closed: pd.DataFrame) -> list[dict]:
    g = closed.groupby("cust_payment_terms", dropna=False)
    rows = []
    for term, part in g:
        late = part["is_late"].fillna(False).astype(bool)
        rows.append({
            "term": str(term),
            "invoices": int(len(part)),
            "amount": round(float(part["total_open_amount"].sum()), 2),
            "late_rate": round(float(late.mean()), 4),
            "median_days_to_pay": round(float(part["days_to_pay"].median()), 2),
            "median_credit_days": round(float(part["credit_days"].median()), 2),
        })
    rows.sort(key=lambda r: r["invoices"], reverse=True)
    return rows[:12]


def _by_group(closed: pd.DataFrame, col: str) -> list[dict]:
    rows = []
    for key, part in closed.groupby(col, dropna=False):
        late = part["is_late"].fillna(False).astype(bool)
        rows.append({
            "key": str(key),
            "invoices": int(len(part)),
            "amount": round(float(part["total_open_amount"].sum()), 2),
            "late_rate": round(float(late.mean()), 4),
            "median_days_to_pay": round(float(part["days_to_pay"].median()), 2),
        })
    rows.sort(key=lambda r: r["amount"], reverse=True)
    return rows


def _top_late_customers(closed: pd.DataFrame, n: int = 10) -> list[dict]:
    late = closed.loc[closed["is_late"].fillna(False).astype(bool)]
    if late.empty:
        return []
    g = late.groupby(["cust_number", "name_customer"], as_index=False).agg(
        late_invoices=("doc_id", "count"),
        late_amount=("total_open_amount", "sum"),
        median_days_late=("days_late", "median"),
    )
    g = g.sort_values("late_amount", ascending=False).head(n)
    g["late_amount"] = g["late_amount"].round(2)
    g["median_days_late"] = g["median_days_late"].round(1)
    g["name_customer"] = g["name_customer"].astype(str).str.strip()
    return g.to_dict(orient="records")


def _monthly(closed: pd.DataFrame) -> list[dict]:
    m = closed.assign(month=closed["posting_date"].dt.to_period("M").astype(str))
    g = m.groupby("month").agg(
        invoices=("doc_id", "count"),
        amount=("total_open_amount", "sum"),
        late_rate=("is_late", "mean"),
        median_days_to_pay=("days_to_pay", "median"),
    ).reset_index()
    g["amount"] = g["amount"].round(2)
    g["late_rate"] = g["late_rate"].round(4)
    g["median_days_to_pay"] = g["median_days_to_pay"].round(2)
    return g.to_dict(orient="records")


def build_predictor(closed: pd.DataFrame) -> tuple[dict, dict, dict]:
    """Customer median days_to_pay; if missing, term or global median. MAE on later invoices."""
    closed = closed.sort_values("clear_date").reset_index(drop=True)
    cut = int(len(closed) * (1 - HOLDOUT_FRAC))
    train, test = closed.iloc[:cut], closed.iloc[cut:]

    cust_med = train.groupby("cust_number")["days_to_pay"].median()
    term_med = train.groupby("cust_payment_terms")["days_to_pay"].median()
    global_med = float(train["days_to_pay"].median())

    def predict_row(row) -> float:
        if row["cust_number"] in cust_med.index:
            return float(cust_med.loc[row["cust_number"]])
        if row["cust_payment_terms"] in term_med.index:
            return float(term_med.loc[row["cust_payment_terms"]])
        return global_med

    pred = test.apply(predict_row, axis=1)
    mae = float((pred - test["days_to_pay"]).abs().mean())
    naive = float((global_med - test["days_to_pay"]).abs().mean())

    meta = {
        "method": "customer_median -> term_median -> global_median",
        "train_rows": int(len(train)),
        "test_rows": int(len(test)),
        "mae_days": round(mae, 2),
        "naive_mae_days": round(naive, 2),
        "lift_vs_naive": round(naive - mae, 2),
        "global_median_days": round(global_med, 2),
    }
    return cust_med.to_dict(), term_med.to_dict(), meta


def score_open(
    open_inv: pd.DataFrame,
    cust_med: dict,
    term_med: dict,
    global_med: float,
    as_of: pd.Timestamp,
) -> pd.DataFrame:
    def expected_days(row) -> float:
        if row["cust_number"] in cust_med:
            return float(cust_med[row["cust_number"]])
        term = row["cust_payment_terms"]
        if term in term_med:
            return float(term_med[term])
        return global_med

    out = open_inv.copy()
    out["pred_days_to_pay"] = out.apply(expected_days, axis=1).round(1)
    out["pred_clear_date"] = out["posting_date"] + pd.to_timedelta(out["pred_days_to_pay"], unit="D")
    out["pred_days_late"] = (out["pred_clear_date"] - out["due_in_date"]).dt.days
    out["pred_late"] = out["pred_days_late"] > 0
    # priority: predicted days to pay × invoice amount (not a late-payment probability)
    out["days_past_due"] = (as_of - out["due_in_date"]).dt.days
    out["priority_score"] = (out["pred_days_to_pay"] * out["total_open_amount"]).round(0)
    out = out.sort_values("priority_score", ascending=False)
    return out


def write_sample(df: pd.DataFrame, n: int = 2000) -> None:
    path = SAMPLES / "invoices_2000.csv"
    df.sample(n=min(n, len(df)), random_state=42).to_csv(path, index=False)
    log.info("sample -> %s", path)


def scenario(closed: pd.DataFrame) -> dict:
    """If top late customers paid at on-time median, how many late-days of cash move earlier."""
    late = closed.loc[closed["is_late"].fillna(False).astype(bool)]
    on_time_med = float(closed.loc[~closed["is_late"].fillna(False).astype(bool), "days_to_pay"].median())
    top = (
        late.groupby("cust_number")
        .agg(late_amount=("total_open_amount", "sum"), late_inv=("doc_id", "count"),
             med_days=("days_to_pay", "median"))
        .sort_values("late_amount", ascending=False)
        .head(20)
    )
    # rough cash-days: amount * excess days vs on-time median
    top["excess_days"] = (top["med_days"] - on_time_med).clip(lower=0)
    top["cash_day_exposure"] = top["late_amount"] * top["excess_days"]
    return {
        "on_time_median_days": round(on_time_med, 2),
        "top20_late_customers": int(len(top)),
        "late_amount_top20": round(float(top["late_amount"].sum()), 2),
        "cash_day_exposure_top20": round(float(top["cash_day_exposure"].sum()), 2),
        "note": "top late customers by historical late amount; not the contact-priority score",
    }


def run(sample_only: bool = False) -> dict:
    if sample_only:
        sample = SAMPLES / "invoices_2000.csv"
        if not sample.exists():
            raise SystemExit("no sample yet — run without --sample-only first")
        raw_path = sample
    else:
        raw_path = fetch_raw()

    raw = load_raw(raw_path)
    clean, clean_stats = transform(raw)
    report, closed, open_inv = analyse(clean)

    cust_med, term_med, pred_meta = build_predictor(closed)
    # stringify keys for open scoring lookups
    cust_med = {str(k): v for k, v in cust_med.items()}
    term_med = {str(k): v for k, v in term_med.items()}
    as_of = pd.Timestamp(report["as_of"])
    open_inv = open_inv.copy()
    open_inv["cust_number"] = open_inv["cust_number"].astype(str)
    open_inv["cust_payment_terms"] = open_inv["cust_payment_terms"].astype(str)
    scored = score_open(open_inv, cust_med, term_med, pred_meta["global_median_days"], as_of)

    clean.to_csv(CLEAN_CSV, index=False)
    cols = [
        "invoice_id", "cust_number", "name_customer", "invoice_currency",
        "total_open_amount", "posting_date", "due_in_date", "cust_payment_terms",
        "pred_days_to_pay", "pred_clear_date", "pred_days_late", "pred_late",
        "days_past_due", "priority_score",
    ]
    scored[cols].head(50).to_csv(OPEN_PRIORITY_CSV, index=False)

    if not sample_only:
        write_sample(raw)

    report["cleaning"] = clean_stats
    report["prediction"] = pred_meta
    report["scenario"] = scenario(closed)
    report["open_priority_top"] = [
        {
            "invoice_id": None if pd.isna(r.invoice_id) else str(int(r.invoice_id)),
            "customer": str(r.name_customer).strip(),
            "amount": round(float(r.total_open_amount), 2),
            "currency": r.invoice_currency,
            "due": r.due_in_date.strftime("%Y-%m-%d"),
            "pred_clear": r.pred_clear_date.strftime("%Y-%m-%d"),
            "pred_late": bool(r.pred_late),
            "days_past_due": int(r.days_past_due) if pd.notna(r.days_past_due) else None,
        }
        for r in scored.head(8).itertuples()
    ]

    REPORT_JSON.write_text(json.dumps(report, indent=2), encoding="utf-8")
    log.info("wrote %s (%d rows clean)", CLEAN_CSV.name, len(clean))
    log.info(
        "late_rate=%.1f%% MAE=%.1fd (naive %.1fd)",
        100 * report["cycle"]["late_rate"],
        pred_meta["mae_days"],
        pred_meta["naive_mae_days"],
    )
    return report


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--sample-only", action="store_true")
    args = p.parse_args()
    run(sample_only=args.sample_only)


if __name__ == "__main__":
    main()
