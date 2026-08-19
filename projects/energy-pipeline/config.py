"""Configuration for the energy market ETL pipeline."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
RAW = DATA / "raw"
PROCESSED = DATA / "processed"
DATABASE = DATA / "database"

EIA_SERIES = {"brent": "RBRTE", "wti": "RWTC"}

# public hist_xls (no API key). daily = previous business day; monthly closes later
EIA_PUBLIC_BASE = "https://www.eia.gov/dnav/pet/hist_xls/"
EIA_PUBLIC_XLS = {
    "monthly": {"RBRTE": "RBRTEm", "RWTC": "RWTCm"},
    "daily": {"RBRTE": "RBRTEd", "RWTC": "RWTCd"},
}
NBP_TABLE = "A"
NBP_CURRENCIES = ("usd", "eur")
LITRE_PER_BBL = 158.987

# pinned EC bulletin edition (no stable "latest" URL). history lives in fuel_poland_monthly.csv
EU_FUEL_BULLETIN_EDITION = "2024-02-19"

EU_FUEL_WITH_TAX_URL = (
    "https://energy.ec.europa.eu/document/download/"
    "264c2d0f-f161-4ea3-a777-78faae59bea0_en"
    "?filename=Weekly%20Oil%20Bulletin%20Weekly%20prices%20with%20Taxes%20-%202024-02-19.xlsx"
)

EU_FUEL_NO_TAX_URL = (
    "https://energy.ec.europa.eu/document/download/"
    "78311f92-68f8-4b82-b5cf-1293beeaae77_en"
    "?filename=Weekly%20Oil%20Bulletin%20Weekly%20prices%20without%20taxes%20-%202024-02-19.xlsx"
)
