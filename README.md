# Krzysztof Blachut — Data Analyst Portfolio

**[Live site →](https://krzysztof-blachut-data.github.io)** · PL / EN · static HTML, no framework

Working projects, not screenshots. Cleaning walkthroughs run in the browser, dashboards call public APIs, and the Python pipelines are runnable from a clone.

## Projects

| # | Project | What it shows |
|---|---------|----------------|
| **01** | [Lab data cleaning](https://krzysztof-blachut-data.github.io/#data-cleaning) | Dirty lab results: units, sentinels, naming — repaired with rules |
| **02** | [E-commerce cleaning](https://krzysztof-blachut-data.github.io/#ecom-cleaning) | 880k rows across 5 exports; key checks before any funnel KPI |
| **03** | [From Barrel to Pump](https://krzysztof-blachut-data.github.io/#energy-pipeline) | ETL: EIA + NBP + EC fuel bulletin → SQLite/CSV, daily & monthly |
| **04** | [Payment forecast](https://krzysztof-blachut-data.github.io/#payment-forecast) | 50k AR invoices → late risk + collections queue |
| — | [OpenSky](https://krzysztof-blachut-data.github.io/#opensky-live) / [BLS](https://krzysztof-blachut-data.github.io/#bls-labor) | Live BI dashboards (aircraft over PL, US labour market) |

## Quick start (site)

```bash
git clone https://github.com/krzysztof-blachut-data/krzysztof-blachut-data.github.io.git
cd krzysztof-blachut-data.github.io
python -m http.server 8000
# open http://localhost:8000
```

## Run the pipelines

**E-commerce cleaning** (samples included — no 180 MB raw files needed):

```bash
cd projects/ecom-cleaning
pip install -r requirements.txt
python pipeline.py --source samples
pytest -q
```

**Energy ETL** (no API key required — public EIA workbooks):

```bash
cd projects/energy-pipeline
pip install -r requirements.txt
python pipeline.py
python scripts/build_pipeline_data.py
pytest -q
```

**Payment forecast** (downloads the public AR sample on first run):

```bash
cd projects/payment-forecast
pip install -r requirements.txt
python pipeline.py
python scripts/build_payment_data.py
pytest -q
```

All suites from the repo root:

```bash
pytest -q
```

## Stack

Python · Pandas · pytest · SQLite · requests · JavaScript · SVG/Canvas · REST APIs · GitHub Pages

## More detail

| Project folder | Notes |
|----------------|--------|
| [`projects/ecom-cleaning`](projects/ecom-cleaning/README.md) | Full cleaning rules, why `session_id` is not a key |
| [`projects/energy-pipeline`](projects/energy-pipeline/) | Sources, daily vs monthly, provenance |
| [`projects/payment-forecast`](projects/payment-forecast/README.md) | Forecast method, collections priority |

## Contact

- Email: [krzy.blachut@gmail.com](mailto:krzy.blachut@gmail.com)
- LinkedIn: [krzysztof-blachut](https://www.linkedin.com/in/krzysztof-blachut-9837bb244/)
