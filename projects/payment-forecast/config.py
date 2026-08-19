"""Paths and source for the AR payment-forecast project."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
RAW = DATA / "raw"
PROCESSED = DATA / "processed"
REPORTS = DATA / "reports"
SAMPLES = DATA / "samples"

for folder in (RAW, PROCESSED, REPORTS, SAMPLES):
    folder.mkdir(parents=True, exist_ok=True)

SOURCE_URL = (
    "https://raw.githubusercontent.com/SkywalkerHub/"
    "Payment-Date-Prediction/main/Dataset.csv"
)
RAW_CSV = RAW / "invoices_raw.csv"
CLEAN_CSV = PROCESSED / "invoices_clean.csv"
OPEN_PRIORITY_CSV = PROCESSED / "open_priority.csv"
REPORT_JSON = REPORTS / "analysis_report.json"

# holdout share for prediction check (by clear_date order)
HOLDOUT_FRAC = 0.2
RANDOM_SEED = 42
