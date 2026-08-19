"""Unit tests for cleaning rules + consistency checks on quality_report.json."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]

# avoid colliding with energy-pipeline's config.py / pipeline.py
sys.path.insert(0, str(ROOT))
for _shadowed in ("config", "normalise", "pipeline"):
    sys.modules.pop(_shadowed, None)

from config import CATEGORIES, ISSUES, PAYMENTS, REPORTS, SENTIMENTS, STATUSES  # noqa: E402
from normalise import Normaliser  # noqa: E402
from pipeline import clean_text_name, parse_dates  # noqa: E402

REPORT_PATH = REPORTS / "quality_report.json"


@pytest.fixture(scope="module")
def report() -> dict:
    if not REPORT_PATH.exists():
        pytest.skip("Run pipeline.py first")
    return json.loads(REPORT_PATH.read_text(encoding="utf-8"))


@pytest.fixture()
def full_report(report: dict) -> dict:
    """Skip when report came from samples (absolute counts need full run)."""
    if report.get("source") != "full":
        pytest.skip("report was generated from samples")
    return report


# --- normalisation rules ----------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("card", "card"),          # already canonical
    ("CRAD", "card"),          # transposed, via alias
    ("c@rd", "card"),          # '@' stands for 'a'
    ("wall-et", "wallet"),     # internal punctuation
    (" upi", "upi"),           # padding
    ("UPI ", "upi"),           # padding plus casing
    ("cd", "card"),            # dropped letters, via alias
])
def test_payment_variants(raw, expected):
    assert Normaliser(PAYMENTS)(raw) == expected


@pytest.mark.parametrize("raw,expected", [
    ("3l3ctronics", "electronics"),   # leet digits
    ("kitch3n", "kitchen"),
    ("clo", "clothing"),              # unique prefix
    ("bea", "beauty"),
    ("clothing-", "clothing"),        # trailing punctuation
    ("home_", "home"),
    ("BEAUTY", "beauty"),
])
def test_category_variants(raw, expected):
    assert Normaliser(CATEGORIES)(raw) == expected


@pytest.mark.parametrize("raw,expected", [
    ("tnemyap", "payment"),   # written backwards
    ("dnufer", "refund"),
    ("tcudorp", "product"),
    ("yaled", "delay"),
    ("paym3nt", "payment"),
    ("productx", "product"),  # suffix noise
    ("pro", "product"),       # unique prefix
])
def test_issue_variants(raw, expected):
    assert Normaliser(ISSUES)(raw) == expected


def test_prefix_rule_respects_its_vocabulary():
    """'ref' -> refunded (status) vs refund (issue)."""
    assert Normaliser(STATUSES)("REF") == "refunded"
    assert Normaliser(ISSUES)("ref") == "refund"


def test_unknown_values_are_not_guessed():
    norm = Normaliser(PAYMENTS)
    assert norm("bitcoin") is None
    assert norm.rules["unresolved"] == 1


def test_ambiguous_prefix_is_refused():
    """Ambiguous prefix -> None."""
    norm = Normaliser(("refund", "refresh"))
    assert norm("ref") is None


def test_rule_counts_are_per_row_not_per_distinct_value():
    norm = Normaliser(PAYMENTS)
    for _ in range(5):
        norm("CRAD")
    assert norm.rules["alias"] == 5


def test_sentiment_leet_and_padding():
    norm = Normaliser(SENTIMENTS)
    assert norm("n3gativ3") == "negative"
    assert norm(" positive") == "positive"
    assert norm("neu") == "neutral"


# --- text and date repair ---------------------------------------------------------

def test_doubled_letters_are_collapsed():
    out, stats = clean_text_name(pd.Series(["KKeevvin", "MMaarriiaa"]))
    assert list(out) == ["Kevin", "Maria"]
    assert stats["doubled_letters"] == 2


def test_legitimate_double_letters_survive():
    """Single doubled run stays (Aaron/Emma)."""
    out, _ = clean_text_name(pd.Series(["Aaron", "Emma", "Lloyd", "Beaautiful"]))
    assert list(out) == ["Aaron", "Emma", "Lloyd", "Beaautiful"]


def test_casing_and_padding_are_fixed():
    out, stats = clean_text_name(pd.Series(["mARIA", " Cantu"]))
    assert list(out) == ["Maria", "Cantu"]
    assert stats["padding"] == 1


def test_swapped_day_month_is_recovered_not_dropped():
    """%Y/%d/%m rescue."""
    parsed, stats = parse_dates(pd.Series(["2024/31/01"]))
    assert parsed.iloc[0] == pd.Timestamp("2024-01-31")
    assert stats["rescued"] == 1


def test_alternative_layouts_are_recovered():
    parsed, stats = parse_dates(pd.Series(["31-12-2023", "2025-07-29"]))
    assert parsed.iloc[0] == pd.Timestamp("2023-12-31")
    assert parsed.iloc[1] == pd.Timestamp("2025-07-29")
    assert stats["iso"] == 1 and stats["rescued"] == 1


def test_impossible_timestamps_stay_missing():
    """Impossible times stay NaT."""
    parsed, stats = parse_dates(pd.Series(["2025-12-12T28:77:10", "31-15-2023"]))
    assert parsed.isna().all()
    assert stats["unparseable"] == 2


def test_blank_and_absent_are_counted_apart_from_corrupt():
    _, stats = parse_dates(pd.Series(["", None, "2024/31/01"]))
    assert stats["blank"] == 2
    assert stats["unparseable"] == 0


# --- report consistency -----------------------------------------------------------

def test_row_total_matches_the_five_files(full_report):
    parts = sum(full_report[k]["rows_in"] for k in
                ("crm", "catalog", "orders", "tickets", "clickstream"))
    assert full_report["totals"]["rows_in"] == parts == 880_500


def test_crm_dedup_arithmetic(report):
    crm = report["crm"]
    assert crm["rows_in"] - crm["duplicate_customer_id"] == crm["rows_out"]


def test_every_label_resolved_to_a_canonical_value(report):
    """No unresolved labels in vocab rules."""
    for table, field in (("catalog", "category_rules"), ("orders", "payment_rules"),
                         ("orders", "status_rules"), ("tickets", "issue_rules"),
                         ("tickets", "sentiment_rules")):
        assert report[table][field].get("unresolved", 0) == 0, f"{table}.{field}"


def test_canonical_counts_are_the_expected_vocabularies(report):
    assert report["catalog"]["categories_clean"] == len(CATEGORIES)
    assert report["orders"]["payment_clean"] == len(PAYMENTS)
    assert report["orders"]["status_clean"] == len(STATUSES)
    assert report["tickets"]["issue_clean"] == len(ISSUES)
    assert report["tickets"]["sentiment_clean"] == len(SENTIMENTS)


def test_cleaning_actually_reduced_variant_counts(report):
    assert report["catalog"]["categories_raw"] > report["catalog"]["categories_clean"]
    assert report["orders"]["status_raw"] > report["orders"]["status_clean"]
    assert report["tickets"]["issue_raw"] > report["tickets"]["issue_clean"]


def test_rule_counts_sum_to_row_count(report):
    """Rule counts sum to rows_in."""
    assert sum(report["orders"]["status_rules"].values()) == report["orders"]["rows_in"]
    assert sum(report["catalog"]["category_rules"].values()) == report["catalog"]["rows_in"]


def test_date_accounting_is_complete(report):
    o = report["orders"]
    assert o["date_iso"] + o["date_blank"] + o["date_rescued"] + o["date_unparseable"] \
        == o["rows_in"]


def test_rescued_dates_are_not_silently_dropped(full_report):
    """Most non-ISO dates get rescued."""
    assert full_report["orders"]["date_rescued"] > 30_000


def test_quarantine_accounting(report):
    o = report["orders"]
    assert o["analysable"] + o["quarantined"] == o["rows_out"]


def test_session_id_was_rejected_as_a_key(report):
    """session_id is not a valid key."""
    click = report["clickstream"]
    assert click["session_id_is_valid_key"] is False
    assert click["sessions_with_multiple_customers"] > 0
    assert report["kpis"]["session_funnel_possible"] is False


def test_every_session_id_mixes_customers_in_the_full_export(full_report):
    click = full_report["clickstream"]
    assert click["sessions_with_multiple_customers"] == click["sessions_seen"] == 8_000


def test_device_id_does_not_join_and_is_reported_as_such(report):
    click = report["clickstream"]
    assert click["device_id_joins_to_crm"] is False
    assert click["devices_in_crm"] == 0


def test_anonymous_events_are_reported_not_absorbed(report):
    click = report["clickstream"]
    assert click["anonymous"] + click["identified_events"] == click["rows_in"]
    assert report["kpis"]["unattributable_events"] == click["anonymous"]


def test_conversion_is_scoped_to_identifiable_visitors(report):
    k = report["kpis"]
    assert k["visitors_who_bought"] <= k["visitors_with_cart"] <= k["visitors_identified"]
    assert 0 < k["cart_to_purchase_pct"] <= 100


def test_no_orphan_keys_between_files(full_report):
    k = full_report["kpis"]
    for field in ("orphan_orders_customer", "orphan_orders_product",
                  "orphan_tickets_customer", "orphan_visitors_customer"):
        assert k[field] == 0, field


def test_revenue_uses_only_successful_orders(report):
    k = report["kpis"]
    assert k["orders_success"] == k["status_share"]["success"]
    assert k["revenue_success"] > 0
    assert k["aov"] == pytest.approx(k["revenue_success"] / k["orders_success"], rel=1e-6)


def test_status_rates_sum_below_one_hundred(report):
    k = report["kpis"]
    assert k["refund_rate_pct"] + k["failure_rate_pct"] < 100


def test_generated_js_matches_the_report(full_report):
    """ecom-data.js matches report."""
    report = full_report
    js = (ROOT / "ecom-data.js")
    if not js.exists():
        pytest.skip("Run scripts/build_ecom_data.py first")
    text = js.read_text(encoding="utf-8")
    payload = json.loads(text[text.index("{"):text.index("};\nwindow.ECOM_STATS") + 1])
    assert payload["totals"]["rows"] == report["totals"]["rows_in"]
    assert payload["totals"]["crmDups"] == report["crm"]["duplicate_customer_id"]
    assert payload["totals"]["clickAnon"] == report["clickstream"]["anonymous"]
    assert payload["kpis"]["aov"] == report["kpis"]["aov"]


def test_preview_rows_come_from_the_samples():
    """Sample preview rows exist in CSV."""
    js = ROOT / "ecom-data.js"
    samples = ROOT / "data" / "samples" / "orders_300k_dirty.csv"
    if not (js.exists() and samples.exists()):
        pytest.skip("Run the pipeline and generator first")
    text = js.read_text(encoding="utf-8")
    payload = json.loads(text[text.index("{"):text.index("};\nwindow.ECOM_STATS") + 1])
    real = set(pd.read_csv(samples, dtype=str)["order_id"].str[:8])
    shown = {row["order_id"] for row in payload["preview"]["orders"]}
    assert shown <= real, f"fabricated preview ids: {shown - real}"
