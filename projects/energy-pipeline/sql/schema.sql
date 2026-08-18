CREATE TABLE IF NOT EXISTS energy_market (
    date TEXT PRIMARY KEY,
    brent_usd REAL,
    wti_usd REAL,
    usd_pln REAL,
    brent_pln_bbl REAL,
    brent_pln_l REAL,
    pb95_eur_l REAL,
    diesel_eur_l REAL,
    spread_retail_vs_crude REAL,
    brent_usd_mom_pct REAL,
    brent_usd_yoy_pct REAL,
    pb95_eur_l_mom_pct REAL,
    pb95_eur_l_yoy_pct REAL,
    loaded_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_energy_market_date ON energy_market(date);
