# Krzysztof Blachut

Portfolio: [krzysztof-blachut-data.github.io](https://krzysztof-blachut-data.github.io)

Strona po PL/EN. Zwykły HTML/CSS/JS, bez frameworka. Strona główna jest skrótem dla rekrutera; pełne case study i kod są na podstronach.

CV (PDF): [Krzysztof_Blachut_CV.pdf](https://krzysztof-blachut-data.github.io/Krzysztof_Blachut_CV.pdf?v=20260822d)

## Co jest na stronie

1. **E-commerce — projekt główny** — pięć powiązanych eksportów (~880k wierszy). Najpierw sprawdzam, czy klucze w ogóle łączą tabele (`session_id` nie jest prawidłowym kluczem sesji). Dane syntetyczne.
2. **Laboratorium** — 1 500 wyników z trzech szpitali, pomieszane jednostki i nazwy. Dane syntetyczne (LIMS).
3. **Od baryłki do dystrybutora** — pipeline EIA + NBP + biuletyn KE, warstwa dzienna i miesięczna, SQLite, [zapytania SQL](projects/energy-pipeline/sql/queries.sql). Dane publiczne.
4. **Prognoza płatności** — 50k faktur AR, kto spóźni się ze spłatą, priorytetowa kolejka kontaktu z klientami, [zapytania SQL](projects/payment-forecast/sql/ar_queries.sql). Publiczna próbka danych.
5. **OpenSky / BLS** — dashboardy z żywych API, ze snapshotem i datą pobrania, gdy endpoint nie odpowiada.

## Jak odpalić stronę lokalnie

```bash
python -m http.server 8000
```

Po uruchomieniu otwórz: http://localhost:8000

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

Wszystkie testy można również uruchomić z katalogu głównego:

```bash
pytest -q
```

Smoke-test wykresów energetycznych (wymaga `npm install` i serwera):

```bash
python -m http.server 8791 --bind 127.0.0.1
node scripts/check_render.js
```

Więcej kontekstu znajduje się na podstronach projektów oraz w plikach README.md dostępnych w wybranych katalogach.

## Kontakt

krzy.blachut@gmail.com · [LinkedIn](https://www.linkedin.com/in/krzysztof-blachut-9837bb244/)
