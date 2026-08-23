-- Pytania do energy_market (SQLite).
-- Zapis: python pipeline.py  →  data/database/energy.db
--
-- Te same pytania, które strona projektu omawia w tekście.
-- Zapytania nie liczą korelacji Pearsona ani nie porównują przesunięć.

-- 1. Cena Pb95 vs przeliczony koszt ropy (reszta to nie tylko podatki i marża).
SELECT date,
       ROUND(brent_pln_l, 2)            AS crude_pln_l,
       ROUND(pb95_pln_l, 2)             AS pump_pln_l,
       ROUND(spread_retail_vs_crude, 2) AS retail_minus_crude,
       ROUND(100.0 * brent_pln_l / pb95_pln_l, 1) AS crude_share_pct
FROM energy_market
WHERE pb95_pln_l IS NOT NULL
ORDER BY date;

-- 2. Przygotowanie szeregu miesięcznego do analizy korelacji w Pythonie.
--    SQL tylko porządkuje daty; korelacja i przesunięcia są poza tym zapytaniem.
SELECT date, brent_usd, pb95_pln_l
FROM energy_market
WHERE brent_usd IS NOT NULL AND pb95_pln_l IS NOT NULL
ORDER BY date;

-- 3. Co ukrywa średnia miesięczna (marzec–maj 2020).
SELECT date, brent_usd, wti_usd,
       ROUND(pb95_pln_l, 2) AS pb95_pln_l,
       ROUND(spread_retail_vs_crude, 2) AS retail_minus_crude
FROM energy_market
WHERE date BETWEEN '2020-03-01' AND '2020-05-01'
ORDER BY date;

-- Warstwa dzienna: ujemne notowanie WTI (nie wolno go odfiltrować).
SELECT date, brent_usd, wti_usd
FROM energy_market_daily
WHERE date BETWEEN '2020-04-15' AND '2020-04-25'
ORDER BY date;

-- 4. Kontrola tej samej waluty — wynik musi być ~0, inaczej odejmowane są PLN i EUR.
SELECT MAX(ABS(
    spread_retail_vs_crude - (pb95_pln_l - brent_pln_l)
)) AS max_unit_error
FROM energy_market
WHERE pb95_pln_l IS NOT NULL
  AND brent_pln_l IS NOT NULL
  AND spread_retail_vs_crude IS NOT NULL;

-- 5. Pochodzenie: które źródło ropy faktycznie zadziałało.
SELECT crude_source, COUNT(*) AS months
FROM energy_market
GROUP BY crude_source;
