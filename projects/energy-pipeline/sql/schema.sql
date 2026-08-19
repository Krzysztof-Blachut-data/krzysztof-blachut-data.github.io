-- monthly: one row per month
CREATE TABLE IF NOT EXISTS energy_market (
    date TEXT PRIMARY KEY,

    brent_usd REAL,
    wti_usd REAL,

    usd_pln REAL,
    eur_pln REAL,

    pb95_eur_l REAL,
    diesel_eur_l REAL,
    pb95_net_eur_l REAL,
    diesel_net_eur_l REAL,

    brent_pln_bbl REAL,
    brent_pln_l REAL,

    pb95_pln_l REAL,
    diesel_pln_l REAL,
    pb95_net_pln_l REAL,

    spread_retail_vs_crude REAL,   -- gross (taxes + margin)
    spread_net_vs_crude REAL,      -- net of taxes

    brent_usd_mom_pct REAL,
    brent_usd_yoy_pct REAL,
    pb95_pln_l_mom_pct REAL,
    pb95_pln_l_yoy_pct REAL,

    -- eia_api / eia_public_xls = real; reference_fallback = anchors only
    crude_source TEXT,

    loaded_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_energy_market_date ON energy_market(date);

-- daily quotes; no Pb95 (EC bulletin is weekly). FX = last NBP fixing on/before date
CREATE TABLE IF NOT EXISTS energy_market_daily (
    date TEXT PRIMARY KEY,

    brent_usd REAL,
    wti_usd REAL,

    usd_pln REAL,
    eur_pln REAL,

    brent_pln_bbl REAL,
    brent_pln_l REAL,

    brent_wti_spread_usd REAL,

    brent_usd_dod_pct REAL,
    brent_pln_l_ma30 REAL,

    crude_source TEXT,
    loaded_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_energy_market_daily_date ON energy_market_daily(date);
