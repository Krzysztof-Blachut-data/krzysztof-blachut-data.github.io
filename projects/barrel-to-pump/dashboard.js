(function () {
    var root = document.getElementById("barrel-dashboard");
    if (!root) return;

    var NBP_BASE = "https://api.nbp.pl/api/exchangerates/rates/a/usd/";
    var EIA_BASE = "https://api.eia.gov/v2/petroleum/pri/spt/data/";
    var LITRE_PER_BBL = 158.987;
    var SERIES_KEYS = [
        "brentUsd", "wtiUsd", "usdPln", "brentPln",
        "pb95WithTax", "dieselWithTax", "pb95Net", "dieselNet"
    ];

    var state = {
        series: {},
        sources: {},
        eiaApiKey: null,
        source: "snapshot",
        fetchedAt: null,
        rangeStart: 2018,
        loading: false
    };

    function lang() {
        return document.documentElement.getAttribute("data-lang") === "en" ? "en" : "pl";
    }

    function label(meta) {
        return meta && (meta[lang()] || meta.pl) || "";
    }

    function locale() {
        return lang() === "en" ? "en-US" : "pl-PL";
    }

    function fmtUsd(n) {
        if (!Number.isFinite(n)) return "—";
        return "$" + n.toFixed(2);
    }

    function fmtPln(n) {
        if (!Number.isFinite(n)) return "—";
        var val = n.toFixed(3);
        if (lang() === "pl") val = val.replace(".", ",");
        return val + " PLN";
    }

    function fmtFuel(n) {
        if (!Number.isFinite(n)) return "—";
        var val = n.toFixed(2);
        if (lang() === "pl") val = val.replace(".", ",");
        return "€" + val + "/l";
    }

    function fmtPlnl(n) {
        if (!Number.isFinite(n)) return "—";
        var val = n.toFixed(2);
        if (lang() === "pl") val = val.replace(".", ",");
        return val + " PLN/l";
    }

    function fmtDelta(cur, prev, fmt) {
        if (!Number.isFinite(cur) || !Number.isFinite(prev)) return "";
        var en = lang() === "en";
        var d = cur - prev;
        var sign = d > 0 ? "+" : "";
        var suffix = en ? " vs a year ago" : " vs rok wcześniej";
        if (fmt === "usd") return sign + "$" + d.toFixed(2) + suffix;
        if (fmt === "pln") return sign + (en ? d.toFixed(3) : d.toFixed(3).replace(".", ",")) + " PLN" + suffix;
        if (fmt === "fuel") {
            var fv = d.toFixed(2);
            if (!en) fv = fv.replace(".", ",");
            return sign + "€" + fv + "/l" + suffix;
        }
        if (fmt === "plnl") {
            var pv = d.toFixed(2);
            if (!en) pv = pv.replace(".", ",");
            return sign + pv + " PLN/l" + suffix;
        }
        return sign + d.toFixed(2) + suffix;
    }

    function formatValue(meta, val) {
        if (!meta || !Number.isFinite(val)) return "—";
        if (meta.fmt === "usd") return fmtUsd(val);
        if (meta.fmt === "pln") return fmtPln(val);
        if (meta.fmt === "fuel") return fmtFuel(val);
        if (meta.fmt === "plnl") return fmtPlnl(val);
        return String(val);
    }

    var MONTHS = {
        pl: ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"],
        en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    };

    function monthLabel(p) {
        if (!p) return "—";
        var names = MONTHS[lang()];
        return names[p.month - 1] + " " + p.year;
    }

    function monthKey(p) {
        return p.year + "-" + String(p.month).padStart(2, "0");
    }

    function monthlyFromDaily(rows) {
        var byMonth = {};
        rows.forEach(function (r) {
            if (!Number.isFinite(r.value)) return;
            var key = monthKey(r);
            if (!byMonth[key]) byMonth[key] = { sum: 0, n: 0, year: r.year, month: r.month };
            byMonth[key].sum += r.value;
            byMonth[key].n += 1;
        });
        return Object.keys(byMonth).sort().map(function (k) {
            var m = byMonth[k];
            return { year: m.year, month: m.month, value: +(m.sum / m.n).toFixed(3) };
        });
    }

    function getSeries(key) {
        return state.series[key] || null;
    }

    function validPoints(pts) {
        return (pts || []).filter(function (p) { return Number.isFinite(p.value); });
    }

    function filteredPoints(pts) {
        return validPoints(pts).filter(function (p) { return p.year >= state.rangeStart; });
    }

    function latestPoint(pts) {
        var v = validPoints(pts);
        return v.length ? v[v.length - 1] : null;
    }

    function pointMonthsAgo(pts, months) {
        var v = validPoints(pts);
        if (v.length <= months) return null;
        return v[v.length - 1 - months];
    }

    function findPoint(pts, year, month) {
        for (var i = 0; i < pts.length; i++) {
            if (pts[i].year === year && pts[i].month === month) return { point: pts[i], index: i };
        }
        return null;
    }

    function peakPoint(pts) {
        var best = null;
        pts.forEach(function (p) {
            if (!Number.isFinite(p.value)) return;
            if (!best || p.value > best.value) best = p;
        });
        return best;
    }

    function computeYScale(values, opts) {
        opts = opts || {};
        var min = Math.min.apply(null, values);
        var max = Math.max.apply(null, values);
        if (opts.yMin != null) min = opts.yMin;
        else if (opts.floorZero) min = Math.min(0, min);
        else min = min - (max - min) * 0.12;
        if (opts.yMax != null) max = opts.yMax;
        else max = max + (max - min) * 0.12;
        if (max <= min) { max = min + 1; min = min - 1; }
        return { min: min, max: max };
    }

    function esc(s) {
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function applyData(payload, source) {
        if (payload.series) state.series = payload.series;
        if (payload.sources) state.sources = payload.sources;
        if (payload.eiaApiKey != null) state.eiaApiKey = payload.eiaApiKey;
        state.fetchedAt = payload.fetchedAt || state.fetchedAt;
        state.source = source;
        render();
    }

    function loadSnapshot() {
        var snap = window.BARREL_SNAPSHOT;
        if (!snap || !snap.series) return false;
        state.series = snap.series;
        state.sources = snap.sources || {};
        state.eiaApiKey = (snap.sources && snap.sources.eiaApiKey) || snap.eiaApiKey || null;
        applyData({ fetchedAt: snap.fetchedAt }, "snapshot");
        return true;
    }

    function nbpDateChunks(startYear) {
        var chunks = [];
        var start = new Date(startYear, 0, 1);
        var end = new Date();
        while (start < end) {
            var chunkEnd = new Date(start);
            chunkEnd.setDate(chunkEnd.getDate() + 366);
            if (chunkEnd > end) chunkEnd = end;
            chunks.push([
                start.toISOString().slice(0, 10),
                chunkEnd.toISOString().slice(0, 10)
            ]);
            start = new Date(chunkEnd);
            start.setDate(start.getDate() + 1);
        }
        return chunks;
    }

    function fetchNbpUsd() {
        var chunks = nbpDateChunks(2018);
        var all = [];
        return chunks.reduce(function (chain, range) {
            return chain.then(function () {
                var url = NBP_BASE + range[0] + "/" + range[1] + "/?format=json";
                return fetch(url, { headers: { Accept: "application/json" } })
                    .then(function (r) {
                        if (!r.ok) throw new Error("NBP HTTP " + r.status);
                        return r.json();
                    })
                    .then(function (d) {
                        (d.rates || []).forEach(function (rate) {
                            var dt = new Date(rate.effectiveDate);
                            all.push({
                                year: dt.getFullYear(),
                                month: dt.getMonth() + 1,
                                value: +rate.mid
                            });
                        });
                    });
            });
        }, Promise.resolve()).then(function () {
            return monthlyFromDaily(all);
        });
    }

    function fetchEiaSpotMonthly(facet) {
        if (!state.eiaApiKey) return Promise.resolve(null);
        var end = new Date().getFullYear() + "-12-31";
        var url = EIA_BASE + "?api_key=" + encodeURIComponent(state.eiaApiKey) +
            "&frequency=daily&data[0]=value&facets[series][]=" + facet +
            "&start=2018-01-01&end=" + end +
            "&sort[0][column]=period&sort[0][direction]=asc&length=5000";
        return fetch(url)
            .then(function (r) {
                if (!r.ok) return null;
                return r.json();
            })
            .then(function (d) {
                if (!d || !d.response) return null;
                var rows = (d.response.data || []).map(function (row) {
                    var dt = new Date(row.period);
                    return { year: dt.getFullYear(), month: dt.getMonth() + 1, value: +row.value };
                });
                return monthlyFromDaily(rows);
            })
            .catch(function () { return null; });
    }

    function recomputeBrentPln(brent, fx) {
        var fxMap = {};
        fx.forEach(function (p) { fxMap[monthKey(p)] = p.value; });
        return brent.map(function (p) {
            var rate = fxMap[monthKey(p)];
            if (!rate) return null;
            return {
                year: p.year, month: p.month,
                value: +((p.value * rate) / LITRE_PER_BBL).toFixed(3)
            };
        }).filter(Boolean);
    }

    function fetchLive() {
        state.loading = true;
        renderStatus();
        var tasks = [fetchNbpUsd()];
        if (state.eiaApiKey) {
            tasks.push(fetchEiaSpotMonthly("RBRTE"), fetchEiaSpotMonthly("RWTC"));
        }
        return Promise.all(tasks)
            .then(function (results) {
                var usdPln = results[0];
                var next = JSON.parse(JSON.stringify(state.series));
                if (usdPln && usdPln.length) {
                    next.usdPln = Object.assign({}, next.usdPln || {}, { points: usdPln });
                    if (next.brentUsd && next.brentUsd.points) {
                        next.brentPln = Object.assign({}, next.brentPln || {}, {
                            points: recomputeBrentPln(next.brentUsd.points, usdPln)
                        });
                    }
                }
                if (state.eiaApiKey && results[1] && results[1].length) {
                    next.brentUsd = Object.assign({}, next.brentUsd || {}, { points: results[1] });
                    if (usdPln && usdPln.length) {
                        next.brentPln = Object.assign({}, next.brentPln || {}, {
                            points: recomputeBrentPln(results[1], usdPln)
                        });
                    }
                }
                if (state.eiaApiKey && results[2] && results[2].length) {
                    next.wtiUsd = Object.assign({}, next.wtiUsd || {}, { points: results[2] });
                }
                applyData({
                    series: next,
                    fetchedAt: new Date().toISOString(),
                    sources: Object.assign({}, state.sources, { nbp: "live", eia: state.eiaApiKey ? "live" : state.sources.eia })
                }, "live");
            })
            .catch(function () {
                if (!loadSnapshot()) showError();
                else state.source = "snapshot-fallback";
            })
            .finally(function () {
                state.loading = false;
                render();
            });
    }

    function showError() {
        var en = lang() === "en";
        root.innerHTML = "<div class=\"dash-error\"><p>" + (en
            ? "Could not load fuel & oil data. Check network or use the embedded snapshot."
            : "Nie udało się wczytać danych o ropie i paliwach. Sprawdź sieć lub użyj osadzonego snapshotu.") + "</p></div>";
    }

    function svgSeriesChart(cfg) {
        var w = cfg.width || 720;
        var h = cfg.height || 240;
        var pad = { top: 28, right: cfg.endLabel ? 78 : 16, bottom: 32, left: 52 };
        var plotW = w - pad.left - pad.right;
        var plotH = h - pad.top - pad.bottom;
        var pts = (cfg.points || []).filter(function (p) { return Number.isFinite(p.value); });
        if (!pts.length) {
            return "<p class=\"dash-map-note\">" + (lang() === "en" ? "No data to plot." : "Brak danych do wykresu.") + "</p>";
        }

        var scale = computeYScale(pts.map(function (p) { return p.value; }), cfg);
        var yMin = scale.min;
        var yMax = scale.max;
        var n = pts.length;
        var gid = "fill-" + Math.round(Math.random() * 1e9);

        function xAt(i) { return pad.left + (i / Math.max(1, n - 1)) * plotW; }
        function yAt(v) { return pad.top + (1 - (v - yMin) / (yMax - yMin)) * plotH; }

        var line = pts.map(function (p, i) { return xAt(i).toFixed(1) + "," + yAt(p.value).toFixed(1); }).join(" ");
        var area = xAt(0).toFixed(1) + "," + (h - pad.bottom).toFixed(1) + " " + line + " " +
            xAt(n - 1).toFixed(1) + "," + (h - pad.bottom).toFixed(1);
        var html = "<svg class=\"bls-svg\" width=\"" + w + "\" height=\"" + h +
            "\" viewBox=\"0 0 " + w + " " + h + "\" preserveAspectRatio=\"xMidYMid meet\" style=\"aspect-ratio:" + w + "/" + h +
            "\" role=\"img\" aria-label=\"" + esc(cfg.aria || "") + "\">";
        html += "<defs><linearGradient id=\"" + gid + "\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">" +
            "<stop offset=\"0%\" stop-color=\"" + cfg.color + "\" stop-opacity=\"0.35\"/>" +
            "<stop offset=\"100%\" stop-color=\"" + cfg.color + "\" stop-opacity=\"0\"/></linearGradient></defs>";
        html += "<rect width=\"" + w + "\" height=\"" + h + "\" rx=\"8\" fill=\"rgba(15,23,42,0.85)\"/>";

        var g;
        for (g = 0; g <= 4; g++) {
            var gy = pad.top + (g / 4) * plotH;
            var gv = yMax - (g / 4) * (yMax - yMin);
            html += "<line x1=\"" + pad.left + "\" y1=\"" + gy.toFixed(1) + "\" x2=\"" + (w - pad.right) +
                "\" y2=\"" + gy.toFixed(1) + "\" stroke=\"rgba(148,163,184,0.15)\"/>";
            html += "<text x=\"" + (pad.left - 8) + "\" y=\"" + (gy + 3).toFixed(1) +
                "\" text-anchor=\"end\" fill=\"#94a3b8\" font-size=\"10\">" +
                esc(cfg.formatY ? cfg.formatY(gv) : gv.toFixed(1)) + "</text>";
        }

        (cfg.markers || []).forEach(function (mk) {
            var hit = findPoint(pts, mk.year, mk.month);
            if (!hit) return;
            var mx = xAt(hit.index);
            html += "<line x1=\"" + mx.toFixed(1) + "\" y1=\"" + pad.top + "\" x2=\"" + mx.toFixed(1) +
                "\" y2=\"" + (h - pad.bottom) + "\" stroke=\"" + (mk.color || "#f87171") +
                "\" stroke-dasharray=\"4 4\" stroke-opacity=\"0.7\"/>";
            if (mk.label) {
                html += "<text x=\"" + mx.toFixed(1) + "\" y=\"" + (pad.top - 8) +
                    "\" text-anchor=\"middle\" fill=\"#fca5a5\" font-size=\"10\" font-weight=\"600\">" +
                    esc(mk.label) + "</text>";
            }
        });

        if (!cfg.noArea) {
            html += "<polygon points=\"" + area + "\" fill=\"url(#" + gid + ")\"/>";
        }
        html += "<polyline points=\"" + line + "\" fill=\"none\" stroke=\"" + cfg.color +
            "\" stroke-width=\"2.5\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>";

        (cfg.highlights || []).forEach(function (hi) {
            var hit = hi.index != null ? { index: hi.index, point: pts[hi.index] } : findPoint(pts, hi.year, hi.month);
            if (!hit || !hit.point) return;
            var px = xAt(hit.index);
            var py = yAt(hit.point.value);
            html += "<circle cx=\"" + px.toFixed(1) + "\" cy=\"" + py.toFixed(1) +
                "\" r=\"4.5\" fill=\"" + cfg.color + "\" stroke=\"#fff\" stroke-width=\"1.5\"/>";
            if (hi.text) {
                html += "<text x=\"" + (px + (hi.dx || 0)).toFixed(1) + "\" y=\"" + (py + (hi.dy || -12)).toFixed(1) +
                    "\" text-anchor=\"" + (hi.align || "middle") + "\" fill=\"#f8fafc\" font-size=\"11\" font-weight=\"600\">" +
                    esc(hi.text) + "</text>";
            }
        });

        if (cfg.endLabel) {
            var last = pts[n - 1];
            var lx = xAt(n - 1);
            var ly = yAt(last.value);
            var lbl = cfg.formatY ? cfg.formatY(last.value) : last.value.toFixed(1);
            html += "<circle cx=\"" + lx.toFixed(1) + "\" cy=\"" + ly.toFixed(1) + "\" r=\"4\" fill=\"" + cfg.color + "\"/>";
            html += "<text x=\"" + (lx + 8).toFixed(1) + "\" y=\"" + (ly + 4).toFixed(1) +
                "\" fill=\"" + cfg.color + "\" font-size=\"12\" font-weight=\"700\">" + esc(lbl) + "</text>";
        }

        var tickEvery = Math.max(1, Math.floor(n / 5));
        pts.forEach(function (p, i) {
            if (i % tickEvery !== 0 && i !== n - 1) return;
            html += "<text x=\"" + xAt(i).toFixed(1) + "\" y=\"" + (h - 10) +
                "\" text-anchor=\"middle\" fill=\"#94a3b8\" font-size=\"10\">" + p.year + "</text>";
        });

        return html + "</svg>";
    }

    function svgDualSeriesChart(cfg) {
        var w = cfg.width || 720;
        var h = cfg.height || 240;
        var pad = { top: 32, right: 16, bottom: 32, left: 52 };
        var plotW = w - pad.left - pad.right;
        var plotH = h - pad.top - pad.bottom;
        var a = (cfg.seriesA || []).filter(function (p) { return Number.isFinite(p.value); });
        var b = (cfg.seriesB || []).filter(function (p) { return Number.isFinite(p.value); });
        if (!a.length && !b.length) {
            return "<p class=\"dash-map-note\">" + (lang() === "en" ? "No data to plot." : "Brak danych do wykresu.") + "</p>";
        }

        var allVals = a.map(function (p) { return p.value; }).concat(b.map(function (p) { return p.value; }));
        var scale = computeYScale(allVals, cfg);
        var yMin = scale.min;
        var yMax = scale.max;
        var n = Math.max(a.length, b.length);

        function xAt(i) { return pad.left + (i / Math.max(1, n - 1)) * plotW; }
        function yAt(v) { return pad.top + (1 - (v - yMin) / (yMax - yMin)) * plotH; }

        function polyline(pts, color) {
            if (!pts.length) return "";
            var line = pts.map(function (p, i) { return xAt(i).toFixed(1) + "," + yAt(p.value).toFixed(1); }).join(" ");
            return "<polyline points=\"" + line + "\" fill=\"none\" stroke=\"" + color +
                "\" stroke-width=\"2.5\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>";
        }

        var html = "<svg class=\"bls-svg\" width=\"" + w + "\" height=\"" + h +
            "\" viewBox=\"0 0 " + w + " " + h + "\" preserveAspectRatio=\"xMidYMid meet\" style=\"aspect-ratio:" + w + "/" + h +
            "\" role=\"img\" aria-label=\"" + esc(cfg.aria || "") + "\">";
        html += "<rect width=\"" + w + "\" height=\"" + h + "\" rx=\"8\" fill=\"rgba(15,23,42,0.85)\"/>";

        var g;
        for (g = 0; g <= 4; g++) {
            var gy = pad.top + (g / 4) * plotH;
            var gv = yMax - (g / 4) * (yMax - yMin);
            html += "<line x1=\"" + pad.left + "\" y1=\"" + gy.toFixed(1) + "\" x2=\"" + (w - pad.right) +
                "\" y2=\"" + gy.toFixed(1) + "\" stroke=\"rgba(148,163,184,0.15)\"/>";
            html += "<text x=\"" + (pad.left - 8) + "\" y=\"" + (gy + 3).toFixed(1) +
                "\" text-anchor=\"end\" fill=\"#94a3b8\" font-size=\"10\">" +
                esc(cfg.formatY ? cfg.formatY(gv) : gv.toFixed(0)) + "</text>";
        }

        (cfg.markers || []).forEach(function (mk) {
            var ref = a.length ? a : b;
            var hit = findPoint(ref, mk.year, mk.month);
            if (!hit) return;
            var mx = xAt(hit.index);
            html += "<line x1=\"" + mx.toFixed(1) + "\" y1=\"" + pad.top + "\" x2=\"" + mx.toFixed(1) +
                "\" y2=\"" + (h - pad.bottom) + "\" stroke=\"" + (mk.color || "#f87171") +
                "\" stroke-dasharray=\"4 4\" stroke-opacity=\"0.7\"/>";
            if (mk.label) {
                html += "<text x=\"" + mx.toFixed(1) + "\" y=\"" + (pad.top - 8) +
                    "\" text-anchor=\"middle\" fill=\"#fca5a5\" font-size=\"10\" font-weight=\"600\">" +
                    esc(mk.label) + "</text>";
            }
        });

        html += polyline(a, cfg.colorA || "#fbbf24");
        html += polyline(b, cfg.colorB || "#38bdf8");

        var legY = pad.top - 10;
        html += "<line x1=\"" + pad.left + "\" y1=\"" + legY + "\" x2=\"" + (pad.left + 20) +
            "\" y2=\"" + legY + "\" stroke=\"" + (cfg.colorA || "#fbbf24") + "\" stroke-width=\"2.5\"/>";
        html += "<text x=\"" + (pad.left + 24) + "\" y=\"" + (legY + 4) +
            "\" fill=\"#e2e8f0\" font-size=\"10\">" + esc(cfg.labelA || "") + "</text>";
        html += "<line x1=\"" + (pad.left + 120) + "\" y1=\"" + legY + "\" x2=\"" + (pad.left + 140) +
            "\" y2=\"" + legY + "\" stroke=\"" + (cfg.colorB || "#38bdf8") + "\" stroke-width=\"2.5\"/>";
        html += "<text x=\"" + (pad.left + 144) + "\" y=\"" + (legY + 4) +
            "\" fill=\"#e2e8f0\" font-size=\"10\">" + esc(cfg.labelB || "") + "</text>";

        var tickRef = a.length >= b.length ? a : b;
        var tickEvery = Math.max(1, Math.floor(tickRef.length / 5));
        tickRef.forEach(function (p, i) {
            if (i % tickEvery !== 0 && i !== tickRef.length - 1) return;
            html += "<text x=\"" + xAt(i).toFixed(1) + "\" y=\"" + (h - 10) +
                "\" text-anchor=\"middle\" fill=\"#94a3b8\" font-size=\"10\">" + p.year + "</text>";
        });

        return html + "</svg>";
    }

    function indexSeries(pts, baseYear, baseMonth) {
        var baseHit = findPoint(pts, baseYear, baseMonth);
        if (!baseHit || !baseHit.point.value) return [];
        var base = baseHit.point.value;
        return filteredPoints(pts).map(function (p) {
            return { year: p.year, month: p.month, value: +(p.value / base * 100).toFixed(1) };
        });
    }

    function chartHead(title, value, sub) {
        return "<div class=\"bls-chart-head\"><div><strong>" + title + "</strong>" +
            (sub ? "<span>" + sub + "</span>" : "") + "</div>" +
            (value ? "<div class=\"bls-chart-now\">" + value + "</div>" : "") + "</div>";
    }

    function vizGuide(items) {
        var en = lang() === "en";
        var html = "<div class=\"dash-guide\"><h4>" + (en ? "What each chart shows" : "Co pokazuje każdy wykres") + "</h4><ol>";
        items.forEach(function (item) {
            html += "<li><strong>" + item.title + "</strong> — " + item.text + "</li>";
        });
        html += "</ol></div>";
        return html;
    }

    function vizDesc(text, takeaway) {
        var en = lang() === "en";
        var html = "<p class=\"dash-panel-desc\">" + text + "</p>";
        if (takeaway) {
            html += "<p class=\"dash-panel-q\"><span>" + (en ? "Takeaway:" : "Wniosek:") + "</span> " + takeaway + "</p>";
        }
        return html;
    }

    function vizSection(label) {
        return "<div class=\"dash-section-label\">" + label + "</div>";
    }

    function methodNote() {
        var en = lang() === "en";
        return "<div class=\"dash-method\"><strong>" + (en ? "How it is built:" : "Jak to zrobione:") + "</strong> " +
            (en
                ? "Custom JavaScript + inline SVG charts. Monthly Brent/WTI from EIA, USD/PLN from NBP, pump prices from EC Weekly Oil Bulletin (via fuel-prices.eu). Not Power BI, not Timelimp."
                : "Własny JavaScript + wykresy SVG. Miesięczna Brent/WTI z EIA, USD/PLN z NBP, ceny na stacji z EC Weekly Oil Bulletin (via fuel-prices.eu). Bez Power BI, bez Timelimp.") +
            "</div>";
    }

    function taxBreakdownPanel(pbGross, pbNet, diGross, diNet, when) {
        var en = lang() === "en";
        function taxShare(gross, net) {
            if (!gross || !net || !gross.value) return null;
            return ((gross.value - net.value) / gross.value * 100);
        }
        var pbTax = taxShare(pbGross, pbNet);
        var diTax = taxShare(diGross, diNet);
        return "<div class=\"bls-chart-split\">" +
            "<div class=\"bls-chart-box\">" +
            "<h4>" + (en ? "Pb95 — gross vs net" : "Pb95 — brutto vs netto") + "</h4>" +
            "<p class=\"dash-map-note\">" + monthLabel(when) + "</p>" +
            "<div class=\"dash-kpi-grid\" style=\"grid-template-columns:1fr 1fr\">" +
            "<div class=\"dash-kpi\"><strong>" + (pbGross ? fmtFuel(pbGross.value) : "—") + "</strong>" +
            "<span>" + (en ? "With tax (pump)" : "Z podatkiem (stacja)") + "</span></div>" +
            "<div class=\"dash-kpi\"><strong>" + (pbNet ? fmtFuel(pbNet.value) : "—") + "</strong>" +
            "<span>" + (en ? "Net (excl. tax)" : "Netto (bez podatku)") + "</span></div>" +
            "</div>" +
            (Number.isFinite(pbTax)
                ? "<p class=\"dash-panel-desc\">" + (en ? "Tax share ≈ " : "Udział podatku ≈ ") +
                pbTax.toFixed(0) + "% " + (en ? "of the pump price." : "ceny na stacji.") + "</p>"
                : "") +
            "</div>" +
            "<div class=\"bls-chart-box\">" +
            "<h4>" + (en ? "Diesel — gross vs net" : "Diesel — brutto vs netto") + "</h4>" +
            "<p class=\"dash-map-note\">" + monthLabel(when) + "</p>" +
            "<div class=\"dash-kpi-grid\" style=\"grid-template-columns:1fr 1fr\">" +
            "<div class=\"dash-kpi\"><strong>" + (diGross ? fmtFuel(diGross.value) : "—") + "</strong>" +
            "<span>" + (en ? "With tax (pump)" : "Z podatkiem (stacja)") + "</span></div>" +
            "<div class=\"dash-kpi\"><strong>" + (diNet ? fmtFuel(diNet.value) : "—") + "</strong>" +
            "<span>" + (en ? "Net (excl. tax)" : "Netto (bez podatku)") + "</span></div>" +
            "</div>" +
            (Number.isFinite(diTax)
                ? "<p class=\"dash-panel-desc\">" + (en ? "Tax share ≈ " : "Udział podatku ≈ ") +
                diTax.toFixed(0) + "% " + (en ? "of the pump price." : "ceny na stacji.") + "</p>"
                : "") +
            "</div></div>";
    }

    function comparisonTable() {
        var en = lang() === "en";
        var keys = ["brentUsd", "wtiUsd", "usdPln", "brentPln", "pb95WithTax", "dieselWithTax"];
        var html = "<table class=\"dc-table dash-table\"><thead><tr>" +
            "<th>" + (en ? "Indicator" : "Wskaźnik") + "</th>" +
            "<th>" + (en ? "Latest month" : "Ostatni miesiąc") + "</th>" +
            "<th>" + (en ? "One year ago" : "Rok temu") + "</th>" +
            "<th>" + (en ? "Two years ago" : "Dwa lata temu") + "</th>" +
            "<th>" + (en ? "Change over 12 months" : "Zmiana w ciągu roku") + "</th>" +
            "</tr></thead><tbody>";
        keys.forEach(function (key) {
            var s = getSeries(key);
            if (!s || !s.points) return;
            var cur = latestPoint(s.points);
            var m12 = pointMonthsAgo(s.points, 12);
            var m24 = pointMonthsAgo(s.points, 24);
            var delta = cur && m12 ? fmtDelta(cur.value, m12.value, s.meta.fmt) : "—";
            html += "<tr>" +
                "<td>" + label(s.meta) + "</td>" +
                "<td>" + (cur ? formatValue(s.meta, cur.value) + " <small>(" + monthLabel(cur) + ")</small>" : "—") + "</td>" +
                "<td>" + (m12 ? formatValue(s.meta, m12.value) : "—") + "</td>" +
                "<td>" + (m24 ? formatValue(s.meta, m24.value) : "—") + "</td>" +
                "<td class=\"dc-cell changed\">" + delta + "</td></tr>";
        });
        return html + "</tbody></table>";
    }

    function sourceLabel() {
        var en = lang() === "en";
        if (state.source === "live") {
            return en
                ? "Live refresh: NBP exchange rates" + (state.eiaApiKey ? " and EIA spot prices." : "; oil/pump from snapshot.")
                : "Odświeżenie na żywo: kursy NBP" + (state.eiaApiKey ? " i ceny EIA." : "; ropa/stacja ze snapshotu.");
        }
        if (state.source === "snapshot-fallback") {
            return en
                ? "Saved snapshot — the live request did not succeed."
                : "Zapisany snapshot — pobranie na żywo nie powiodło się.";
        }
        return en
            ? "Saved snapshot (works offline on GitHub Pages)."
            : "Zapisany snapshot (działa offline na GitHub Pages).";
    }

    function renderStatus() {
        var el = document.getElementById("barrel-status");
        if (!el) return;
        var en = lang() === "en";
        if (state.loading) {
            el.textContent = en ? "Loading oil & fuel data…" : "Wczytywanie danych o ropie i paliwach…";
            return;
        }
        var when = state.fetchedAt
            ? new Date(state.fetchedAt).toLocaleString(locale())
            : "";
        el.textContent = sourceLabel() + (when
            ? (en ? " Data downloaded: " : " Pobrano: ") + when + "."
            : ".");
    }

    function buildSummary(brentCur, wtiCur, fxCur, pumpCur) {
        var en = lang() === "en";
        if (!brentCur) return "";
        var parts = [];
        if (en) {
            parts.push("Latest month: <strong>" + monthLabel(brentCur) + "</strong>.");
            parts.push("Brent is <strong>" + fmtUsd(brentCur.value) + "/bbl</strong>" +
                (wtiCur ? ", WTI <strong>" + fmtUsd(wtiCur.value) + "</strong>." : "."));
            if (fxCur) parts.push("USD/PLN: <strong>" + fmtPln(fxCur.value) + "</strong>.");
            if (pumpCur) parts.push("Pb95 at the pump: <strong>" + fmtFuel(pumpCur.value) + "</strong>.");
        } else {
            parts.push("Ostatni miesiąc: <strong>" + monthLabel(brentCur) + "</strong>.");
            parts.push("Brent: <strong>" + fmtUsd(brentCur.value) + "/bbl</strong>" +
                (wtiCur ? ", WTI <strong>" + fmtUsd(wtiCur.value) + "</strong>." : "."));
            if (fxCur) parts.push("USD/PLN: <strong>" + fmtPln(fxCur.value) + "</strong>.");
            if (pumpCur) parts.push("Pb95 na stacji: <strong>" + fmtFuel(pumpCur.value) + "</strong>.");
        }
        return parts.join(" ");
    }

    function hasData() {
        return SERIES_KEYS.some(function (k) {
            var s = getSeries(k);
            return s && s.points && s.points.length;
        });
    }

    function render() {
        if (!hasData()) return;
        var en = lang() === "en";

        var brent = getSeries("brentUsd");
        var wti = getSeries("wtiUsd");
        var fx = getSeries("usdPln");
        var brentPln = getSeries("brentPln");
        var pb95 = getSeries("pb95WithTax");
        var diesel = getSeries("dieselWithTax");
        var pb95Net = getSeries("pb95Net");
        var dieselNet = getSeries("dieselNet");

        var brentCur = latestPoint(brent.points);
        var wtiCur = latestPoint(wti.points);
        var fxCur = latestPoint(fx.points);
        var brentPlnCur = latestPoint(brentPln.points);
        var pb95Cur = latestPoint(pb95.points);
        var dieselCur = latestPoint(diesel.points);

        var brent12 = pointMonthsAgo(brent.points, 12);
        var fx12 = pointMonthsAgo(fx.points, 12);

        var brentLine = filteredPoints(brent.points);
        var wtiLine = filteredPoints(wti.points);
        var fxLine = filteredPoints(fx.points);
        var brentPlnLine = filteredPoints(brentPln.points);
        var pb95Line = filteredPoints(pb95.points);
        var dieselLine = filteredPoints(diesel.points);

        var crashLabel = en ? "2020 crash" : "Kryzys 2020";
        var peakLabel = en ? "2022 peak" : "Szczyt 2022";
        var brentPeak = peakPoint(brentLine);
        var peak2022 = findPoint(brentLine, 2022, 6);

        var idxBrent = indexSeries(brent.points, 2018, 1);
        var idxPb95 = indexSeries(pb95.points, 2018, 1);

        var chartOilDual = svgDualSeriesChart({
            seriesA: brentLine, seriesB: wtiLine,
            colorA: "#fbbf24", colorB: "#38bdf8",
            labelA: "Brent", labelB: "WTI",
            width: 720, height: 240,
            formatY: function (v) { return "$" + v.toFixed(0); },
            markers: [
                { year: 2020, month: 4, label: crashLabel, color: "#f87171" },
                { year: 2022, month: 6, label: peakLabel, color: "#fbbf24" }
            ],
            aria: en ? "Brent and WTI crude oil prices" : "Ceny ropy Brent i WTI"
        });

        var chartFx = svgSeriesChart({
            points: fxLine, width: 480, height: 220, color: "#86efac", endLabel: true,
            formatY: function (v) {
                var s = v.toFixed(2);
                return lang() === "pl" ? s.replace(".", ",") : s;
            },
            aria: en ? "USD/PLN exchange rate" : "Kurs USD/PLN"
        });

        var chartBrentPln = svgSeriesChart({
            points: brentPlnLine, width: 480, height: 220, color: "#c084fc", endLabel: true,
            formatY: function (v) {
                var s = v.toFixed(2);
                return (lang() === "pl" ? s.replace(".", ",") : s) + " PLN/l";
            },
            aria: en ? "Brent converted to PLN per litre" : "Brent przeliczony na PLN/l"
        });

        var chartPb95 = svgSeriesChart({
            points: pb95Line, width: 480, height: 220, color: "#f87171", endLabel: true,
            formatY: function (v) { return "€" + v.toFixed(2); },
            markers: [{ year: 2022, month: 3, label: peakLabel, color: "#f87171" }],
            aria: en ? "Pb95 pump price with tax" : "Cena Pb95 na stacji brutto"
        });

        var chartDiesel = svgSeriesChart({
            points: dieselLine, width: 480, height: 220, color: "#7dd3fc", endLabel: true,
            formatY: function (v) { return "€" + v.toFixed(2); },
            markers: [{ year: 2022, month: 3, label: peakLabel, color: "#7dd3fc" }],
            aria: en ? "Diesel pump price with tax" : "Cena diesla na stacji brutto"
        });

        var chartIndexed = svgDualSeriesChart({
            seriesA: idxBrent, seriesB: idxPb95,
            colorA: "#fbbf24", colorB: "#f87171",
            labelA: en ? "Brent (indexed)" : "Brent (indeks)",
            labelB: en ? "Pb95 pump (indexed)" : "Pb95 stacja (indeks)",
            width: 720, height: 240,
            formatY: function (v) { return v.toFixed(0); },
            floorZero: true,
            aria: en ? "Indexed Brent vs pump price since 2018" : "Indeks Brent vs cena na stacji od 2018"
        });

        function takeOil() {
            if (!brentPeak || !brentCur) return "";
            return en
                ? "Brent fell to " + fmtUsd(findPoint(brentLine, 2020, 4) ? findPoint(brentLine, 2020, 4).point.value : 19) +
                " in April 2020, peaked near " + fmtUsd(brentPeak.value) + " in 2022, now " + fmtUsd(brentCur.value) + "."
                : "Brent spadła do " + fmtUsd(findPoint(brentLine, 2020, 4) ? findPoint(brentLine, 2020, 4).point.value : 19) +
                " w kwietniu 2020, szczyt ok. " + fmtUsd(brentPeak.value) + " w 2022, dziś " + fmtUsd(brentCur.value) + ".";
        }

        function takeFx() {
            if (!fxCur || !brentPlnCur) return "";
            return en
                ? "A weaker złoty raises Brent in PLN/l even when dollar oil is flat — watch both lines."
                : "Słabszy złoty podnosi Brent w PLN/l nawet gdy ropa w USD stoi w miejscu — patrz na obie linie.";
        }

        function takePump() {
            if (!pb95Cur || !dieselCur) return "";
            return en
                ? "Pump prices lag Brent by weeks. Latest: Pb95 " + fmtFuel(pb95Cur.value) + ", diesel " + fmtFuel(dieselCur.value) + "."
                : "Ceny na stacji opóźniają się względem Brent o tygodnie. Ostatnio: Pb95 " + fmtFuel(pb95Cur.value) + ", diesel " + fmtFuel(dieselCur.value) + ".";
        }

        function takeIndex() {
            return en
                ? "Both series start at 100 in Jan 2018. When lines move together, global oil drives the pump; when they diverge, tax or FX matter more."
                : "Obie serie startują ze 100 w sty 2018. Gdy linie idą razem — stacja jedzie za ropą; gdy się rozjeżdżają — ważniejsze są podatki lub kurs.";
        }

        root.innerHTML =
            "<div class=\"dash-toolbar\">" +
            "<div class=\"dash-filters\" role=\"group\" aria-label=\"" + (en ? "Chart time range" : "Zakres wykresów") + "\">" +
            "<button type=\"button\" class=\"dash-filter" + (state.rangeStart === 2018 ? " active" : "") + "\" data-range=\"2018\">" +
            (en ? "Full period (from 2018)" : "Cały okres (od 2018)") + "</button>" +
            "<button type=\"button\" class=\"dash-filter" + (state.rangeStart === 2020 ? " active" : "") + "\" data-range=\"2020\">" +
            (en ? "From 2020 (pandemic era)" : "Od 2020 (okres pandemii)") + "</button>" +
            "</div>" +
            "<button type=\"button\" class=\"btn btn-outline dash-refresh\" id=\"barrel-refresh\">" +
            (en ? "Refresh data" : "Odśwież dane") + "</button></div>" +
            "<p class=\"dash-status\" id=\"barrel-status\"></p>" +
            "<p class=\"dash-summary\">" + buildSummary(brentCur, wtiCur, fxCur, pb95Cur) + "</p>" +
            vizGuide([
                {
                    title: en ? "World oil dual line" : "Podwójna linia ropy",
                    text: en ? "Brent and WTI in USD/barrel — the upstream price before refining." : "Brent i WTI w USD/bbl — cena ropy przed rafinerią."
                },
                {
                    title: en ? "FX & conversion" : "Kurs i przeliczenie",
                    text: en ? "NBP USD/PLN and Brent converted to PLN per litre." : "USD/PLN z NBP i Brent przeliczony na PLN/l."
                },
                {
                    title: en ? "Pump prices" : "Ceny na stacji",
                    text: en ? "Polish Pb95 and diesel with tax — what drivers pay." : "Polskie Pb95 i diesel brutto — to, co płaci kierowca."
                },
                {
                    title: en ? "Barrel → distributor index" : "Indeks beczka → dystrybutor",
                    text: en ? "Both series indexed to Jan 2018 = 100 to compare upstream vs retail." : "Obie serie w indeksie sty 2018 = 100 — porównanie ropy ze stacją."
                },
                {
                    title: en ? "Comparison table" : "Tabela porównawcza",
                    text: en ? "Latest vs 12 and 24 months ago." : "Ostatni miesiąc vs rok i dwa lata temu."
                }
            ]) +
            "<div class=\"dash-kpi-grid\">" +
            "<div class=\"dash-kpi\"><strong>" + (brentCur ? fmtUsd(brentCur.value) : "—") + "</strong>" +
            "<span>Brent USD/bbl</span>" +
            (brent12 ? "<small class=\"dash-kpi-delta\">" + fmtDelta(brentCur.value, brent12.value, "usd") + "</small>" : "") + "</div>" +
            "<div class=\"dash-kpi\"><strong>" + (wtiCur ? fmtUsd(wtiCur.value) : "—") + "</strong><span>WTI USD/bbl</span></div>" +
            "<div class=\"dash-kpi\"><strong>" + (fxCur ? fmtPln(fxCur.value) : "—") + "</strong><span>USD/PLN</span>" +
            (fx12 ? "<small class=\"dash-kpi-delta\">" + fmtDelta(fxCur.value, fx12.value, "pln") + "</small>" : "") + "</div>" +
            "<div class=\"dash-kpi\"><strong>" + (brentPlnCur ? fmtPlnl(brentPlnCur.value) : "—") + "</strong><span>Brent PLN/l</span></div>" +
            "<div class=\"dash-kpi\"><strong>" + (pb95Cur ? fmtFuel(pb95Cur.value) : "—") + "</strong>" +
            "<span>" + (en ? "Pb95 gross EUR/l" : "Pb95 brutto EUR/l") + "</span></div>" +
            "<div class=\"dash-kpi\"><strong>" + (dieselCur ? fmtFuel(dieselCur.value) : "—") + "</strong>" +
            "<span>" + (en ? "Diesel gross EUR/l" : "Diesel brutto EUR/l") + "</span></div>" +
            "</div>" +
            "<div class=\"dash-grid\">" +
            vizSection(en ? "1 · From barrel to the world market" : "1 · Od beczki na świecie") +
            "<div class=\"dash-panel dash-panel-wide\">" +
            chartHead(
                en ? "Dual line — Brent & WTI (USD/bbl)" : "Podwójna linia — Brent i WTI (USD/bbl)",
                brentCur ? fmtUsd(brentCur.value) : "—",
                en ? "Global crude benchmarks" : "Globalne benchmarki ropy"
            ) +
            vizDesc(
                en ? "Brent (North Sea) and WTI (US) spot averages. Markers: April 2020 negative-oil shock and mid-2022 war spike."
                    : "Średnie spot Brent (Morze Północne) i WTI (USA). Markery: szok kwiecień 2020 i skok wojenny 2022.",
                takeOil()
            ) +
            chartOilDual + "</div>" +
            vizSection(en ? "2 · Exchange rate & conversion" : "2 · Kurs i przeliczenie") +
            "<div class=\"dash-panel dash-panel-wide\">" +
            vizDesc(
                en ? "Left: NBP table A USD/PLN (monthly average). Right: Brent USD/bbl × rate ÷ 158.987 l/bbl."
                    : "Lewo: NBP tabela A USD/PLN (średnia miesięczna). Prawo: Brent USD/bbl × kurs ÷ 158,987 l/bbl.",
                takeFx()
            ) +
            "<div class=\"bls-chart-split\">" +
            "<div class=\"bls-chart-box\">" +
            chartHead(en ? "USD/PLN" : "USD/PLN", fxCur ? fmtPln(fxCur.value) : "—", "NBP") +
            chartFx + "</div>" +
            "<div class=\"bls-chart-box\">" +
            chartHead(en ? "Brent in PLN/l" : "Brent w PLN/l", brentPlnCur ? fmtPlnl(brentPlnCur.value) : "—", en ? "converted" : "przeliczone") +
            chartBrentPln + "</div></div></div>" +
            vizSection(en ? "3 · Pump prices in Poland" : "3 · Ceny na stacji w Polsce") +
            "<div class=\"dash-panel dash-panel-wide\">" +
            vizDesc(
                en ? "Weekly EC Oil Bulletin averages for Poland (via fuel-prices.eu), shown monthly. Prices include excise and VAT."
                    : "Tygodniowe średnie EC Oil Bulletin dla Polski (via fuel-prices.eu), pogrupowane miesięcznie. Ceny z akcyzą i VAT.",
                takePump()
            ) +
            "<div class=\"bls-chart-split\">" +
            "<div class=\"bls-chart-box\">" +
            chartHead(en ? "Pb95 with tax" : "Pb95 brutto", pb95Cur ? fmtFuel(pb95Cur.value) : "—", "EUR/l") +
            chartPb95 + "</div>" +
            "<div class=\"bls-chart-box\">" +
            chartHead(en ? "Diesel with tax" : "Diesel brutto", dieselCur ? fmtFuel(dieselCur.value) : "—", "EUR/l") +
            chartDiesel + "</div></div>" +
            taxBreakdownPanel(pb95Cur, latestPoint(pb95Net.points), dieselCur, latestPoint(dieselNet.points), pb95Cur) +
            "</div>" +
            vizSection(en ? "4 · Barrel → distributor" : "4 · Beczka → dystrybutor") +
            "<div class=\"dash-panel dash-panel-wide\">" +
            chartHead(
                en ? "Indexed comparison (Jan 2018 = 100)" : "Porównanie indeksowe (sty 2018 = 100)",
                peak2022 ? fmtUsd(peak2022.point.value) : "—",
                en ? "Brent USD vs Pb95 pump" : "Brent USD vs Pb95 stacja"
            ) +
            vizDesc(
                en ? "Same base month removes units — you see whether pump prices track crude or drift because of tax and margins."
                    : "Wspólna baza usuwa jednostki — widać, czy stacja jedzie za ropą, czy odpływa przez podatki i marże.",
                takeIndex()
            ) +
            chartIndexed + "</div>" +
            vizSection(en ? "5 · Numbers behind the charts" : "5 · Liczby za wykresami") +
            "<div class=\"dash-panel dash-panel-wide\">" +
            "<h4>" + (en ? "Table — 12-month and 24-month comparison" : "Tabela — porównanie 12 i 24 miesięcy") + "</h4>" +
            vizDesc(
                en ? "Exact figures for the headline series: latest month vs one and two years earlier."
                    : "Dokładne liczby dla głównych serii: ostatni miesiąc vs rok i dwa lata wcześniej.",
                en ? "Use when you need the number, not the shape of the line."
                    : "Użyj, gdy potrzebujesz liczby, a nie kształtu linii."
            ) +
            comparisonTable() + "</div>" +
            methodNote() +
            "<div class=\"dash-panel dash-panel-wide dash-api\">" +
            "<h4>" + (en ? "Where the data comes from" : "Skąd pochodzą dane") + "</h4>" +
            "<p class=\"dash-api-note\">" + (en
                ? "Brent & WTI: EIA spot prices (petroleum/pri/spt). USD/PLN: NBP table A mid rates. Pump prices: EC Weekly Oil Bulletin for Poland (fuel-prices.eu). Net prices estimated from bulletin or EC net series."
                : "Brent i WTI: ceny spot EIA (petroleum/pri/spt). USD/PLN: kursy średnie NBP tabela A. Stacja: EC Weekly Oil Bulletin dla Polski (fuel-prices.eu). Netto szacowane z biuletynu lub serii EC.") +
            "</p>" +
            "<pre class=\"hero-code dc-code\"><code>GET " + NBP_BASE + "2018-01-01/" + new Date().toISOString().slice(0, 10) + "/?format=json\n" +
            "GET " + EIA_BASE + "?api_key=…&amp;facets[series][]=RBRTE\n" +
            "Source: EC Weekly Oil Bulletin · fuel-prices.eu/Poland/</code></pre>" +
            "<p class=\"dash-api-cite\"><a href=\"https://www.eia.gov/opendata/\" target=\"_blank\" rel=\"noopener\">EIA Open Data</a> · " +
            "<a href=\"https://api.nbp.pl/\" target=\"_blank\" rel=\"noopener\">NBP API</a> · " +
            "<a href=\"https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en\" target=\"_blank\" rel=\"noopener\">EC Weekly Oil Bulletin</a></p></div></div>";

        renderStatus();

        root.querySelectorAll("[data-range]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                state.rangeStart = +btn.getAttribute("data-range");
                render();
            });
        });
        var refreshBtn = document.getElementById("barrel-refresh");
        if (refreshBtn) refreshBtn.addEventListener("click", fetchLive);
    }

    function isPanelVisible() {
        var panel = document.getElementById("barrel-to-pump");
        return panel && !panel.hidden;
    }

    function paintCharts() {
        if (!hasData() || !root) return;
        render();
    }

    window.__barrelRerender = paintCharts;

    document.querySelectorAll("[data-set-lang]").forEach(function (btn) {
        btn.addEventListener("click", function () { setTimeout(paintCharts, 0); });
    });

    var barrelPanel = document.getElementById("barrel-to-pump");
    if (barrelPanel && typeof MutationObserver !== "undefined") {
        new MutationObserver(function () {
            if (!barrelPanel.hidden) paintCharts();
        }).observe(barrelPanel, { attributes: true, attributeFilter: ["hidden"] });
    }

    if (!loadSnapshot()) showError();
    fetchLive().finally(function () {
        if (isPanelVisible()) paintCharts();
    });
})();
