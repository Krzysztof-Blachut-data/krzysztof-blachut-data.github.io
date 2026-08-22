# Krzysztof Blachut

Portfolio: [krzysztof-blachut-data.github.io](https://krzysztof-blachut-data.github.io)

Strona po PL/EN. Zwykły HTML/CSS/JS, bez frameworka. Strona główna jest skrótem dla rekrutera; pełne case study i kod są na podstronach.

CV (PDF): [Krzysztof_Blachut_CV.pdf](https://krzysztof-blachut-data.github.io/Krzysztof_Blachut_CV.pdf?v=20260822)

## Co jest na stronie

1. **E-commerce (featured)** — pięć powiązanych eksportów (~880k wierszy). Najpierw sprawdzam, czy klucze w ogóle łączą tabele (`session_id` nie łączy). Dane syntetyczne.
2. **Laboratorium** — 1 500 wyników z trzech szpitali, pomieszane jednostki i nazwy. Dane syntetyczne (LIMS).
3. **Od baryłki do dystrybutora** — pipeline EIA + NBP + biuletyn KE, warstwa dzienna i miesięczna, SQLite, [zapytania SQL](projects/energy-pipeline/sql/queries.sql). Dane publiczne.
4. **Prognoza płatności** — 50k faktur AR, kto spóźni się ze spłatą, kolejka do windykacji, [zapytania SQL](projects/payment-forecast/sql/ar_queries.sql). Publiczny sample.
5. **OpenSky / BLS** — dashboardy z żywych API, ze snapshotem i datą pobrania gdy endpoint nie odpowie.

## Jak odpalić stronę lokalnie

```bash
python -m http.server 8000
```

## Pipelines

E-commerce (w repo są sample, bez wielkich plików):

```bash
cd projects/ecom-cleaning
pip install -r requirements.txt
python pipeline.py --source samples
pytest -q
```

Energia (klucz EIA nie jest potrzebny):

```bash
cd projects/energy-pipeline
pip install -r requirements.txt
python pipeline.py
python scripts/build_pipeline_data.py
pytest -q
```

Należności:

```bash
cd projects/payment-forecast
pip install -r requirements.txt
python pipeline.py
python scripts/build_payment_data.py
pytest -q
```

Albo wszystko z roota: `pytest -q`.

Smoke-test wykresów energetycznych (wymaga `npm install` i serwera):

```bash
python -m http.server 8791 --bind 127.0.0.1
node scripts/check_render.js
```

Więcej kontekstu w `projects/*/README.md`.

## Kontakt

krzy.blachut@gmail.com · [LinkedIn](https://www.linkedin.com/in/krzysztof-blachut-9837bb244/)
