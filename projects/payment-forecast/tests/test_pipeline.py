"""Tests for payment-forecast cleaning + report invariants."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]

sys.path.insert(0, str(ROOT))
for _shadowed in ("config", "pipeline"):
    sys.modules.pop(_shadowed, None)

from config import CLEAN_CSV, REPORT_JSON, SAMPLES  # noqa: E402
from pipeline import analyse, build_predictor, load_raw, parse_ymd, score_open, transform  # noqa: E402


@pytest.fixture(scope="module")
def sample_df() -> pd.DataFrame:
    path = SAMPLES / "invoices_2000.csv"
    if not path.exists():
        pytest.skip("run pipeline.py once to create the sample")
    return load_raw(path)


@pytest.fixture(scope="module")
def clean(sample_df: pd.DataFrame) -> pd.DataFrame:
    out, _ = transform(sample_df)
    return out


@pytest.fixture(scope="module")
def report() -> dict:
    if not REPORT_JSON.exists():
        pytest.skip("run pipeline.py first")
    return json.loads(REPORT_JSON.read_text(encoding="utf-8"))


def test_parse_ymd():
    s = parse_ymd(pd.Series([20190307.0, 20190101]))
    assert s.iloc[0] == pd.Timestamp("2019-03-07")
    assert s.iloc[1] == pd.Timestamp("2019-01-01")


def test_transform_has_cycle_cols(clean: pd.DataFrame):
    for col in ("days_to_pay", "days_late", "credit_days", "is_open", "is_late"):
        assert col in clean.columns


def test_open_rows_lack_clear_metrics(clean: pd.DataFrame):
    open_rows = clean.loc[clean["is_open"]]
    if open_rows.empty:
        pytest.skip("no open rows in sample")
    assert open_rows["days_to_pay"].isna().all()
    assert open_rows["clear_date"].isna().all()


def test_closed_days_non_negative(clean: pd.DataFrame):
    closed = clean.loc[~clean["is_open"]]
    assert (closed["days_to_pay"] >= 0).all()


def test_predictor_beats_or_matches_naive(clean: pd.DataFrame):
    closed = clean.loc[~clean["is_open"]]
    if len(closed) < 200:
        pytest.skip("sample too small")
    _, _, meta = build_predictor(closed)
    assert meta["mae_days"] <= meta["naive_mae_days"] + 0.05


def test_report_totals(report: dict):
    t = report["totals"]
    assert t["rows"] == t["closed"] + t["open"]
    assert t["rows"] == 50_000
    assert t["open"] > 0
    assert 0.3 < report["cycle"]["late_rate"] < 0.6


def test_report_prediction_lift(report: dict):
    p = report["prediction"]
    assert p["mae_days"] < p["naive_mae_days"]
    assert p["lift_vs_naive"] > 0


def test_payment_data_js_exists():
    js = ROOT / "payment-data.js"
    if not js.exists():
        pytest.skip("run scripts/build_payment_data.py")
    text = js.read_text(encoding="utf-8")
    assert "window.__PAYMENT_DATA" in text
    assert "late_rate" in text


def test_priority_is_predicted_days_times_amount():
    open_inv = pd.DataFrame({
        "cust_number": ["A", "B"],
        "cust_payment_terms": ["NA10", "CA10"],
        "total_open_amount": [1000.0, 400.0],
        "posting_date": pd.to_datetime(["2020-03-01", "2020-04-01"]),
        "due_in_date": pd.to_datetime(["2020-03-15", "2020-04-15"]),
    })
    scored = score_open(
        open_inv,
        cust_med={"A": 20.0},
        term_med={"CA10": 10.0},
        global_med=15.0,
        as_of=pd.Timestamp("2020-05-19"),
    )
    assert scored.iloc[0]["cust_number"] == "A"
    assert scored.iloc[0]["priority_score"] == 20000.0
    assert scored.iloc[1]["priority_score"] == 4000.0


def test_analyse_open_aging(clean: pd.DataFrame):
    report, closed, open_inv = analyse(clean)
    assert "open_aging" in report
    assert len(closed) + len(open_inv) == len(clean)
