#!/usr/bin/env python3
"""Build payment-data.js from analysis_report.json."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from config import REPORT_JSON  # noqa: E402

OUT = ROOT / "payment-data.js"


def main() -> None:
    report = json.loads(REPORT_JSON.read_text(encoding="utf-8"))
    # slim payload for the page
    payload = {
        "asOf": report["as_of"],
        "source": report["source"],
        "totals": report["totals"],
        "cycle": report["cycle"],
        "prediction": report["prediction"],
        "scenario": report["scenario"],
        "byTerms": report["by_terms"][:8],
        "byCurrency": report["by_currency"],
        "openAging": report["open_aging"],
        "topLateCustomers": report["top_late_customers"][:8],
        "monthly": report["monthly"],
        "openPriority": report["open_priority_top"],
        "cleaning": report.get("cleaning", {}),
    }
    body = "window.__PAYMENT_DATA = " + json.dumps(payload, ensure_ascii=False) + ";\n"
    OUT.write_text(body, encoding="utf-8")
    print(f"wrote {OUT.name} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
