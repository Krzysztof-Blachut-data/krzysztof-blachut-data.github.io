#!/usr/bin/env python3
"""Build ecom-data.js from quality_report.json + samples.

    python scripts/build_ecom_data.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import REPORTS, SAMPLES, SOURCES  # noqa: E402

OUT = ROOT / "ecom-data.js"
REPORT = REPORTS / "quality_report.json"
ID_CHARS = 8


def short(value, chars: int = ID_CHARS) -> str:
    text = "" if value is None or value != value else str(value)
    return text[:chars]


def pick_dirty(df: pd.DataFrame, checks: list, limit: int = 7) -> pd.DataFrame:
    """One row per defect mask, then fill with clean rows."""
    picked: list[int] = []
    for mask in checks:
        hits = df.index[mask.fillna(False) & ~df.index.isin(picked)]
        if len(hits):
            picked.append(hits[0])
    for idx in df.index:
        if len(picked) >= limit:
            break
        if idx not in picked:
            picked.append(idx)
    return df.loc[picked[:limit]]


def preview_crm() -> list[dict]:
    df = pd.read_csv(SAMPLES / SOURCES["crm"], dtype=str)
    first = df["first_name"].fillna("")
    last = df["last_name"].fillna("")
    rows = pick_dirty(df, [
        first.str.contains(r"(.)\1", regex=True),          # doubled letters
        first.ne(first.str.title()),                       # broken casing
        last.ne(last.str.strip()),                         # padding
        df["email"].isna(),                                # missing email
        df["device_id(s)"].fillna("").str.contains(";"),   # several devices in one cell
        df["customer_id"].duplicated(keep=False),          # duplicate id
    ])
    return [{
        "customer_id": short(r["customer_id"]),
        "first_name": r["first_name"] if r["first_name"] == r["first_name"] else "",
        "last_name": r["last_name"] if r["last_name"] == r["last_name"] else "",
        "email": r["email"] if r["email"] == r["email"] else "",
        "phone": r["phone_number"] if r["phone_number"] == r["phone_number"] else "",
        "source": r["source"] if r["source"] == r["source"] else "",
    } for _, r in rows.iterrows()]


def preview_catalog() -> list[dict]:
    df = pd.read_csv(SAMPLES / SOURCES["catalog"], dtype=str)
    cat = df["category"].fillna("")
    price = pd.to_numeric(df["price"].fillna("").str.replace(",", "", regex=False),
                          errors="coerce")
    rows = pick_dirty(df, [
        cat.str.contains(r"[0-9]"),                # leet spelling
        cat.str.len().between(1, 4),               # truncated label
        cat.ne(cat.str.strip()) | cat.str.contains(r"[-_]$"),
        cat.eq(""),                                # missing category
        price.le(0),                               # sentinel price
        price.isna() & df["price"].notna(),         # unparseable price
    ])
    return [{
        "product_id": r["product_id"],
        "product_name": r["product_name"] if r["product_name"] == r["product_name"] else "",
        "category": r["category"] if r["category"] == r["category"] else "",
        "price": r["price"] if r["price"] == r["price"] else "",
    } for _, r in rows.iterrows()]


def preview_orders() -> list[dict]:
    df = pd.read_csv(SAMPLES / SOURCES["orders"], dtype=str)
    amount = pd.to_numeric(df["order_amount"], errors="coerce")
    qty = pd.to_numeric(df["quantity"], errors="coerce")
    iso = pd.to_datetime(df["order_date"], format="ISO8601", errors="coerce")
    pay = df["payment_method"].fillna("")
    rows = pick_dirty(df, [
        pay.str.contains(r"[^a-z]", regex=True),    # CRAD, c@rd, wall-et, ' upi'
        df["status"].fillna("").ne(df["status"].fillna("").str.lower().str.strip()),
        iso.isna() & df["order_date"].notna(),      # date in another layout
        df["order_date"].isna(),                    # no date at all
        amount.le(0) | amount.isna(),               # bad amount
        qty.isna(),                                 # 'five' or blank quantity
        qty.le(0),                                  # negative quantity
    ], limit=8)
    return [{
        "order_id": short(r["order_id"]),
        "customer_id": short(r["customer_id"]),
        "product_id": r["product_id"] if r["product_id"] == r["product_id"] else "",
        "order_amount": r["order_amount"] if r["order_amount"] == r["order_amount"] else "",
        "order_date": r["order_date"] if r["order_date"] == r["order_date"] else "",
        "payment_method": r["payment_method"] if r["payment_method"] == r["payment_method"] else "",
        "status": r["status"] if r["status"] == r["status"] else "",
        "quantity": r["quantity"] if r["quantity"] == r["quantity"] else "",
    } for _, r in rows.iterrows()]


def preview_tickets() -> list[dict]:
    df = pd.read_csv(SAMPLES / SOURCES["tickets"], dtype=str)
    issue = df["issue_type"].fillna("")
    created = pd.to_datetime(df["ticket_created"], format="ISO8601", errors="coerce")
    resolved = pd.to_datetime(df["ticket_resolved"], format="ISO8601", errors="coerce")
    rows = pick_dirty(df, [
        issue.isin(["tnemyap", "dnufer", "tcudorp", "yaled"]),   # reversed word
        issue.str.contains(r"[0-9]"),                            # leet spelling
        issue.str.contains(r"[ _x]$|^ ", regex=True),             # suffix or padding noise
        df["ticket_created"].isna(),                             # no created timestamp
        created.isna() & df["ticket_created"].notna(),            # impossible timestamp
        resolved.lt(created),                                     # resolved before created
        df["sentiment"].fillna("").str.contains(r"[0-9]|^ | $"),
    ])
    return [{
        "ticket_id": short(r["ticket_id"]),
        "customer_id": short(r["customer_id"]),
        "issue_type": r["issue_type"] if r["issue_type"] == r["issue_type"] else "",
        "ticket_created": r["ticket_created"] if r["ticket_created"] == r["ticket_created"] else "",
        "ticket_resolved": r["ticket_resolved"] if r["ticket_resolved"] == r["ticket_resolved"] else "",
        "resolution_time_hours": (r["resolution_time_hours"]
                                  if r["resolution_time_hours"] == r["resolution_time_hours"] else ""),
        "sentiment": r["sentiment"] if r["sentiment"] == r["sentiment"] else "",
    } for _, r in rows.iterrows()]


def preview_clickstream() -> list[dict]:
    df = pd.read_csv(SAMPLES / SOURCES["clickstream"], dtype=str)
    ts = pd.to_datetime(df["timestamp"], format="ISO8601", errors="coerce")
    rows = pick_dirty(df, [
        df["customer_id"].isna(),                    # anonymous event
        df["page_url"].isna(),                       # no url
        ts.isna() & df["timestamp"].notna(),          # impossible timestamp
        df["event_type"].eq("add_to_cart"),
        df["event_type"].eq("search"),
    ], limit=6)
    return [{
        "event_id": short(r["event_id"]),
        "customer_id": short(r["customer_id"]),
        "event_type": r["event_type"] if r["event_type"] == r["event_type"] else "",
        "page_url": r["page_url"] if r["page_url"] == r["page_url"] else "",
        "timestamp": r["timestamp"] if r["timestamp"] == r["timestamp"] else "",
    } for _, r in rows.iterrows()]


def build_totals(rep: dict) -> dict:
    """Payload for ecom.js from the report."""
    crm, cat, ordr, tic, click = (rep["crm"], rep["catalog"], rep["orders"],
                                  rep["tickets"], rep["clickstream"])
    return {
        "rows": rep["totals"]["rows_in"],
        "tables": rep["totals"]["tables"],
        "crm": crm["rows_in"],
        "crmUnique": crm["rows_out"],
        "crmDups": crm["duplicate_customer_id"],
        "emailMissing": crm["email_missing"],
        "emailShared": crm["email_shared"],
        "nameFixes": crm["name_doubled_letters"] + crm["name_recased"] + crm["name_padding"],
        "catalog": cat["rows_in"],
        "categoriesRaw": cat["categories_raw"],
        "categoriesClean": cat["categories_clean"],
        "categoriesBlank": cat["category_rules"].get("missing", 0),
        "priceUnusable": cat["rows_in"] - cat["price_usable"],
        "orders": ordr["rows_in"],
        "statusRaw": ordr["status_raw"],
        "statusClean": ordr["status_clean"],
        "paymentRaw": ordr["payment_raw"],
        "paymentClean": ordr["payment_clean"],
        # split honestly: dates written in another layout are recovered, not lost
        "orderDateBad": ordr["date_blank"] + ordr["date_unparseable"],
        "orderDateRescued": ordr["date_rescued"],
        "orderAmountBad": ordr["amount_unparseable"] + ordr["amount_non_positive"],
        "orderQtyBad": ordr["quantity_unparseable"] + ordr["quantity_non_positive"],
        "ordersAnalysable": ordr["analysable"],
        "ordersQuarantined": ordr["quarantined"],
        "tickets": tic["rows_in"],
        "issueRaw": tic["issue_raw"],
        "issueClean": tic["issue_clean"],
        "sentimentRaw": tic["sentiment_raw"],
        "sentimentClean": tic["sentiment_clean"],
        "ticketsReversedTimeline": tic["resolved_before_created"],
        "ticketsDurationDisagrees": tic["resolution_time_disagrees"],
        "click": click["rows_in"],
        "clickAnon": click["anonymous"],
        "clickIdentified": click["identified_events"],
    }


def build() -> dict:
    rep = json.loads(REPORT.read_text(encoding="utf-8"))
    click = rep["clickstream"]
    return {
        "generatedAt": rep["generated_at"],
        "source": rep["source"],
        "totals": build_totals(rep),
        "kpis": rep["kpis"],
        # the key checks that decide which analyses are permissible at all
        "keys": {
            "sessionIdIsValid": click["session_id_is_valid_key"],
            "sessionsSeen": click["sessions_seen"],
            "sessionsMultiCustomer": click["sessions_with_multiple_customers"],
            "deviceIdJoinsToCrm": click["device_id_joins_to_crm"],
            "devicesInClickstream": click["devices_seen"],
            "devicesInCrm": rep["crm"]["devices_registered"],
            "eventsPerDevice": click["events_per_device"],
            "orphanOrders": rep["kpis"]["orphan_orders_customer"],
            "orphanTickets": rep["kpis"]["orphan_tickets_customer"],
            "orphanVisitors": rep["kpis"]["orphan_visitors_customer"],
        },
        # how each vocabulary was repaired, rule by rule
        "rules": {
            "category": rep["catalog"]["category_rules"],
            "payment": rep["orders"]["payment_rules"],
            "status": rep["orders"]["status_rules"],
            "issue": rep["tickets"]["issue_rules"],
            "sentiment": rep["tickets"]["sentiment_rules"],
        },
        "dateFormats": rep["orders"]["date_formats"],
        "byPayment": rep["by_payment"],
        "byCategory": rep["by_category"],
        "byMonth": rep["by_month"],
        "preview": {
            "crm": preview_crm(),
            "catalog": preview_catalog(),
            "orders": preview_orders(),
            "tickets": preview_tickets(),
            "clickstream": preview_clickstream(),
        },
    }


def main() -> int:
    if not REPORT.exists():
        sys.stderr.write(f"missing {REPORT} — run pipeline.py first\n")
        return 1
    data = build()
    payload = json.dumps(data, indent=2, ensure_ascii=False, default=str)
    OUT.write_text(
        "// Generated by scripts/build_ecom_data.py — do not edit by hand.\n"
        "// Counts come from data/reports/quality_report.json; preview rows are real rows\n"
        "// taken from data/samples/, selected to show one instance of each defect.\n"
        f"window.ECOM_DATA = {payload};\n"
        "window.ECOM_STATS = { totals: window.ECOM_DATA.totals };\n"
        "window.ECOM_PREVIEW = window.ECOM_DATA.preview;\n",
        encoding="utf-8",
    )
    t = data["totals"]
    print(f"wrote {OUT.name} — {t['rows']:,} rows across {t['tables']} files")
    print(f"  orders analysable {t['ordersAnalysable']:,} / quarantined {t['ordersQuarantined']:,}")
    print(f"  session_id valid key: {data['keys']['sessionIdIsValid']}, "
          f"device join: {data['keys']['deviceIdJoinsToCrm']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
