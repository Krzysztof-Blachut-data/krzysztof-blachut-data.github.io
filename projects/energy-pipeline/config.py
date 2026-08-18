"""Configuration for the energy market ETL pipeline."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
RAW = DATA / "raw"
PROCESSED = DATA / "processed"
DATABASE = DATA / "database"

EIA_SERIES = {"brent": "RBRTE", "wti": "RWTC"}
NBP_TABLE = "A"
NBP_CURRENCY = "USD"
LITRE_PER_BBL = 158.987

EU_FUEL_WITH_TAX_URL = (
    "https://energy.ec.europa.eu/document/download/"
    "264c2d0f-f161-4ea3-a777-78faae59bea0_en"
    "?filename=Weekly%20Oil%20Bulletin%20Weekly%20prices%20with%20Taxes%20-%202024-02-19.xlsx"
)
