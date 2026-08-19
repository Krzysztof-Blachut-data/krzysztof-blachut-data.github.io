# Krzysztof Blachut — Data Analyst Portfolio

Live site: **https://krzysztof-blachut-data.github.io**

A static, bilingual (PL/EN) portfolio built without a framework. Each project is a working
artifact rather than a screenshot: the cleaning walkthroughs run in the browser, the
dashboards call live public APIs, and the ETL pipeline is a runnable Python script.

## Projects

| # | Project | Skill demonstrated | Stack |
|---|---------|-------------------|-------|
| 01 | Laboratory Data Cleaning | Data quality | Python, Pandas (walkthrough reimplemented in JS) |
| 02 | E-commerce — five linked exports, 880,500 rows | Data quality at scale, key validation | Python, Pandas, pytest |
| 03 | From Barrel to Pump | ETL automation | Python, requests, pandas, SQLite, pytest |
| — | OpenSky / BLS dashboards | BI & visualisation | JavaScript, Canvas, inline SVG, REST APIs |
| 04 | Payment date forecast (AR / OTC) | Process optimisation, collections priority | Python, Pandas, pytest |

## Project 02 — the e-commerce cleaning pipeline

```bash
cd projects/ecom-cleaning
pip install -r requirements.txt
python pipeline.py --source samples   # runs from a clone, no large files needed
python -m pytest -q                   # 52 tests
```

Cleans CRM, catalog, orders, tickets and clickstream — 880,500 rows — resolving 46 category
spellings, 11 payment spellings and 35 issue-type spellings to 12 canonical labels by
ordered rules rather than a lookup table, and recovering 36,160 order dates that only looked
corrupt because they use `%Y/%d/%m` and `%d-%m-%Y`.

Its most useful result is negative: `session_id` and `device_id` both fail their key checks,
so no session-level funnel is computed and 150,553 events are reported as unattributable
instead of being imputed. See [`projects/ecom-cleaning/README.md`](projects/ecom-cleaning/README.md)
for the full breakdown and for why the raw exports are not versioned.

## Project 03 — running the ETL pipeline

```bash
cd projects/energy-pipeline
pip install -r requirements.txt
python pipeline.py                      # builds both the monthly and daily layers
python scripts/build_pipeline_data.py   # regenerates the figures the site displays
pytest -q
```

To confirm the page still draws after changing the payload or the chart code:

```bash
npm install            # once, for jsdom
npm run serve          # in one terminal
npm run check:render   # in another — walks to the chart, flips the grain toggle, checks the SVG
npm run check:encoding # guards against mis-decoded text in any source file
```

Both pytest suites also run together from the repository root (`pytest -q`).

Extract → RAW layer → Transform → Validate → Load (SQLite + CSV).

### Data sources

| Source | What | Auth |
|--------|------|------|
| [EIA API v2](https://www.eia.gov/opendata/) | Brent / WTI spot, USD per barrel | `EIA_API_KEY` env var |
| [EIA public workbooks](https://www.eia.gov/dnav/pet/pet_pri_spt_s1_m.htm) | Brent / WTI spot, USD per barrel, monthly *and* daily | none |
| [NBP](https://api.nbp.pl/) | USD/PLN and EUR/PLN, table A | none |
| [EC Weekly Oil Bulletin](https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en) | Pb95 / diesel pump prices, Poland, gross and net | none |

### On data provenance

Crude prices are resolved through three tiers, and the tier actually used is written to the
`crude_source` column of every row:

| `crude_source` | Meaning | Real data |
|----------------|---------|-----------|
| `eia_api` | EIA API v2 | yes |
| `eia_public_xls` | EIA's public workbooks (`RBRTEm`/`RWTCm`, `RBRTEd`/`RWTCd`) | yes |
| `reference_fallback` | Coarse annual anchors, only so the flow runs offline | **no** |

**No API key is required, for either granularity.** Both the monthly and the daily workbooks
are published without authentication, so a clone of this repository reproduces every figure
on the site. Setting `EIA_API_KEY` switches to the API but changes no conclusion:

```bash
# PowerShell — entirely optional
$env:EIA_API_KEY = "your-key"; python pipeline.py
```

`reference_fallback` is reached only when EIA cannot be contacted at all. It is labelled as
non-market data on the website, and `tests/test_validation.py` fails the build if a series
claiming a real source has too few distinct values to plausibly be one.

### Two granularities

The pipeline builds two analytical layers, and the site lets the reader switch between them:

| Layer | Grain | Rows | Carries | Why |
|-------|-------|------|---------|-----|
| `energy_market` | monthly | ~103 | crude, FX, pump prices, spreads, correlation | retail prices only exist monthly |
| `energy_market_daily` | per quote | ~2,190 | crude, FX, crude in PLN/l, 30-quote average | the monthly average hides the extremes |

The daily layer deliberately carries **no pump prices**. The EC bulletin publishes weekly at
best, so a daily retail spread would mean inventing prices for days nobody quoted; a test
asserts those columns never appear at daily grain.

Two findings the daily grain surfaces that the monthly one cannot:

- Brent's lowest quote is **9.12 USD** (21 Apr 2020), while the monthly average for that same
  month bottoms out at **18.38 USD** — averaging removed half the crash.
- WTI settled at **−36.98 USD** on 20 Apr 2020. The quote is kept, and a test asserts it
  survives: a blanket "prices must be positive" rule would silently delete a real event.

FX is joined with `merge_asof`, so each quote is valued at the last NBP fixing on or before
its date. Crude and FX follow different calendars and disagree over local holidays, so this
is closer to how the conversion would actually be done than dropping the day or interpolating.

### Layout

```
projects/energy-pipeline/
├── pipeline.py              # Extract → Transform → Validate → Load
├── config.py                # endpoints, constants (158.987 L per barrel)
├── sql/schema.sql           # energy_market + energy_market_daily definitions
├── tests/test_validation.py # pytest data-quality checks
├── scripts/                 # build pipeline-data.js, monthly fuel history
└── data/
    ├── raw/{eia,nbp,eu_fuel}/YYYY-MM-DD.json   # immutable landing zone
    ├── processed/energy_market.csv             # analytical layer, monthly
    ├── processed/energy_market_daily.csv       # analytical layer, per quote
    └── database/energy.db                      # generated, not versioned
```

## Project 04 — payment date forecast (AR / OTC)

```bash
cd projects/payment-forecast
pip install -r requirements.txt
python pipeline.py
python scripts/build_payment_data.py
pytest -q
```

50,000 AR invoices → clean integer dates → late-rate / aging → customer-median forecast
(MAE ~3.4 days vs ~5.5 naive) → open-invoice collections queue. See
[`projects/payment-forecast/README.md`](projects/payment-forecast/README.md).

## Local development

The site is plain HTML/CSS/JS — open `index.html` or serve the folder:

```bash
python -m http.server 8000
```

`node_modules` is only needed for the optional snapshot builder:

```bash
npm install
npm run build:barrel-snapshot
```

## Contact

- Email: krzy.blachut@gmail.com
- LinkedIn: [krzysztof-blachut](https://www.linkedin.com/in/krzysztof-blachut-9837bb244/)
- Location: Gliwice, Poland
