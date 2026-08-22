-- Analytical questions on energy_market (SQLite).
-- Load: python pipeline.py  →  data/database/energy.db
--
-- These are the same questions the case-study page answers in prose.

-- 1. How much of the pump price is crude, and how much is tax + margin?
SELECT date,
       ROUND(brent_pln_l, 2)            AS crude_pln_l,
       ROUND(pb95_pln_l, 2)             AS pump_pln_l,
       ROUND(spread_retail_vs_crude, 2) AS taxes_and_margin,
       ROUND(100.0 * brent_pln_l / pb95_pln_l, 1) AS crude_share_pct
FROM energy_market
WHERE pb95_pln_l IS NOT NULL
ORDER BY date;

-- 2. Months where the pump moved least like crude (spread extremes).
SELECT date,
       ROUND(brent_usd, 2) AS brent_usd,
       ROUND(pb95_pln_l, 2) AS pb95_pln_l,
       ROUND(spread_retail_vs_crude, 2) AS spread
FROM energy_market
WHERE spread_retail_vs_crude IS NOT NULL
ORDER BY spread_retail_vs_crude DESC
LIMIT 5;

SELECT date,
       ROUND(brent_usd, 2) AS brent_usd,
       ROUND(pb95_pln_l, 2) AS pb95_pln_l,
       ROUND(spread_retail_vs_crude, 2) AS spread
FROM energy_market
WHERE spread_retail_vs_crude IS NOT NULL
ORDER BY spread_retail_vs_crude ASC
LIMIT 5;

-- 3. April 2020 — the month a monthly average hides.
SELECT date, brent_usd, wti_usd,
       ROUND(pb95_pln_l, 2) AS pb95_pln_l,
       ROUND(spread_retail_vs_crude, 2) AS spread
FROM energy_market
WHERE date BETWEEN '2020-03-01' AND '2020-05-01'
ORDER BY date;

-- Daily grain: the negative WTI print (must not be filtered out).
SELECT date, brent_usd, wti_usd
FROM energy_market_daily
WHERE date BETWEEN '2020-04-15' AND '2020-04-25'
ORDER BY date;

-- 4. Same-currency guard — this must be ~0 or the spread is mixing PLN and EUR.
SELECT MAX(ABS(
    spread_retail_vs_crude - (pb95_pln_l - brent_pln_l)
)) AS max_spread_error
FROM energy_market
WHERE pb95_pln_l IS NOT NULL
  AND brent_pln_l IS NOT NULL
  AND spread_retail_vs_crude IS NOT NULL;

-- 5. Provenance: which crude feed actually answered.
SELECT crude_source, COUNT(*) AS months
FROM energy_market
GROUP BY crude_source;
