# E-commerce cleaning pipeline

Cleans five linked exports — CRM, product catalog, orders, support tickets and clickstream —
totalling **880,500 rows**, and derives every figure the portfolio page reports.

## Running it

```bash
pip install -r requirements.txt

# against the committed 2,000-row samples — works straight from a clone
python pipeline.py --source samples

# against the full exports
$env:ECOM_RAW_DIR = "C:\path\to\exports"   # PowerShell
python pipeline.py

python scripts/build_ecom_data.py          # regenerates ecom-data.js
python -m pytest -q                        # 51 tests
```

`scripts/profile_raw.py` prints the raw distributions the cleaning vocabularies are based on.
Run it first if the exports are ever replaced.

## Why the raw files are not in the repository

The five exports total ~180 MB and `clickstream_500k_events.csv` alone is 127 MB, above
GitHub's 100 MB per-file limit. `data/samples/` therefore holds a 2,000-row slice of each
file (1.5 MB), enough to exercise every cleaning rule.

| Folder | Versioned | Contents |
|--------|-----------|----------|
| `data/raw/` | no | the full exports, if you place them here |
| `data/samples/` | yes | 2,000 rows per file, so the pipeline runs from a clone |
| `data/processed/` | no | full cleaned tables (~16 MB) |
| `data/aggregates/` | yes | revenue breakdowns and 200-row heads of each cleaned table |
| `data/reports/` | yes | `quality_report.json` — the source of every published number |

## What the cleaning actually does

Labels are resolved to fixed vocabularies by ordered rules rather than a lookup table of
misspellings, because 47 category variants and 35 issue-type variants exist across only 12
real labels. Each rule is counted, so the report shows how every row was resolved:

| Rule | Example | Fixes |
|------|---------|-------|
| casing / padding | `UPI `, `mARIA` | 90,000+ order labels |
| punctuation | `wall-et`, `clothing_` | 10,631 payments |
| leet substitution | `3l3ctronics`, `c@rd`, `n3gativ3` | 10,684 payments, 23 categories |
| reversal | `tnemyap` → `payment` | 1,127 ticket issues |
| unique prefix | `pro` → `product`, `bea` → `beauty` | 38,535 order statuses |
| alias | `CRAD`, `cd` → `card` | 21,436 payments |

Nothing is guessed. A truncation matching two labels is left missing, and no vocabulary
finishes with unresolved rows — a test enforces that.

### Repairs worth noting

- **36,160 order dates are recovered, not discarded.** `2024/31/01` and `31-12-2023` look
  corrupt only because they are `%Y/%d/%m` and `%d-%m-%Y`. Treating them as unparseable
  would have thrown away 12% of the order book.
- **Doubled letters are collapsed conservatively.** `KKeevvin` → `Kevin`, but `Aaron` and
  `Emma` are left alone: the rule fires only on strings with two or more doubled runs, so a
  few corrupted values survive rather than clean names being damaged.
- **Impossible timestamps stay missing.** `2025-12-12T28:77:10` and `31-15-2023` are not
  repairable and are never invented.

## Two join keys that do not hold up

The interesting result is negative, and it decides which analyses are permissible:

- **`session_id` is not a session key.** All 8,000 values span several customers, so a
  session-level funnel would be arithmetic over a meaningless grouping. Conversion is
  therefore measured per customer.
- **`device_id` does not join to CRM.** The clickstream contains 498,949 device ids across
  500,000 events — 1.0 events per id — and none of them appear among the 51,854 devices
  registered in CRM. The 150,553 events with no `customer_id` (30.1%) are consequently
  **unattributable**, and are reported as such instead of being dropped or imputed.

`customer_id` does hold up: orders, tickets and identified clickstream events all join to
CRM with zero orphans.

## A note on magnitudes

The exports are synthetic. Order amounts reach five figures and the catalog contains prices
up to 851,374, so revenue and average order value are arithmetically correct but not
realistic, and carry no currency. The cleaning and key-integrity findings are the point;
the monetary totals are not a business result.
