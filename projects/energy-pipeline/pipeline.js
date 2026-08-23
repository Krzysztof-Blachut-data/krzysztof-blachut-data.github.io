(function () {
            var root = document.getElementById("ep-walkthrough");
            if (!root) return;
            var step = 0;
            var total = root.querySelectorAll("[data-ep-panel]").length;

            root.querySelectorAll("[data-ep-panel]").forEach(function (panel) {
                var counter = panel.querySelector(".dc-progress");
                if (counter) {
                    counter.textContent = (Number(panel.getAttribute("data-ep-panel")) + 1) + " / " + total;
                }
            });

            var DATA = window.__PIPELINE_DATA || {};
            var chart = (DATA.chart || []).filter(function (p) {
                return p.brent_usd != null && p.pb95_pln_l != null;
            });
            var CHART_H = 240;
            var CHART_W = 720;
            var AXIS = "var(--chart-axis)";
            var GRID = "var(--chart-grid)";

            function isEn() {
                return document.documentElement.getAttribute("data-lang") === "en";
            }

            function t(pl, en) {
                return isEn() ? en : pl;
            }

            function num(n, d) {
                if (n === null || n === undefined || isNaN(n)) return "—";
                return Number(n).toFixed(d === undefined ? 2 : d);
            }

            function xTickIndexes() {
                var out = [];
                for (var i = 0; i < chart.length; i += 12) out.push(i);
                if (out[out.length - 1] !== chart.length - 1) out.push(chart.length - 1);
                return out;
            }

            // monthly / daily toggle
            var DAILY = DATA.daily || null;
            var grain = "monthly";

            var dailyPoints = (function () {
                if (!DAILY || !DAILY.dates) return [];
                return DAILY.dates.map(function (d, i) {
                    return {
                        date: d,
                        brent_usd: DAILY.brent_usd[i],
                        wti_usd: DAILY.wti_usd[i],
                        brent_pln_l: DAILY.brent_pln_l[i],
                        ma30: DAILY.ma30[i]
                    };
                }).filter(function (p) { return p.brent_usd != null; });
            })();

            function activeSeries() {
                return grain === "daily" ? dailyPoints : chart;
            }

            // year ticks only (daily has ~2k points)
            function yearTickIndexes(points) {
                var out = [];
                var seen = {};
                points.forEach(function (p, i) {
                    var year = String(p.date).slice(0, 4);
                    if (!seen[year]) { seen[year] = true; out.push(i); }
                });
                if (out[out.length - 1] !== points.length - 1) out.push(points.length - 1);
                return out;
            }

            function svgText(x, y, value, anchor, cls) {
                return "<text x=\"" + x + "\" y=\"" + y + "\" fill=\"" + AXIS +
                    "\" class=\"" + (cls || "ep-axis-label") + "\" text-anchor=\"" + anchor + "\">" + value + "</text>";
            }

            // USD/bbl left, PLN/l right
            function buildMainChart() {
                var el = document.getElementById("ep-viz-main");
                var points = activeSeries();
                if (!el || !points.length) return;
                var daily = grain === "daily";
                var pad = { l: 58, r: 62, t: 18, b: 40 };
                var iw = CHART_W - pad.l - pad.r;
                var ih = CHART_H - pad.t - pad.b;

                // monthly: Brent vs Pb95; daily: Brent vs WTI (+ Brent PLN/l + MA30)
                var series = daily
                    ? [
                        { key: "brent_usd", color: "var(--series-1)", decimals: 0, side: "left", label: "Brent (USD/bbl)", dash: "", width: 1 },
                        { key: "wti_usd", color: "var(--series-3)", decimals: 0, side: "left", label: "WTI (USD/bbl)", dash: "", width: 1 },
                        { key: "brent_pln_l", color: "var(--series-2)", decimals: 2, side: "right", label: "Brent (PLN/l)", dash: "2 2", width: 1 },
                        { key: "ma30", color: "var(--series-4)", decimals: 2, side: "right", label: t("Brent — średnia 30 notowań", "Brent — 30-quote average"), dash: "", width: 2.2 }
                    ]
                    : [
                        { key: "brent_usd", color: "var(--series-1)", decimals: 0, side: "left", label: "Brent (USD/bbl)", dash: "", width: 2 },
                        { key: "pb95_pln_l", color: "var(--series-2)", decimals: 2, side: "right", label: "Pb95 (PLN/l)", dash: "6 3", width: 2 }
                    ];

                // shared scale per axis
                var scales = {};
                ["left", "right"].forEach(function (side) {
                    var keys = series.filter(function (s) { return s.side === side; })
                        .map(function (s) { return s.key; });
                    if (!keys.length) return;
                    var vals = [];
                    points.forEach(function (p) {
                        keys.forEach(function (k) { if (p[k] != null) vals.push(p[k]); });
                    });
                    if (!vals.length) return;
                    var mn = Math.min.apply(null, vals);
                    var mx = Math.max.apply(null, vals);
                    scales[side] = { mn: mn, span: (mx - mn) || 1 };
                });

                var xS = function (i) { return pad.l + (i / (points.length - 1)) * iw; };
                var out = "";

                for (var tk = 0; tk <= 4; tk++) {
                    var ty = pad.t + ih - (tk / 4) * ih;
                    out += "<line x1=\"" + pad.l + "\" y1=\"" + ty + "\" x2=\"" + (CHART_W - pad.r) +
                        "\" y2=\"" + ty + "\" stroke=\"" + GRID + "\"/>";
                    ["left", "right"].forEach(function (side) {
                        if (!scales[side]) return;
                        var ref = series.filter(function (s) { return s.side === side; })[0];
                        var tv = scales[side].mn + scales[side].span * (tk / 4);
                        out += side === "left"
                            ? svgText(pad.l - 8, ty + 4, num(tv, ref.decimals), "end")
                            : svgText(CHART_W - pad.r + 8, ty + 4, num(tv, ref.decimals), "start");
                    });
                }

                series.forEach(function (s) {
                    var sc = scales[s.side];
                    if (!sc) return;
                    var yS = function (v) { return pad.t + ih - ((v - sc.mn) / sc.span) * ih; };
                    // skip gaps (no line across missing)
                    var d = "";
                    var open = false;
                    points.forEach(function (p, i) {
                        if (p[s.key] == null) { open = false; return; }
                        d += (open ? "L" : "M") + xS(i).toFixed(1) + " " + yS(p[s.key]).toFixed(1) + " ";
                        open = true;
                    });
                    if (!d) return;
                    out += "<path d=\"" + d.trim() + "\" fill=\"none\" stroke=\"" + s.color +
                        "\" stroke-width=\"" + s.width + "\"" +
                        (s.dash ? " stroke-dasharray=\"" + s.dash + "\"" : "") + "/>";
                });

                var ticks = daily ? yearTickIndexes(points) : xTickIndexes();
                out += ticks.map(function (i) {
                    var label = daily ? String(points[i].date).slice(0, 7) : points[i].date;
                    return svgText(xS(i).toFixed(0), CHART_H - 14, label, "middle");
                }).join("");
                out += svgText(pad.l - 8, pad.t - 6, "USD/bbl", "end", "ep-axis-unit");
                if (scales.right) {
                    out += svgText(CHART_W - pad.r + 8, pad.t - 6, "PLN/l", "start", "ep-axis-unit");
                }

                var legend = series.map(function (s) {
                    return "<span class=\"ep-legend-item\"><span class=\"ep-dot\" style=\"background:" + s.color +
                        "\"></span>" + s.label + "</span>";
                }).join("");

                var alt = daily
                    ? t("Dzienne notowania Brent i WTI w USD za baryłkę oraz Brent w złotych za litr, "
                        + points.length + " notowań",
                        "Daily Brent and WTI quotes in USD per barrel and Brent in zloty per litre, "
                        + points.length + " quotes")
                    : t("Brent w USD za baryłkę i Pb95 w złotych za litr, 2018–2026",
                        "Brent in USD per barrel and Pb95 in zloty per litre, 2018–2026");

                el.innerHTML = "<figure class=\"ep-chart-wrap\">" +
                    "<svg class=\"ep-chart\" viewBox=\"0 0 " + CHART_W + " " + CHART_H +
                    "\" role=\"img\" aria-label=\"" + alt + "\">" +
                    out + "</svg><p class=\"ep-chart-legend\">" + legend + "</p></figure>";
            }

            function negWti() {
                var n = DAILY && DAILY.negativeWti;
                if (!n) return "";
                return t(
                    " Uwaga na lewą oś: schodzi poniżej zera, bo <strong>WTI kosztowało " +
                    num(n.value, 2) + " USD</strong> (" + n.date + ") — magazyny w Cushing były pełne " +
                    "i posiadacze kontraktów płacili za pozbycie się ropy. Zostawiam to notowanie w danych: " +
                    "reguła „cena nie może być ujemna\" wycięłaby prawdziwe zdarzenie rynkowe.",

                    " Note the left axis dips below zero: <strong>WTI traded at " + num(n.value, 2) +
                    " USD</strong> (" + n.date + ") — storage at Cushing was full and contract holders " +
                    "paid to hand the oil over. The quote stays in the data: a rule saying " +
                    "\"a price cannot be negative\" would have deleted a real market event."
                );
            }

            function buildGrainNote() {
                var meta = document.getElementById("ep-grain-meta");
                var note = document.getElementById("ep-grain-note");
                var title = document.getElementById("ep-chart-title");
                var monthlyNote = document.getElementById("ep-note-monthly");
                var dailyNote = document.getElementById("ep-note-daily");
                var daily = grain === "daily";

                if (monthlyNote) monthlyNote.hidden = daily;
                if (dailyNote) dailyNote.hidden = !daily;
                if (title) {
                    title.textContent = daily
                        ? t("Brent i WTI (USD/bbl) — notowania dzienne",
                            "Brent and WTI (USD/bbl) — daily quotes")
                        : t("Brent (USD/bbl) vs Pb95 (PLN/l) na przestrzeni lat",
                            "Brent (USD/bbl) vs Pb95 (PLN/l) over time");
                }
                if (!note) return;

                if (daily && DAILY) {
                    var ex = DAILY.extremes || {};
                    if (meta) {
                        meta.textContent = DAILY.rows + t(" notowań · do ", " quotes · through ") + DAILY.dateTo;
                    }
                    note.innerHTML = t(
                        "Każdy punkt to jedno notowanie giełdowe, przeliczone kursem NBP obowiązującym w tym dniu. " +
                        "Ceny Pb95 nie ma tutaj, bo biuletyn KE publikuje najwyżej raz w tygodniu — utworzenie dziennego szeregu detalicznego " +
                        "wymagałoby interpolacji brakujących wartości. <strong>Dane dzienne pokazują więcej:</strong> " +
                        "najniższe notowanie Brent to <strong>" + num(ex.daily_low, 2) + " USD</strong> (" + ex.daily_low_date +
                        "), a średnia miesięczna za ten sam okres to <strong>" + num(ex.monthly_low, 2) + " USD</strong> (" +
                        ex.monthly_low_date + "). Średnia miesięczna znacznie wygładza dzienne spadki. " +
                        "Największy ruch w ciągu jednego dnia: <strong>" + num((DAILY.biggestMove || {}).pct, 1) + "%</strong> (" +
                        (DAILY.biggestMove || {}).date + ")." + negWti(),

                        "Each point is a single exchange quote, converted at the NBP rate in force that day. " +
                        "Pb95 is absent because the EC bulletin is weekly at best — a daily retail series " +
                        "would need interpolation for days with no quote. <strong>Daily data shows more:</strong> " +
                        "the lowest Brent quote is <strong>" + num(ex.daily_low, 2) + " USD</strong> (" + ex.daily_low_date +
                        "), while the monthly average for the same period is <strong>" + num(ex.monthly_low, 2) +
                        " USD</strong> (" + ex.monthly_low_date + "). The monthly average smooths the daily drops. " +
                        "Largest single-day move: <strong>" + num((DAILY.biggestMove || {}).pct, 1) + "%</strong> (" +
                        (DAILY.biggestMove || {}).date + ")." + negWti()
                    );
                } else {
                    if (meta) {
                        meta.textContent = chart.length + t(" miesięcy · do ", " months · through ") + (DATA.dateTo || "");
                    }
                    note.innerHTML = t(
                        "Dane miesięczne to jedyny poziom, na którym da się porównać ropę z ceną na stacji — " +
                        "ceny detaliczne nie są publikowane codziennie. Średnia miesięczna wygładza wahania, " +
                        "ale też dzienne spadki: przełącz na <strong>dziennie</strong>, żeby zobaczyć różnicę.",

                        "Monthly data is the only resolution where crude can be compared with the pump price — " +
                        "retail prices are not published every day. The monthly average also " +
                        "smooths daily drops: switch to <strong>daily</strong> to see the difference."
                    );
                }
            }

            function setGrain(next) {
                if (next === "daily" && !dailyPoints.length) return;
                grain = next;
                var group = document.getElementById("ep-grain");
                if (group) {
                    group.querySelectorAll("[data-grain]").forEach(function (btn) {
                        var on = btn.getAttribute("data-grain") === grain;
                        btn.classList.toggle("is-active", on);
                        btn.setAttribute("aria-pressed", on ? "true" : "false");
                    });
                }
                buildMainChart();
                buildGrainNote();
            }

            function initGrain() {
                var group = document.getElementById("ep-grain");
                if (!group) return;
                if (!dailyPoints.length) {
                    // no daily data
                    group.style.display = "none";
                    buildGrainNote();
                    return;
                }
                group.querySelectorAll("[data-grain]").forEach(function (btn) {
                    btn.addEventListener("click", function () {
                        setGrain(btn.getAttribute("data-grain"));
                    });
                });
                buildGrainNote();
            }

            function buildSpreadChart() {
                var el = document.getElementById("ep-viz-spread");
                if (!el || !chart.length) return;
                var pad = { l: 58, r: 62, t: 18, b: 40 };
                var iw = CHART_W - pad.l - pad.r;
                var ih = CHART_H - pad.t - pad.b;
                var vals = chart.map(function (p) { return p.spread_retail_vs_crude; });
                // force zero onto the axis
                var mn = Math.min(0, Math.min.apply(null, vals));
                var mx = Math.max.apply(null, vals);
                var span = mx - mn || 1;
                var xS = function (i) { return pad.l + (i / (chart.length - 1)) * iw; };
                var yS = function (v) { return pad.t + ih - ((v - mn) / span) * ih; };

                var out = "";
                for (var tk = 0; tk <= 4; tk++) {
                    var ty = pad.t + ih - (tk / 4) * ih;
                    out += "<line x1=\"" + pad.l + "\" y1=\"" + ty + "\" x2=\"" + (CHART_W - pad.r) +
                        "\" y2=\"" + ty + "\" stroke=\"" + GRID + "\"/>";
                    out += svgText(pad.l - 8, ty + 4, num(mn + span * (tk / 4), 2), "end");
                }
                out += "<line x1=\"" + pad.l + "\" y1=\"" + yS(0).toFixed(1) + "\" x2=\"" + (CHART_W - pad.r) +
                    "\" y2=\"" + yS(0).toFixed(1) + "\" stroke=\"" + AXIS + "\" stroke-dasharray=\"4 3\"/>";

                var area = chart.map(function (p, i) {
                    return (i ? "L" : "M") + xS(i).toFixed(1) + " " + yS(p.spread_retail_vs_crude).toFixed(1);
                }).join(" ");
                out += "<path d=\"" + area + " L" + xS(chart.length - 1).toFixed(1) + " " + yS(mn).toFixed(1) +
                    " L" + xS(0).toFixed(1) + " " + yS(mn).toFixed(1) + " Z\" fill=\"var(--series-4)\" opacity=\"0.14\"/>";
                out += "<path d=\"" + area + "\" fill=\"none\" stroke=\"var(--series-4)\" stroke-width=\"2\"/>";

                // net spread: one point, not a line
                var netIdx = -1;
                for (var i = chart.length - 1; i >= 0; i--) {
                    if (chart[i].spread_net_vs_crude != null) { netIdx = i; break; }
                }
                if (netIdx >= 0) {
                    var nv = chart[netIdx].spread_net_vs_crude;
                    out += "<circle cx=\"" + xS(netIdx).toFixed(1) + "\" cy=\"" + yS(nv).toFixed(1) +
                        "\" r=\"4\" fill=\"var(--series-3)\"/>";
                    out += svgText(xS(netIdx).toFixed(1), (yS(nv) - 10).toFixed(1),
                        t("netto ", "net ") + num(nv, 2), "middle", "ep-axis-unit");
                }

                out += xTickIndexes().map(function (idx) {
                    return svgText((pad.l + (idx / (chart.length - 1)) * iw).toFixed(0), CHART_H - 14, chart[idx].date, "middle");
                }).join("");
                out += svgText(pad.l - 8, pad.t - 6, "PLN/l", "end", "ep-axis-unit");

                var legend = "<span class=\"ep-legend-item\"><span class=\"ep-dot\" style=\"background:var(--series-4)\"></span>" +
                    t("różnica Pb95 − koszt ropy", "Pb95 minus crude cost") + "</span>" +
                    "<span class=\"ep-legend-item\"><span class=\"ep-dot\" style=\"background:var(--series-3)\"></span>" +
                    t("różnica netto — jedna obserwacja", "net gap — single observation") + "</span>";

                el.innerHTML = "<figure class=\"ep-chart-wrap\">" +
                    "<svg class=\"ep-chart\" viewBox=\"0 0 " + CHART_W + " " + CHART_H + "\" role=\"img\" aria-label=\"" +
                    t("Różnica między ceną Pb95 a przeliczonym kosztem ropy, w złotych za litr",
                        "Gap between the Pb95 price and converted crude cost, in zloty per litre") + "\">" +
                    out + "</svg><p class=\"ep-chart-legend\">" + legend + "</p></figure>";
            }

            function buildProvenance() {
                var el = document.getElementById("ep-provenance");
                if (!el) return;
                var src = DATA.crudeSource;

                var dailyBit = DAILY
                    ? t(" Warstwa dzienna: <strong>" + DAILY.rows + "</strong> notowań (" +
                        DAILY.dateFrom + " – " + DAILY.dateTo + ").",
                        " Daily layer: <strong>" + DAILY.rows + "</strong> quotes (" +
                        DAILY.dateFrom + " – " + DAILY.dateTo + ").")
                    : "";

                if (src === "eia_api") {
                    el.className = "ep-provenance is-live";
                    el.innerHTML = "<strong>" + t("Źródło danych:", "Data source:") + "</strong> " +
                        t("Brent i WTI z API EIA v2 (uwierzytelnione kluczem), kursy USD/PLN i EUR/PLN z API NBP, ceny na stacji z EC Weekly Oil Bulletin. Wszystkie serie rzeczywiste.",
                            "Brent and WTI from the EIA API v2 (key-authenticated), USD/PLN and EUR/PLN from the NBP API, pump prices from the EC Weekly Oil Bulletin. All series are real.") + dailyBit;
                    return;
                }

                if (src === "eia_public_xls") {
                    el.className = "ep-provenance is-live";
                    el.innerHTML = "<strong>" + t("Źródło danych:", "Data source:") + "</strong> " +
                        t("Brent i WTI z publicznych arkuszy EIA — miesięcznych (<code>RBRTEm</code>, <code>RWTCm</code>) i dziennych (<code>RBRTEd</code>, <code>RWTCd</code>). To te same oficjalne serie co w API. Projekt można odtworzyć bez prywatnego klucza API. Kursy z API NBP, ceny na stacji z Weekly Oil Bulletin KE.",
                            "Brent and WTI from EIA public workbooks — monthly (<code>RBRTEm</code>, <code>RWTCm</code>) and daily (<code>RBRTEd</code>, <code>RWTCd</code>). These are the same official series as the API. The project can be reproduced without a private API key. FX from the NBP API, pump prices from the EC Weekly Oil Bulletin.") + dailyBit;
                    return;
                }

                el.className = "ep-provenance is-reference";
                el.innerHTML = "<strong>" + t("Uwaga o danych:", "Data note:") + "</strong> " +
                    t("kursy NBP i ceny paliw są prawdziwe, ale serie Brent/WTI pochodzą z <strong>referencyjnych wartości zapasowych</strong>, bo nie udało się pobrać danych z EIA. Korelację należy czytać jako demonstrację metody, nie jako wynik rynkowy. Kolumna <code>crude_source</code> w CSV zawsze mówi, co jest w środku.",
                        "the NBP rates and fuel prices are real, but the Brent/WTI series come from <strong>reference fallback values</strong>, because EIA could not be reached. Read the correlation as a demonstration of method rather than a market result. The <code>crude_source</code> column in the CSV always states which is which.");
            }

            function metricCard(value, labelPl, labelEn) {
                return "<div class=\"metric\"><span class=\"metric-value\">" + value +
                    "</span><span class=\"metric-label\">" + t(labelPl, labelEn) + "</span></div>";
            }

            // month abbrev from ISO date (not hardcoded)
            var MONTHS_PL = ["sty", "lut", "mar", "kwi", "maj", "cze",
                "lip", "sie", "wrz", "paź", "lis", "gru"];
            var MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

            function monthLabel(iso) {
                if (!iso) return "";
                var parts = String(iso).split("-");
                var idx = Number(parts[1]) - 1;
                if (isNaN(idx) || idx < 0 || idx > 11) return String(iso);
                return (isEn() ? MONTHS_EN : MONTHS_PL)[idx] + " " + parts[0];
            }

            function buildMetrics() {
                var s = DATA.stats || {};
                var l = DATA.latest || {};
                var viz = document.getElementById("ep-viz-metrics");
                var when = monthLabel(l.date);
                var cards =
                    metricCard(DATA.rows || "—", "miesięcy danych", "months of data") +
                    metricCard(num(DATA.corrBrentPb95, 2), "korelacja Brent↔Pb95", "Brent↔Pb95 correlation") +
                    metricCard(num(l.pb95_pln_l, 2), "Pb95 PLN/l (" + when + ")", "Pb95 PLN/l (" + when + ")") +
                    metricCard(num(l.brent_pln_l, 2), "ropa PLN/l (" + when + ")", "crude PLN/l (" + when + ")") +
                    metricCard(num(l.spread_retail, 2), "różnica Pb95 − ropa PLN/l", "Pb95 − crude PLN/l");
                if (DAILY && DAILY.latest) {
                    cards += metricCard(num(DAILY.latest.brent_usd, 2),
                        "Brent USD/bbl (" + DAILY.latest.date + ")",
                        "Brent USD/bbl (" + DAILY.latest.date + ")");
                }
                if (viz) viz.innerHTML = cards;

                var analysis = document.getElementById("ep-analysis-metrics");
                if (analysis) {
                    analysis.innerHTML =
                        metricCard(DATA.rows || "—", "miesięcy danych", "months of data") +
                        metricCard(num(DATA.corrBrentPb95, 2), "korelacja Brent↔Pb95", "Brent↔Pb95 correlation") +
                        metricCard(num(s.spread_mean, 2), "średnia różnica PLN/l", "average gap PLN/l") +
                        metricCard(num(s.spread_min, 2) + "–" + num(s.spread_max, 2), "zakres różnicy PLN/l", "gap range PLN/l");
                }
            }

            function buildChain() {
                var el = document.getElementById("ep-chain");
                if (!el) return;
                var l = DATA.latest || {};
                function item(value, label, cls) {
                    return "<div class=\"ep-chain-item" + (cls ? " " + cls : "") + "\"><strong>" + value +
                        "</strong><span>" + label + "</span></div>";
                }
                function arrow(sym) {
                    return "<span class=\"ep-chain-arrow\">" + sym + "</span>";
                }
                el.innerHTML =
                    item(num(l.brent_usd, 2), "Brent USD/bbl") + arrow("×") +
                    item(num(l.usd_pln, 4), "USD/PLN") + arrow("→") +
                    item(num(l.brent_pln_l, 3), "Brent PLN/l") + arrow("vs") +
                    item(num(l.pb95_pln_l, 3), "Pb95 PLN/l") + arrow("=") +
                    item(num(l.spread_retail, 3), t("różnica PLN/l", "gap PLN/l"), "accent");
            }

            function buildLag() {
                var lags = DATA.lags || {};
                var grid = document.getElementById("ep-lag-grid");
                var keys = Object.keys(lags).sort(function (a, b) { return Number(a) - Number(b); });
                if (grid) {
                    grid.innerHTML = keys.map(function (k) {
                        var suffix = k === "0" ? "" : "+" + k;
                        var tip = k === "0"
                            ? t("Ten sam miesiąc — korelacja bez przesunięcia szeregu. To nie dowodzi, że stacje reagują w tym miesiącu.", "Same month — correlation with no series shift. That does not prove stations react in that month.")
                            : t("Pb95 przesunięty o " + k + " mies. względem Brent.", "Pb95 shifted " + k + " month(s) relative to Brent.");
                        return "<div class=\"ep-lag-card\"><strong>" + num(lags[k], 3) + "</strong><span>Brent(t) → Pb95(t" +
                            suffix + ") <span class=\"dc-term\" tabindex=\"0\" data-tip=\"" + tip + "\">ℹ</span></span></div>";
                    }).join("");
                }

                var best = keys.reduce(function (acc, k) {
                    return lags[k] > lags[acc] ? k : acc;
                }, keys[0]);
                var monotonic = keys.every(function (k, i) {
                    return i === 0 || lags[k] <= lags[keys[i - 1]];
                });
                var pl, en;
                if (best === "0" && monotonic) {
                    pl = "W danych miesięcznych najwyższa korelacja występuje bez przesunięcia szeregu (<strong>" + num(lags["0"], 3) +
                        "</strong>) i maleje przy n=1 (" + num(lags["1"], 3) + ") oraz n=3 (" + num(lags[keys[keys.length - 1]], 3) +
                        "). Najwyższa wartość bez przesunięcia nie oznacza, że stacje reagują w tym samym miesiącu. Dane miesięczne nie pozwalają określić czasu reakcji krótszego niż miesiąc. Korelacja opisuje współzmienność, nie związek przyczynowy.";
                    en = "On monthly data the highest correlation is at no shift (<strong>" + num(lags["0"], 3) +
                        "</strong>) and falls at n=1 (" + num(lags["1"], 3) + ") and n=3 (" + num(lags[keys[keys.length - 1]], 3) +
                        "). The highest value at no shift does not mean stations react in the same month. Monthly data cannot pin down a reaction shorter than a month. Correlation describes co-movement, not causation.";
                } else {
                    pl = "Najwyższa korelacja w danych miesięcznych jest przy przesunięciu <strong>n=" + best + " (" + num(lags[best], 3) +
                        ")</strong>. To tylko porównanie współzmienności przy różnych przesunięciach, nie dowód przyczynowości.";
                    en = "The highest monthly correlation is at shift <strong>n=" + best + " (" + num(lags[best], 3) +
                        ")</strong>. That compares how the series move together at different shifts; it is not proof of causation.";
                }
                var elPl = document.getElementById("ep-lag-note-pl");
                var elEn = document.getElementById("ep-lag-note-en");
                if (elPl) elPl.innerHTML = pl;
                if (elEn) elEn.innerHTML = en;
            }

            function buildTakeaways() {
                var s = DATA.stats || {};
                var l = DATA.latest || {};
                var lags = DATA.lags || {};
                var vizPl = document.getElementById("ep-viz-takeaway-pl");
                var vizEn = document.getElementById("ep-viz-takeaway-en");
                var pl = "<strong>Wniosek:</strong> różnica między ceną detaliczną Pb95 a przeliczonym kosztem ropy wynosiła od " + num(s.spread_min, 2) +
                    " do " + num(s.spread_max, 2) + " PLN/l (średnio " + num(s.spread_mean, 2) +
                    " PLN/l). Pozostała część ceny obejmuje między innymi podatki, rafinację, transport, dystrybucję i marże. Korelacja na poziomie około " +
                    num(DATA.corrBrentPb95, 2) + " wskazuje na współzmienność cen ropy i Pb95, ale sama nie dowodzi bezpośredniego wpływu ani związku przyczynowego.";
                var en = "<strong>Takeaway:</strong> the gap between retail Pb95 and converted crude cost ranged from " + num(s.spread_min, 2) +
                    " to " + num(s.spread_max, 2) + " PLN/l (mean " + num(s.spread_mean, 2) +
                    " PLN/l). The remainder includes taxes, refining, transport, distribution and margins. A correlation of about " +
                    num(DATA.corrBrentPb95, 2) + " shows crude and Pb95 move together; it does not prove a direct or causal effect.";
                if (vizPl) vizPl.innerHTML = pl;
                if (vizEn) vizEn.innerHTML = en;

                var aPl = document.getElementById("ep-analysis-takeaway-pl");
                var aEn = document.getElementById("ep-analysis-takeaway-en");
                if (aPl) {
                    aPl.innerHTML = "<strong>Wniosek:</strong> korelacja na poziomie około " + num(DATA.corrBrentPb95, 2) +
                        " wskazuje na współzmienność, nie na związek przyczynowy. W danych miesięcznych najwyższa wartość jest bez przesunięcia (" + num(lags["0"], 3) +
                        "). To nie oznacza, że stacje reagują w tym samym miesiącu. Różnica między ceną detaliczną Pb95 a przeliczonym kosztem ropy w ostatnim miesiącu: " +
                        num(l.spread_retail, 2) + " PLN/l (średnia w okresie: " + num(s.spread_mean, 2) + " PLN/l).";
                }
                if (aEn) {
                    aEn.innerHTML = "<strong>Takeaway:</strong> a correlation of about " + num(DATA.corrBrentPb95, 2) +
                        " shows they move together, not that one causes the other. On monthly data the highest value is at no shift (" + num(lags["0"], 3) +
                        "). That does not mean stations react in the same month. Latest gap between retail Pb95 and converted crude cost: " +
                        num(l.spread_retail, 2) + " PLN/l (period mean: " + num(s.spread_mean, 2) + " PLN/l).";
                }
            }

            function buildTable() {
                var el = document.getElementById("ep-table-all");
                if (!el) return;
                var head = "<thead><tr><th>date</th><th>Brent USD/bbl</th><th>" +
                    t("ropa PLN/l", "crude PLN/l") + "</th><th>Pb95 PLN/l</th><th>" +
                    t("Pb95 netto PLN/l", "Pb95 net PLN/l") + "</th><th>" +
                    t("różnica brutto PLN/l", "gross gap PLN/l") + "</th><th>" +
                    t("różnica netto PLN/l", "net gap PLN/l") + "</th></tr></thead>";
                var body = (DATA.chart || []).map(function (r) {
                    return "<tr><td>" + r.date +
                        "</td><td>" + num(r.brent_usd, 1) +
                        "</td><td>" + num(r.brent_pln_l, 3) +
                        "</td><td>" + num(r.pb95_pln_l, 3) +
                        "</td><td>" + num(r.pb95_net_pln_l, 3) +
                        "</td><td>" + num(r.spread_retail_vs_crude, 3) +
                        "</td><td>" + num(r.spread_net_vs_crude, 3) + "</td></tr>";
                }).join("");
                el.innerHTML = "<table class=\"dc-table\">" + head + "<tbody>" + body + "</tbody></table>";
            }

            var vizBuilt = false;
            function buildViz() {
                if (!chart.length) return;
                buildMainChart();
                buildSpreadChart();
                buildProvenance();
                buildTable();
                buildLag();
                if (!vizBuilt) initGrain();
                else buildGrainNote();
                vizBuilt = true;
            }

            function buildStatic() {
                buildChain();
                buildMetrics();
                buildTakeaways();
            }

            function show(i) {
                step = i;
                root.querySelectorAll("[data-ep-panel]").forEach(function (panel) {
                    panel.hidden = Number(panel.getAttribute("data-ep-panel")) !== i;
                });
                root.querySelectorAll(".ep-chip").forEach(function (btn) {
                    var n = Number(btn.getAttribute("data-ep"));
                    btn.classList.toggle("active", n === i);
                    btn.classList.toggle("done", n < i);
                });
                var prev = document.getElementById("ep-prev");
                var next = document.getElementById("ep-next");
                if (prev) prev.disabled = i === 0;
                if (next) next.disabled = i === total - 1;
                if (i === total - 1) buildViz();
            }
            root.querySelectorAll(".ep-chip").forEach(function (btn) {
                btn.addEventListener("click", function () {
                    show(Number(btn.getAttribute("data-ep")));
                });
            });
            var prevBtn = document.getElementById("ep-prev");
            var nextBtn = document.getElementById("ep-next");
            if (prevBtn) prevBtn.addEventListener("click", function () { if (step > 0) show(step - 1); });
            if (nextBtn) nextBtn.addEventListener("click", function () { if (step < total - 1) show(step + 1); });

            // lang toggle also refreshes chart labels
            document.querySelectorAll("[data-set-lang]").forEach(function (btn) {
                btn.addEventListener("click", function () {
                    setTimeout(function () {
                        buildStatic();
                        if (vizBuilt) buildViz();
                    }, 0);
                });
            });

            buildStatic();
            show(0);
        })();
