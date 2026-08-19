"""Paths + cleaning vocabularies.

Raw exports (~180 MB) are not in git — set ECOM_RAW_DIR. Site uses data/ artefacts.
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
RAW = Path(os.environ.get("ECOM_RAW_DIR", DATA / "raw"))
SAMPLES = DATA / "samples"
PROCESSED = DATA / "processed"
REPORTS = DATA / "reports"
AGGREGATES = DATA / "aggregates"

for folder in (SAMPLES, PROCESSED, REPORTS, AGGREGATES):
    folder.mkdir(parents=True, exist_ok=True)

SOURCES = {
    "crm": "crm_50000_customers_dirty_v3.csv",
    "catalog": "product_catalog_dirty_30pct.csv",
    "orders": "orders_300k_dirty.csv",
    "tickets": "support_tickets_30000_dirty.csv",
    "clickstream": "clickstream_500k_events.csv",
}

# clickstream is 127 MB; read it in chunks so the pipeline runs in modest memory
CHUNK_SIZE = 100_000

SAMPLE_ROWS = 2_000

# target labels; variants via Normaliser rules + ALIASES (from profile_raw.py)
CATEGORIES = ("clothing", "kitchen", "beauty", "automotive", "toys", "sports", "home",
              "electronics")
PAYMENTS = ("card", "cash", "wallet", "upi")
STATUSES = ("success", "failed", "refunded")
ISSUES = ("payment", "refund", "delay", "product")
SENTIMENTS = ("positive", "negative", "neutral")

# spellings rules can't fix. truncations like 'ref' stay out (prefix rule handles them)
ALIASES = {
    "crad": "card",
    "cd": "card",
    "uip": "upi",
    "walet": "wallet",
    "csah": "cash",
    "faild": "failed",
    "sucess": "success",
}

# Suffix noise appended to otherwise valid labels, e.g. 'productx', 'refund_'
TRAILING_NOISE = ("x", "_", "-", ".")

LEET = str.maketrans({"3": "e", "0": "o", "1": "l", "4": "a", "5": "s", "$": "s", "@": "a"})

# Values that mean "no data" but arrive as text
NULL_TOKENS = {"", "na", "n/a", "nan", "none", "null", "-", "--", "?", "unknown", "missing"}

# Sentinels used in place of a real number
PRICE_SENTINELS = {-100.0, -1.0, 0.0, 9999999.0}

VALID_EVENT_TYPES = {"page_view", "search", "add_to_cart", "login", "checkout", "purchase"}
