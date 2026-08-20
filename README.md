# Krzysztof Blachut

Portfolio: [krzysztof-blachut-data.github.io](https://krzysztof-blachut-data.github.io)

Strona po PL/EN. Zwykły HTML/CSS/JS, bez frameworka. Projekty da się odpalić, nie są tylko zrzutami.

## Co jest na stronie

1. **Czyszczenie danych lab** — wyniki z trzech szpitali, pomieszane jednostki i nazwy.
2. **E-commerce** — pięć powiązanych eksportów (~880k wierszy). Najpierw sprawdzam, czy klucze w ogóle łączą tabele (`session_id` nie łączy).
3. **Od baryłki do dystrybutora** — pipeline EIA + NBP + biuletyn KE, warstwa dzienna i miesięczna, SQLite.
4. **Prognoza płatności** — 50k faktur AR, kto spóźni się ze spłatą, kolejka do windykacji.
5. **OpenSky / BLS** — dashboardy z żywych API.

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

Więcej kontekstu w `projects/*/README.md`.

## Kontakt

krzy.blachut@gmail.com · [LinkedIn](https://www.linkedin.com/in/krzysztof-blachut-9837bb244/)
