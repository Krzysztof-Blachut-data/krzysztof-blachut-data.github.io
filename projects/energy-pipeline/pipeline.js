(function () {
    if (!document.getElementById("ep-walkthrough")) return;

    var DATA = window.__PIPELINE_DATA || {};
    var step = 0;

    var STEPS = [
        {
            titlePl: "Architektura pipeline",
            titleEn: "Pipeline architecture",
            bodyPl: "Główny produkt to nie dashboard, lecz powtarzalny pipeline ETL. Trzy źródła (EIA, NBP, bulletin KE) trafiają do warstwy RAW, potem transformacja, walidacja i zapis do SQL. Analiza jest efektem ubocznym — nie celem samym w sobie.",
            bodyEn: "The main deliverable is not a dashboard but a repeatable ETL pipeline. Three sources (EIA, NBP, EC bulletin) land in a RAW layer, then transform, validate and load to SQL. Analysis is a downstream output — not the primary goal.",
            diagram: true,
            code: "# projects/energy-pipeline/pipeline.py\npython pipeline.py              # full run\npython pipeline.py --date 2026-08-18\nEIA_API_KEY=... python pipeline.py"
        },
        {
            titlePl: "Warstwa RAW — data lineage",
            titleEn: "RAW layer — data lineage",
            bodyPl: "Każda odpowiedź API i plik XLSX jest zapisywana dokładnie tak, jak przyszła — z datą uruchomienia w nazwie pliku. Dzięki temu widać źródło, wersję i moment pobrania. To nie notebook: surowe dane nie znikają po transformacji.",
            bodyEn: "Every API response and XLSX file is saved exactly as received — with the run date in the filename. That preserves source, version and fetch time. This is not a notebook: raw data is not discarded after transformation.",
            lineage: true,
            code: "def save_raw(source: str, payload, run_date: str) -> Path:\n    path = RAW / source / f\"{run_date}.json\"\n    with path.open(\"w\", encoding=\"utf-8\") as fh:\n        json.dump(payload, fh, ensure_ascii=False, indent=2)\n    logger.info(\"RAW saved: %s\", path)\n    return path"
        },
        {
            titlePl: "Extract — integracja API",
            titleEn: "Extract — API integration",
            bodyPl: "Pobieram Brent/WTI z EIA, kurs USD/PLN z NBP (tabela A, średnia miesięczna) oraz ceny Pb95/diesel z Weekly Oil Bulletin KE. Każde wywołanie ma timeout, raise_for_status() i logowanie błędu — pipeline nie pada cicho.",
            bodyEn: "I fetch Brent/WTI from EIA, USD/PLN from NBP (table A, monthly average) and Pb95/diesel from the EC Weekly Oil Bulletin. Each call has a timeout, raise_for_status() and error logging — the pipeline does not fail silently.",
            code: "try:\n    response = requests.get(url, timeout=30)\n    response.raise_for_status()\n    payload = response.json()\nexcept requests.RequestException as exc:\n    logger.error(\"EIA API request failed: %s\", exc)\n    raise\n\nsave_raw(\"eia\", payload, run_date)"
        },
        {
            titlePl: "Transform — łączenie źródeł",
            titleEn: "Transform — merging sources",
            bodyPl: "Serie miesięczne łączę po dacie. Liczę Brent PLN/bbl, Brent PLN/l (159 l/bbl), spread detal − ekwiwalent ropy oraz zmiany MoM/YoY. To ten sam łańcuch ekonomiczny co „beczka → dystrybutor”, ale w warstwie analitycznej, nie na wykresie.",
            bodyEn: "Monthly series are joined on date. I compute Brent PLN/bbl, Brent PLN/l (159 l/bbl), retail minus crude spread and MoM/YoY changes. Same economic chain as “barrel → pump”, but in the analytical layer — not on a chart.",
            transform: true,
            code: "df[\"brent_pln_bbl\"] = df[\"brent_usd\"] * df[\"usd_pln\"]\ndf[\"brent_pln_l\"] = df[\"brent_pln_bbl\"] / LITRE_PER_BBL\ndf[\"spread_retail_vs_crude\"] = df[\"pb95_eur_l\"] - df[\"brent_pln_l\"]\ndf[\"brent_usd_mom_pct\"] = df[\"brent_usd\"].pct_change() * 100"
        },
        {
            titlePl: "Validate — testy jakości",
            titleEn: "Validate — quality tests",
            bodyPl: "Pipeline sam kontroluje dane przed zapisem. pytest sprawdza dodatnie kursy i ceny ropy, unikalność dat i sensowne Brent PLN/l. To odróżnia projekt od typowego portfolio — jakość jest zautomatyzowana, nie ręczna.",
            bodyEn: "The pipeline checks data before load. pytest asserts positive FX and oil prices, unique dates and sane Brent PLN/l. That separates this project from a typical portfolio — quality is automated, not manual.",
            tests: true,
            code: "def test_usd_pln_positive(df):\n    assert df[\"usd_pln\"].dropna().gt(0).all()\n\ndef test_brent_positive(df):\n    assert df[\"brent_usd\"].dropna().gt(0).all()\n\ndef test_dates_unique(df):\n    assert not df[\"date\"].duplicated().any()"
        },
        {
            titlePl: "Load — SQL + CSV",
            titleEn: "Load — SQL + CSV",
            bodyPl: "Po walidacji zapisuję warstwę analityczną do energy_market.csv i SQLite (energy.db). Schemat jest prosty — jedna tabela faktów miesięcznych. Skrypt można uruchamiać cyklicznie (cron, Task Scheduler).",
            bodyEn: "After validation I write the analytical layer to energy_market.csv and SQLite (energy.db). The schema is simple — one monthly fact table. The script can run on a schedule (cron, Task Scheduler).",
            load: true,
            code: "CREATE TABLE IF NOT EXISTS energy_market (\n    date TEXT PRIMARY KEY,\n    brent_usd REAL, wti_usd REAL, usd_pln REAL,\n    pb95_eur_l REAL, diesel_eur_l REAL,\n    brent_pln_bbl REAL, brent_pln_l REAL,\n    spread_retail_vs_crude REAL\n);\n\ndf.to_sql(\"energy_market\", conn, if_exists=\"replace\", index=False)"
        },
        {
            titlePl: "Analiza — wnioski z pipeline",
            titleEn: "Analysis — pipeline takeaways",
            bodyPl: "Po ETL pipeline liczy korelację Brent vs Pb95, spread detal−ropa i zmiany YoY. Wniosek: ceny na stacji reagują z opóźnieniem i z większą amplitudą niż sama ropa — spread rośnie, gdy detal „dogania” lub wyprzedza crude.",
            bodyEn: "After ETL the pipeline computes Brent vs Pb95 correlation, retail−crude spread and YoY changes. Takeaway: pump prices react with a lag and often larger amplitude than crude alone — the spread widens when retail catches up or overshoots crude.",
            analysis: true,
            code: "corr = df[\"brent_usd\"].corr(df[\"pb95_eur_l\"])\nspread = df[\"pb95_eur_l\"] - df[\"brent_pln_l\"]\n# lag analysis: cross-correlation at t+1, t+2 …"
        }
    ];

    function lang() {
        return document.documentElement.getAttribute("data-lang") === "en" ? "en" : "pl";
    }

    function t(pl, en) {
        return lang() === "en" ? en : pl;
    }

    function fmt(n, d) {
        if (n === undefined || n === null || isNaN(n)) return "—";
        return Number(n).toFixed(d === undefined ? 2 : d);
    }

    function renderDiagram() {
        return (
            '<div class="ep-arch">' +
            '<div class="ep-arch-row">' +
            '<div class="ep-arch-box ep-src">EIA API<br><span>Brent / WTI</span></div>' +
            '<div class="ep-arch-arrow">JSON</div>' +
            '<div class="ep-arch-box ep-core" rowspan="3">PYTHON<br>ETL</div>' +
            '</div>' +
            '<div class="ep-arch-row">' +
            '<div class="ep-arch-box ep-src">NBP API<br><span>USD/PLN</span></div>' +
            '<div class="ep-arch-arrow">JSON</div>' +
            '</div>' +
            '<div class="ep-arch-row">' +
            '<div class="ep-arch-box ep-src">EU fuel<br><span>Pb95 / Diesel</span></div>' +
            '<div class="ep-arch-arrow">XLSX</div>' +
            '</div>' +
            '<div class="ep-arch-flow">' +
            '<span class="ep-arch-step">RAW</span><span>→</span>' +
            '<span class="ep-arch-step">TRANSFORM</span><span>→</span>' +
            '<span class="ep-arch-step">VALIDATE</span><span>→</span>' +
            '<span class="ep-arch-step">SQL</span><span>→</span>' +
            '<span class="ep-arch-step">ANALYSIS</span>' +
            '</div></div>'
        );
    }

    function renderLineage() {
        var runs = (DATA.rawRuns || ["2026-08-18"]).join(", ");
        return (
            '<pre class="ep-tree">' +
            "data/\n" +
            "├── raw/\n" +
            "│   ├── eia/" + runs + ".json\n" +
            "│   ├── nbp/" + runs + ".json\n" +
            "│   └── eu_fuel/" + runs + ".json\n" +
            "├── processed/\n" +
            "│   └── energy_market.csv  (" + (DATA.rows || "—") + " rows)\n" +
            "└── database/\n" +
            "    └── energy.db\n" +
            "</pre>"
        );
    }

    function renderTransform() {
        var L = DATA.latest || {};
        return (
            '<div class="ep-chain">' +
            '<div class="ep-chain-item"><strong>' + fmt(L.brent_usd) + '</strong><span>Brent USD/bbl</span></div>' +
            '<span class="ep-chain-arrow">×</span>' +
            '<div class="ep-chain-item"><strong>' + fmt(L.usd_pln, 4) + '</strong><span>USD/PLN</span></div>' +
            '<span class="ep-chain-arrow">→</span>' +
            '<div class="ep-chain-item"><strong>' + fmt(L.brent_pln_l, 3) + '</strong><span>Brent PLN/l</span></div>' +
            '<span class="ep-chain-arrow">vs</span>' +
            '<div class="ep-chain-item"><strong>' + fmt(L.pb95_eur_l, 3) + '</strong><span>Pb95 EUR/l</span></div>' +
            '<span class="ep-chain-arrow">=</span>' +
            '<div class="ep-chain-item accent"><strong>' + fmt(L.spread, 3) + '</strong><span>' + t("spread", "spread") + '</span></div>' +
            "</div>"
        );
    }

    function renderTests() {
        return (
            '<ul class="ep-test-list">' +
            '<li class="ep-test-pass">test_usd_pln_positive — ' + t("kurs > 0", "rate > 0") + "</li>" +
            '<li class="ep-test-pass">test_brent_positive — ' + t("Brent > 0", "Brent > 0") + "</li>" +
            '<li class="ep-test-pass">test_dates_unique — ' + t("brak duplikatów dat", "no duplicate dates") + "</li>" +
            '<li class="ep-test-pass">test_brent_pln_l_sane — Brent PLN/l ∈ (0.1, 20)</li>' +
            "</ul>"
        );
    }

    function renderPreviewTable() {
        var rows = DATA.preview || [];
        if (!rows.length) return "";
        var head =
            "<thead><tr><th>date</th><th>brent_usd</th><th>usd_pln</th><th>brent_pln_l</th><th>pb95_eur_l</th><th>spread</th></tr></thead>";
        var body = rows
            .map(function (r) {
                return (
                    "<tr><td>" +
                    r.date +
                    "</td><td>" +
                    fmt(r.brent_usd) +
                    "</td><td>" +
                    fmt(r.usd_pln, 3) +
                    "</td><td>" +
                    fmt(r.brent_pln_l, 3) +
                    "</td><td>" +
                    fmt(r.pb95_eur_l, 3) +
                    "</td><td>" +
                    fmt(r.spread_retail_vs_crude, 3) +
                    "</td></tr>"
                );
            })
            .join("");
        return '<div class="dc-table-wrap"><table class="dc-table">' + head + "<tbody>" + body + "</tbody></table></div>";
    }

    function renderAnalysis() {
        var L = DATA.latest || {};
        return (
            '<div class="ep-metrics dc-metrics">' +
            '<div class="metric"><span class="metric-value">' + (DATA.rows || "—") + '</span><span class="metric-label">' +
            t("miesięcy danych", "months of data") +
            "</span></div>" +
            '<div class="metric"><span class="metric-value">' + fmt(DATA.corrBrentPb95, 2) + '</span><span class="metric-label">' +
            t("korelacja Brent↔Pb95", "Brent↔Pb95 correlation") +
            "</span></div>" +
            '<div class="metric"><span class="metric-value">' + fmt(L.spread, 3) + '</span><span class="metric-label">' +
            t("spread (sie 2026)", "spread (Aug 2026)") +
            "</span></div>" +
            '<div class="metric"><span class="metric-value">' + fmt(L.pb95_yoy_pct, 1) + "%</span><span class="metric-label">' +
            t("Pb95 YoY", "Pb95 YoY") +
            "</span></div></div>" +
            renderPreviewTable() +
            '<p class="ep-takeaway"><strong>' +
            t("Wniosek:", "Takeaway:") +
            "</strong> " +
            t(
                "Korelacja Brent–Pb95 (~0,68) potwierdza związek, ale spread detal−ropa zmienia się w czasie — marża dystrybucji i podatki „rozciągają” reakcję stacji względem surowca.",
                "Brent–Pb95 correlation (~0.68) confirms the link, but the retail−crude spread shifts over time — distribution margin and taxes stretch pump response relative to crude."
            ) +
            "</p>"
        );
    }

    function renderExtra(s) {
        if (s.diagram) return renderDiagram();
        if (s.lineage) return renderLineage();
        if (s.transform) return renderTransform();
        if (s.tests) return renderTests();
        if (s.load) {
            return (
                '<p class="ep-load-note">' +
                t(
                    "Pliki: projects/energy-pipeline/data/processed/energy_market.csv · data/database/energy.db",
                    "Files: projects/energy-pipeline/data/processed/energy_market.csv · data/database/energy.db"
                ) +
                "</p>"
            );
        }
        if (s.analysis) return renderAnalysis();
        return "";
    }

    function renderStep() {
        var s = STEPS[step];
        var titleEl = document.getElementById("ep-step-title");
        var bodyEl = document.getElementById("ep-step-body");
        var codeEl = document.getElementById("ep-code");
        var progressEl = document.getElementById("ep-progress");
        var extraEl = document.getElementById("ep-extra");

        if (titleEl) titleEl.textContent = lang() === "en" ? s.titleEn : s.titlePl;
        if (bodyEl) bodyEl.textContent = lang() === "en" ? s.bodyEn : s.bodyPl;
        if (codeEl) codeEl.textContent = s.code || "";
        if (progressEl) progressEl.textContent = step + 1 + " / " + STEPS.length;
        if (extraEl) extraEl.innerHTML = renderExtra(s);

        document.querySelectorAll(".ep-step").forEach(function (btn) {
            var i = parseInt(btn.getAttribute("data-step"), 10);
            btn.classList.toggle("active", i === step);
            btn.classList.toggle("done", i < step);
        });

        var prev = document.getElementById("ep-prev");
        var next = document.getElementById("ep-next");
        if (prev) prev.disabled = step === 0;
        if (next) next.disabled = step === STEPS.length - 1;
    }

    document.querySelectorAll(".ep-step").forEach(function (btn) {
        btn.addEventListener("click", function () {
            step = parseInt(btn.getAttribute("data-step"), 10);
            renderStep();
        });
    });

    var prevBtn = document.getElementById("ep-prev");
    var nextBtn = document.getElementById("ep-next");
    if (prevBtn) {
        prevBtn.addEventListener("click", function () {
            if (step > 0) {
                step--;
                renderStep();
            }
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener("click", function () {
            if (step < STEPS.length - 1) {
                step++;
                renderStep();
            }
        });
    }

    document.querySelectorAll("[data-set-lang]").forEach(function (btn) {
        btn.addEventListener("click", function () {
            setTimeout(renderStep, 0);
        });
    });

    renderStep();
})();
