# Payment forecast — Order-to-Cash

Predict when open invoices will clear and prioritise collections.
Source: public AR sample ([SkywalkerHub/Payment-Date-Prediction](https://github.com/SkywalkerHub/Payment-Date-Prediction)).

```bash
cd projects/payment-forecast
pip install -r requirements.txt
python pipeline.py                      # download + clean + score
python scripts/build_payment_data.py    # refresh payment-data.js for the site
pytest -q
```

Offline after the first run:

```bash
python pipeline.py --sample-only   # uses data/samples/invoices_2000.csv
```

## What it does

1. **Clean** — rename typos (`buisness_year`), parse `YYYYMMDD` ints to dates, drop empty `area_business`.
2. **Measure** — days to pay, late rate, aging of open AR, breakdown by payment terms.
3. **Predict** — customer median → term median → global median; MAE on a time-ordered holdout.
4. **Act** — score open invoices for a collections queue; scenario on top-20 late customers.

Full raw/clean CSVs are gitignored (~8 MB). The sample, report and `payment-data.js` are versioned.
