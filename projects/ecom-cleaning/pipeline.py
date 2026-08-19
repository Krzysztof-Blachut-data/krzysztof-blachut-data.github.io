#!/usr/bin/env python3
"""Clean five linked e-commerce CSVs and write the quality report + aggregates.

    python pipeline.py
    python pipeline.py --source samples
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import (  # noqa: E402
    AGGREGATES,
    CATEGORIES,
    CHUNK_SIZE,
    ISSUES,
    PAYMENTS,
    PRICE_SENTINELS,
    PROCESSED,
    RAW,
    REPORTS,
    SAMPLE_ROWS,
    SAMPLES,
    SENTIMENTS,
    SOURCES,
    STATUSES,
    VALID_EVENT_TYPES,
)
from normalise import Normaliser  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s",
                    datefmt="%H:%M:%S")
logger = logging.getLogger("ecom")

# alt layouts after ISO; '%Y/%d/%m' rescues swapped day/month like 2024/31/01
DATE_FORMATS = ("%Y/%d/%m", "%d-%m-%Y", "%Y/%m/%d %H:%M", "%d/%m/%Y")


def parse_dates(series: pd.Series) -> tuple[pd.Series, dict[str, int]]:
    """ISO first, then DATE_FORMATS. Returns series + per-stage counts."""
    text = series.astype("string").str.strip()
    blank = text.isna() | text.eq("")
    parsed = pd.to_datetime(text, format="ISO8601", errors="coerce")

    stats = {"iso": int(parsed.notna().sum()), "blank": int(blank.sum()), "rescued": 0}
    for fmt in DATE_FORMATS:
        todo = parsed.isna() & ~blank
        if not todo.any():
            break
        attempt = pd.to_datetime(text[todo], format=fmt, errors="coerce")
        gained = int(attempt.notna().sum())
        if gained:
            parsed.loc[todo] = attempt
            stats["rescued"] += gained
            stats[f"format_{fmt}"] = gained

    stats["unparseable"] = int((parsed.isna() & ~blank).sum())
    return parsed, stats


DOUBLE_RUN = re.compile(r"(.)\1")
MIN_DOUBLED_RUNS = 2


def clean_text_name(series: pd.Series) -> tuple[pd.Series, dict[str, int]]:
    """Strip, title-case, undouble only if >= MIN_DOUBLED_RUNS (keeps Aaron/Emma)."""
    text = series.astype("string")
    padded = int((text != text.str.strip()).sum())
    text = text.str.strip()

    def undouble(value):
        if not isinstance(value, str) or len(DOUBLE_RUN.findall(value)) < MIN_DOUBLED_RUNS:
            return value
        return re.sub(r"(.)\1+", r"\1", value)

    undoubled = text.map(undouble)
    doubled = int((undoubled != text).sum())
    titled = undoubled.str.title()
    recased = int((titled != undoubled).sum())
    return titled, {"padding": padded, "doubled_letters": doubled, "recased": recased}


def clean_crm(path: Path, report: dict) -> tuple[pd.DataFrame, set[str]]:
    logger.info("CRM: reading %s", path.name)
    df = pd.read_csv(path, dtype=str)
    stats: dict[str, object] = {"rows_in": len(df)}

    df["first_name"], first_stats = clean_text_name(df["first_name"])
    df["last_name"], last_stats = clean_text_name(df["last_name"])
    stats["name_padding"] = first_stats["padding"] + last_stats["padding"]
    stats["name_doubled_letters"] = first_stats["doubled_letters"] + last_stats["doubled_letters"]
    stats["name_recased"] = first_stats["recased"] + last_stats["recased"]

    df["email"] = df["email"].astype("string").str.strip().str.lower()
    stats["email_missing"] = int(df["email"].isna().sum())
    # an email shared by several customer_ids is the signal for a merged/duplicated person
    stats["email_shared"] = int(df["email"].dropna().duplicated(keep="first").sum())

    df["dob"], _ = parse_dates(df["dob"])
    df["signup_date"], _ = parse_dates(df["signup_date"])
    stats["signup_before_dob"] = int((df["signup_date"] < df["dob"]).sum())

    # device_id(s) packs several ids into one cell; split it out so joins are possible
    devices = df["device_id(s)"].astype("string").fillna("")
    stats["multi_device_rows"] = int(devices.str.contains(";").sum())
    df["device_count"] = devices.str.count(";").add(1).where(devices.ne(""), 0).astype(int)
    registry = {d.strip() for cell in devices for d in cell.split(";") if d.strip()}
    stats["devices_registered"] = len(registry)

    stats["duplicate_customer_id"] = int(df["customer_id"].duplicated().sum())
    # keep the most recent signup for a repeated id — a later record is the better one
    df = (df.sort_values("signup_date")
            .drop_duplicates("customer_id", keep="last")
            .reset_index(drop=True))
    stats["rows_out"] = len(df)
    report["crm"] = stats
    logger.info("CRM: %d -> %d rows (%d duplicate ids removed)",
                stats["rows_in"], len(df), stats["duplicate_customer_id"])
    return df, registry


def clean_catalog(path: Path, report: dict) -> tuple[pd.DataFrame, Normaliser]:
    logger.info("Catalog: reading %s", path.name)
    df = pd.read_csv(path, dtype=str)
    stats: dict[str, object] = {"rows_in": len(df), "categories_raw": df["category"].nunique()}

    norm = Normaliser(CATEGORIES)
    df["category"] = df["category"].map(norm)
    stats["categories_clean"] = int(df["category"].nunique())
    stats["category_rules"] = norm.report()
    stats["category_repaired"] = norm.repaired
    stats["category_unresolved"] = norm.rules["unresolved"]

    df["product_name"], name_stats = clean_text_name(df["product_name"])
    stats["name_fixes"] = sum(name_stats.values())

    # thousands separators arrive as text; strip them before coercing
    price = pd.to_numeric(df["price"].astype("string").str.replace(",", "", regex=False),
                          errors="coerce")
    stats["price_unparseable"] = int(price.isna().sum())
    sentinel = price.isin(PRICE_SENTINELS)
    stats["price_sentinel"] = int(sentinel.sum())
    stats["price_negative"] = int((price < 0).sum())
    price = price.mask(sentinel | (price <= 0))

    # flag outliers, don't drop (orphan orders otherwise)
    high = price > price.quantile(0.99) * 3
    stats["price_implausible"] = int(high.sum())
    df["price"] = price
    df["price_flag"] = ""
    df.loc[sentinel, "price_flag"] = "sentinel"
    df.loc[high.fillna(False), "price_flag"] = "implausible_high"
    stats["price_usable"] = int(df["price"].notna().sum())
    stats["rows_out"] = len(df)
    report["catalog"] = stats
    logger.info("Catalog: %d categories -> %d, %d prices unusable",
                stats["categories_raw"], stats["categories_clean"],
                len(df) - stats["price_usable"])
    return df, norm


def clean_orders(path: Path, report: dict) -> pd.DataFrame:
    logger.info("Orders: reading %s", path.name)
    df = pd.read_csv(path, dtype=str)
    stats: dict[str, object] = {
        "rows_in": len(df),
        "payment_raw": int(df["payment_method"].nunique()),
        "status_raw": int(df["status"].nunique()),
    }

    pay_norm = Normaliser(PAYMENTS)
    df["payment_method"] = df["payment_method"].map(pay_norm)
    stats["payment_clean"] = int(df["payment_method"].nunique())
    stats["payment_rules"] = pay_norm.report()
    stats["payment_repaired"] = pay_norm.repaired

    status_norm = Normaliser(STATUSES)
    df["status"] = df["status"].map(status_norm)
    stats["status_clean"] = int(df["status"].nunique())
    stats["status_rules"] = status_norm.report()
    stats["status_repaired"] = status_norm.repaired

    amount = pd.to_numeric(df["order_amount"], errors="coerce")
    stats["amount_unparseable"] = int(amount.isna().sum())
    stats["amount_non_positive"] = int((amount <= 0).sum())
    df["order_amount"] = amount.mask(amount <= 0)
    stats["amount_usable"] = int(df["order_amount"].notna().sum())

    qty = pd.to_numeric(df["quantity"], errors="coerce")
    stats["quantity_unparseable"] = int(qty.isna().sum())
    stats["quantity_non_positive"] = int((qty <= 0).sum())
    df["quantity"] = qty.mask(qty <= 0)
    stats["quantity_usable"] = int(df["quantity"].notna().sum())

    df["order_date"], date_stats = parse_dates(df["order_date"])
    stats["date_iso"] = date_stats["iso"]
    stats["date_blank"] = date_stats["blank"]
    stats["date_rescued"] = date_stats["rescued"]
    stats["date_unparseable"] = date_stats["unparseable"]
    stats["date_formats"] = {k.replace("format_", ""): v
                             for k, v in date_stats.items() if k.startswith("format_")}

    future = df["order_date"] > pd.Timestamp.now(tz=None)
    stats["date_in_future"] = int(future.sum())
    df["date_flag"] = ""
    df.loc[future.fillna(False), "date_flag"] = "future"

    stats["duplicate_order_id"] = int(df["order_id"].duplicated().sum())
    df = df.drop_duplicates("order_id").reset_index(drop=True)

    # a row is analysable only if amount, quantity and date all survived
    df["is_analysable"] = (df["order_amount"].notna() & df["quantity"].notna()
                           & df["order_date"].notna() & df["status"].notna())
    stats["analysable"] = int(df["is_analysable"].sum())
    stats["quarantined"] = int((~df["is_analysable"]).sum())
    stats["rows_out"] = len(df)
    report["orders"] = stats
    logger.info("Orders: %d analysable, %d quarantined, %d dates rescued",
                stats["analysable"], stats["quarantined"], stats["date_rescued"])
    return df


def clean_tickets(path: Path, report: dict) -> pd.DataFrame:
    logger.info("Tickets: reading %s", path.name)
    df = pd.read_csv(path, dtype=str)
    stats: dict[str, object] = {
        "rows_in": len(df),
        "issue_raw": int(df["issue_type"].nunique()),
        "sentiment_raw": int(df["sentiment"].nunique()),
    }

    issue_norm = Normaliser(ISSUES)
    df["issue_type"] = df["issue_type"].map(issue_norm)
    stats["issue_clean"] = int(df["issue_type"].nunique())
    stats["issue_rules"] = issue_norm.report()
    stats["issue_repaired"] = issue_norm.repaired

    sent_norm = Normaliser(SENTIMENTS)
    df["sentiment"] = df["sentiment"].map(sent_norm)
    stats["sentiment_clean"] = int(df["sentiment"].nunique())
    stats["sentiment_rules"] = sent_norm.report()
    stats["sentiment_repaired"] = sent_norm.repaired

    df["support_agent"], agent_stats = clean_text_name(df["support_agent"])
    stats["agent_padding"] = agent_stats["padding"]

    df["ticket_created"], created_stats = parse_dates(df["ticket_created"])
    df["ticket_resolved"], resolved_stats = parse_dates(df["ticket_resolved"])
    stats["created_blank"] = created_stats["blank"]
    stats["created_rescued"] = created_stats["rescued"]
    stats["created_unparseable"] = created_stats["unparseable"]
    stats["resolved_rescued"] = resolved_stats["rescued"]
    stats["resolved_unparseable"] = resolved_stats["unparseable"]

    # resolved-before-created cannot be repaired, only flagged: either timestamp may be wrong
    reversed_pair = df["ticket_resolved"] < df["ticket_created"]
    stats["resolved_before_created"] = int(reversed_pair.sum())
    df["timeline_flag"] = ""
    df.loc[reversed_pair.fillna(False), "timeline_flag"] = "resolved_before_created"

    stated = pd.to_numeric(df["resolution_time_hours"], errors="coerce")
    measured = (df["ticket_resolved"] - df["ticket_created"]).dt.total_seconds() / 3600
    both = stated.notna() & measured.notna() & ~reversed_pair.fillna(False)
    disagree = both & ((stated - measured).abs() > 1)
    stats["resolution_time_checkable"] = int(both.sum())
    stats["resolution_time_disagrees"] = int(disagree.sum())
    # trust the timestamps over the stated duration where both exist and conflict
    df["resolution_hours"] = measured.where(measured.notna() & (measured >= 0), stated)
    stats["resolution_hours_usable"] = int(df["resolution_hours"].notna().sum())

    stats["duplicate_ticket_id"] = int(df["ticket_id"].duplicated().sum())
    df = df.drop_duplicates("ticket_id").reset_index(drop=True)
    stats["rows_out"] = len(df)
    report["tickets"] = stats
    logger.info("Tickets: %d issue variants -> %d, %d timelines reversed",
                stats["issue_raw"], stats["issue_clean"], stats["resolved_before_created"])
    return df


def clean_clickstream(path: Path, crm_devices: set[str], report: dict) -> pd.DataFrame:
    """Stream clickstream, check session/device keys, aggregate per customer_id."""
    logger.info("Clickstream: streaming %s in %s-row chunks", path.name, f"{CHUNK_SIZE:,}")
    stats: dict[str, object] = {
        "rows_in": 0, "anonymous": 0, "url_missing": 0, "ts_blank": 0,
        "ts_rescued": 0, "ts_unparseable": 0, "event_type_unknown": 0,
        "duplicate_event_id": 0, "devices_seen": 0, "devices_in_crm": 0,
    }
    seen_events: set[str] = set()
    session_customers: dict[str, set[str]] = {}
    devices: set[str] = set()
    parts: list[pd.DataFrame] = []

    for chunk in pd.read_csv(path, dtype=str, chunksize=CHUNK_SIZE):
        stats["rows_in"] += len(chunk)
        stats["anonymous"] += int(chunk["customer_id"].isna().sum())
        stats["url_missing"] += int(chunk["page_url"].isna().sum())

        ids = chunk["event_id"]
        stats["duplicate_event_id"] += int(ids.isin(seen_events).sum() + ids.duplicated().sum())
        seen_events.update(ids.dropna())
        devices.update(chunk["device_id"].dropna())

        # which customers each session_id touches
        for session, group in chunk.dropna(subset=["customer_id"]).groupby("session_id"):
            session_customers.setdefault(session, set()).update(group["customer_id"])

        chunk["timestamp"], ts_stats = parse_dates(chunk["timestamp"])
        stats["ts_blank"] += ts_stats["blank"]
        stats["ts_rescued"] += ts_stats["rescued"]
        stats["ts_unparseable"] += ts_stats["unparseable"]
        stats["event_type_unknown"] += int((~chunk["event_type"].isin(VALID_EVENT_TYPES)).sum())

        identified = chunk.dropna(subset=["customer_id"])
        parts.append(identified.groupby("customer_id").agg(
            events=("event_id", "count"),
            viewed=("event_type", lambda s: int((s == "page_view").any())),
            searched=("event_type", lambda s: int((s == "search").any())),
            carted=("event_type", lambda s: int((s == "add_to_cart").any())),
            logged_in=("event_type", lambda s: int((s == "login").any())),
            first_seen=("timestamp", "min"),
            last_seen=("timestamp", "max"),
        ).reset_index())

    # --- key validation, the part that decides which analyses are even permissible ---
    multi = sum(1 for customers in session_customers.values() if len(customers) > 1)
    stats["sessions_seen"] = len(session_customers)
    stats["sessions_with_multiple_customers"] = multi
    stats["session_id_is_valid_key"] = multi == 0
    stats["devices_seen"] = len(devices)
    stats["devices_in_crm"] = len(devices & crm_devices)
    stats["device_id_joins_to_crm"] = bool(devices & crm_devices)
    stats["events_per_device"] = round(stats["rows_in"] / len(devices), 2) if devices else None
    if multi:
        logger.warning(
            "session_id is NOT a session key: %d of %d values span several customers — "
            "no session-level funnel will be computed",
            multi, len(session_customers),
        )
    if not stats["devices_in_crm"]:
        logger.warning(
            "device_id shares no values with the %d devices registered in CRM "
            "(%.2f events per device id) — anonymous events cannot be attributed",
            len(crm_devices), stats["events_per_device"] or 0,
        )

    customers = pd.concat(parts, ignore_index=True).groupby("customer_id", as_index=False).agg(
        events=("events", "sum"),
        viewed=("viewed", "max"),
        searched=("searched", "max"),
        carted=("carted", "max"),
        logged_in=("logged_in", "max"),
        first_seen=("first_seen", "min"),
        last_seen=("last_seen", "max"),
    )
    stats["identified_events"] = int(stats["rows_in"]) - int(stats["anonymous"])
    stats["customers_seen"] = len(customers)
    stats["customers_with_cart"] = int(customers["carted"].sum())
    report["clickstream"] = stats
    logger.info("Clickstream: %s events -> %s identifiable customers (%.1f%% of events anonymous)",
                f"{stats['rows_in']:,}", f"{len(customers):,}",
                100 * int(stats["anonymous"]) / int(stats["rows_in"]))
    return customers


def build_kpis(crm, catalog, orders, tickets, visitors, report: dict) -> dict:
    """Derive the business figures, using only rows that survived cleaning."""
    ok = orders[orders["is_analysable"]].copy()
    ok = ok.merge(catalog[["product_id", "category", "price"]], on="product_id", how="left")

    successful = ok[ok["status"] == "success"]
    revenue = float(successful["order_amount"].sum())

    # orphan keys = join health
    crm_ids = set(crm["customer_id"])
    orphan_orders = int((~ok["customer_id"].isin(crm_ids)).sum())
    orphan_products = int((~ok["product_id"].isin(set(catalog["product_id"]))).sum())
    orphan_tickets = int((~tickets["customer_id"].isin(crm_ids)).sum())
    orphan_visitors = int((~visitors["customer_id"].isin(crm_ids)).sum())

    # conversion per customer (session_id is not a key)
    buyers = set(successful["customer_id"].dropna())
    carted = set(visitors.loc[visitors["carted"] == 1, "customer_id"])
    converted = carted & buyers

    by_payment = (successful.groupby("payment_method")
                  .agg(orders=("order_id", "count"), revenue=("order_amount", "sum"))
                  .sort_values("revenue", ascending=False).reset_index())
    by_category = (successful.dropna(subset=["category"]).groupby("category")
                   .agg(orders=("order_id", "count"), revenue=("order_amount", "sum"))
                   .sort_values("revenue", ascending=False).reset_index())
    by_month = (successful.assign(month=successful["order_date"].dt.to_period("M").astype(str))
                .groupby("month").agg(orders=("order_id", "count"),
                                      revenue=("order_amount", "sum")).reset_index())

    click = report["clickstream"]
    kpis = {
        "revenue_success": round(revenue, 2),
        "orders_success": int(len(successful)),
        "aov": round(revenue / len(successful), 2) if len(successful) else None,
        "status_share": {k: int(v) for k, v in ok["status"].value_counts().items()},
        "refund_rate_pct": round(100 * (ok["status"] == "refunded").mean(), 2),
        "failure_rate_pct": round(100 * (ok["status"] == "failed").mean(), 2),
        "visitors_identified": int(len(visitors)),
        "visitors_with_cart": len(carted),
        "visitors_who_bought": len(converted),
        "cart_to_purchase_pct": (round(100 * len(converted) / len(carted), 2)
                                 if carted else None),
        "unattributable_events": int(click["anonymous"]),
        "unattributable_pct": round(100 * int(click["anonymous"]) / int(click["rows_in"]), 1),
        "session_funnel_possible": bool(click["session_id_is_valid_key"]),
        "orphan_orders_customer": orphan_orders,
        "orphan_orders_product": orphan_products,
        "orphan_tickets_customer": orphan_tickets,
        "orphan_visitors_customer": orphan_visitors,
        "ticket_resolution_median_h": round(float(tickets["resolution_hours"].median()), 2),
        "tickets_by_issue": {k: int(v) for k, v in tickets["issue_type"].value_counts().items()},
        "sentiment_share": {k: int(v) for k, v in tickets["sentiment"].value_counts().items()},
        "top_payment": by_payment.iloc[0]["payment_method"] if len(by_payment) else None,
        "top_category": by_category.iloc[0]["category"] if len(by_category) else None,
    }
    report["kpis"] = kpis

    by_payment.to_csv(AGGREGATES / "revenue_by_payment.csv", index=False)
    by_category.to_csv(AGGREGATES / "revenue_by_category.csv", index=False)
    by_month.to_csv(AGGREGATES / "revenue_by_month.csv", index=False)
    report["by_payment"] = by_payment.to_dict("records")
    report["by_category"] = by_category.to_dict("records")
    report["by_month"] = by_month.to_dict("records")

    logger.info("KPIs: revenue %.0f over %d successful orders, AOV %.2f",
                revenue, len(successful), kpis["aov"] or 0)
    logger.info("Join integrity: %d orphan orders, %d orphan tickets, %d orphan visitors",
                orphan_orders, orphan_tickets, orphan_visitors)
    return kpis


def write_samples(source_dir: Path) -> None:
    """Commit a small slice of each raw file so the pipeline is runnable from the repo."""
    for name, filename in SOURCES.items():
        path = source_dir / filename
        if not path.exists():
            continue
        head = pd.read_csv(path, dtype=str, nrows=SAMPLE_ROWS)
        head.to_csv(SAMPLES / filename, index=False)
    logger.info("Samples: %d rows per file written to %s", SAMPLE_ROWS, SAMPLES.name)


def run(source_dir: Path, make_samples: bool) -> dict:  # noqa: C901
    missing = [f for f in SOURCES.values() if not (source_dir / f).exists()]
    if missing:
        raise SystemExit(
            f"Missing input files in {source_dir}: {', '.join(missing)}\n"
            "Set ECOM_RAW_DIR to the folder holding the exports, or run with --source samples."
        )

    report: dict = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "samples" if source_dir == SAMPLES else "full",
    }

    crm, crm_devices = clean_crm(source_dir / SOURCES["crm"], report)
    catalog, _ = clean_catalog(source_dir / SOURCES["catalog"], report)
    orders = clean_orders(source_dir / SOURCES["orders"], report)
    tickets = clean_tickets(source_dir / SOURCES["tickets"], report)
    visitors = clean_clickstream(source_dir / SOURCES["clickstream"], crm_devices, report)

    report["totals"] = {
        "rows_in": sum(report[k]["rows_in"] for k in
                       ("crm", "catalog", "orders", "tickets", "clickstream")),
        "tables": len(SOURCES),
    }
    build_kpis(crm, catalog, orders, tickets, visitors, report)

    # Full cleaned tables go to data/processed/, which is not versioned — CRM and tickets
    # alone are ~16 MB. A head of each lands in data/aggregates/ so the output shape is
    # reviewable straight from the repository.
    for name, frame in (("crm", crm), ("catalog", catalog), ("tickets", tickets),
                        ("orders", orders[orders["is_analysable"]]), ("visitors", visitors)):
        frame.to_csv(PROCESSED / f"{name}_clean.csv", index=False)
        frame.head(200).to_csv(AGGREGATES / f"{name}_clean_head.csv", index=False)

    out = REPORTS / "quality_report.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str),
                   encoding="utf-8")
    logger.info("Report: %s", out.relative_to(ROOT))

    if make_samples and source_dir != SAMPLES:
        write_samples(source_dir)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="E-commerce cleaning pipeline")
    parser.add_argument("--source", choices=("raw", "samples"), default="raw",
                        help="run against the full exports or the committed samples")
    parser.add_argument("--no-samples", action="store_true",
                        help="skip refreshing data/samples/")
    args = parser.parse_args()

    source_dir = SAMPLES if args.source == "samples" else RAW
    logger.info("Source: %s", source_dir)
    run(source_dir, make_samples=not args.no_samples)
    return 0


if __name__ == "__main__":
    sys.exit(main())
