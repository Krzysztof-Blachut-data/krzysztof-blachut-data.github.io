#!/usr/bin/env python3
"""Profile raw CSVs (feeds vocabularies in config.py).

    python scripts/profile_raw.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import CHUNK_SIZE, RAW, SOURCES  # noqa: E402


def show(title: str, series: pd.Series, limit: int = 60) -> None:
    counts = series.value_counts(dropna=False)
    print(f"\n--- {title}: {len(counts)} distinct")
    for value, count in counts.head(limit).items():
        print(f"    {count:>8,}  {value!r}")
    if len(counts) > limit:
        print(f"    ... {len(counts) - limit} more")


def main() -> int:
    print("=" * 70)
    print("CATALOG")
    cat = pd.read_csv(RAW / SOURCES["catalog"], dtype=str)
    show("category", cat["category"])
    print("\n--- price oddities")
    price = pd.to_numeric(cat["price"].str.replace(",", "", regex=False), errors="coerce")
    print(f"    unparseable : {price.isna().sum()}")
    print(f"    <= 0        : {(price <= 0).sum()}")
    print(f"    min / max   : {price.min()} / {price.max()}")
    show("price raw values that fail to parse",
         cat.loc[price.isna(), "price"], limit=20)
    print(f"    duplicate product_id: {cat['product_id'].duplicated().sum()}")

    print("\n" + "=" * 70)
    print("ORDERS")
    orders = pd.read_csv(RAW / SOURCES["orders"], dtype=str)
    show("payment_method", orders["payment_method"])
    show("status", orders["status"])
    print("\n--- amount / quantity / date")
    amount = pd.to_numeric(orders["order_amount"], errors="coerce")
    qty = pd.to_numeric(orders["quantity"], errors="coerce")
    print(f"    amount unparseable: {amount.isna().sum()}   <=0: {(amount <= 0).sum()}")
    print(f"    qty unparseable   : {qty.isna().sum()}   <=0: {(qty <= 0).sum()}")
    show("quantity non-numeric raw", orders.loc[qty.isna(), "quantity"], limit=15)
    iso = pd.to_datetime(orders["order_date"], format="ISO8601", errors="coerce")
    print(f"    date ISO-unparseable: {iso.isna().sum()}")
    show("date raw values failing ISO", orders.loc[iso.isna(), "order_date"], limit=25)
    print(f"    duplicate order_id: {orders['order_id'].duplicated().sum()}")

    print("\n" + "=" * 70)
    print("CRM")
    crm = pd.read_csv(RAW / SOURCES["crm"], dtype=str)
    print(f"    rows: {len(crm)}")
    print(f"    duplicate customer_id : {crm['customer_id'].duplicated().sum()}")
    print(f"    missing email         : {crm['email'].isna().sum()}")
    dup_email = crm["email"].str.lower().str.strip()
    print(f"    duplicate email       : {dup_email.duplicated(keep='first').sum()}")
    show("gender", crm["gender"])
    show("source", crm["source"])
    doubled = crm["first_name"].fillna("").str.contains(r"(.)\1", regex=True).sum()
    print(f"    names with doubled letters (e.g. KKeevvin): {doubled}")
    print(f"    names needing case fix : "
          f"{(crm['first_name'].fillna('') != crm['first_name'].fillna('').str.title()).sum()}")
    print(f"    names with edge spaces : "
          f"{(crm['last_name'].fillna('') != crm['last_name'].fillna('').str.strip()).sum()}")
    print(f"    multi-device rows      : "
          f"{crm['device_id(s)'].fillna('').str.contains(';').sum()}")
    dob = pd.to_datetime(crm["dob"], errors="coerce")
    signup = pd.to_datetime(crm["signup_date"], errors="coerce")
    print(f"    dob unparseable        : {dob.isna().sum()}")
    print(f"    signup unparseable     : {signup.isna().sum()}")
    print(f"    signup before dob      : {(signup < dob).sum()}")

    print("\n" + "=" * 70)
    print("TICKETS")
    tickets = pd.read_csv(RAW / SOURCES["tickets"], dtype=str)
    show("issue_type", tickets["issue_type"])
    show("sentiment", tickets["sentiment"])
    created = pd.to_datetime(tickets["ticket_created"], format="ISO8601", errors="coerce")
    resolved = pd.to_datetime(tickets["ticket_resolved"], format="ISO8601", errors="coerce")
    print(f"\n    created unparseable : {created.isna().sum()}")
    print(f"    resolved unparseable: {resolved.isna().sum()}")
    show("created raw failing ISO", tickets.loc[created.isna(), "ticket_created"], limit=20)
    print(f"    resolved before created: {(resolved < created).sum()}")
    print(f"    agent with edge spaces : "
          f"{(tickets['support_agent'].fillna('') != tickets['support_agent'].fillna('').str.strip()).sum()}")

    print("\n" + "=" * 70)
    print("CLICKSTREAM (chunked)")
    n = 0
    anon = 0
    event_types: dict[str, int] = {}
    bad_ts = 0
    dup_ids: set[str] = set()
    seen_ids: set[str] = set()
    runs: dict[str, int] = {}
    empty_url = 0
    for chunk in pd.read_csv(RAW / SOURCES["clickstream"], dtype=str, chunksize=CHUNK_SIZE):
        n += len(chunk)
        anon += chunk["customer_id"].isna().sum()
        empty_url += chunk["page_url"].isna().sum()
        for value, count in chunk["event_type"].value_counts(dropna=False).items():
            event_types[str(value)] = event_types.get(str(value), 0) + int(count)
        for value, count in chunk["ingest_run_id"].value_counts(dropna=False).items():
            runs[str(value)] = runs.get(str(value), 0) + int(count)
        bad_ts += pd.to_datetime(chunk["timestamp"], format="ISO8601", errors="coerce").isna().sum()
        ids = set(chunk["event_id"])
        dup_ids |= seen_ids & ids
        seen_ids |= ids
    print(f"    rows                : {n:,}")
    print(f"    missing customer_id : {anon:,} ({anon / n:.1%})")
    print(f"    missing page_url    : {empty_url:,}")
    print(f"    unparseable ts      : {bad_ts:,}")
    print(f"    duplicate event_id  : {len(dup_ids):,}")
    print(f"    event_type          : {event_types}")
    print(f"    ingest runs         : {len(runs)} -> {runs}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
