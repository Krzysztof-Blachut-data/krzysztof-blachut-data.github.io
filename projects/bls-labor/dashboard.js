(function () {
    var root = document.getElementById("bls-dashboard");
    if (!root) return;

    var API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
    var SERIES_IDS = [
        "LNS14000000", "LNS11300000", "CES0000000001",
        "CUUR0000SA0", "LNS12000000", "CES0500000003"
    ];
    var COLORS = {
        LNS14000000: "#f87171",
        LNS11300000: "#38bdf8",
        CES0000000001: "#86efac",
        CUUR0000SA0: "#fbbf24",
        LNS12000000: "#c084fc",
        CES0500000003: "#7dd3fc"
    };

    var state = {
        series: [],
        source: "snapshot",
        fetchedAt: null,
        rangeStart: 2018,
        loading: false
    };

    function lang() {
        return document.documentElement.getAttribute("data-lang") === "en" ? "en" : "pl";
    }

    function label(meta) {
        return meta[lang()] || meta.pl;
    }

    var PLAIN_LABELS = {
        LNS14000000: { pl: "Stopa bezrobocia", en: "Unemployment rate" },
        LNS11300000: { pl: "Aktywność zawodowa", en: "Labour force participation" },
        CES0000000001: { pl: "Miejsca pracy poza rolnictwem", en: "Nonfarm jobs" },
        CUUR0000SA0: { pl: "Indeks cen konsumpcyjnych", en: "Consumer price index" },
        CES0500000003: { pl: "Średnia stawka godzinowa", en: "Average hourly wage" }
    };

    function plainLabel(id, meta) {
        var s = PLAIN_LABELS[id];
        if (s) return s[lang()];
        return meta ? label(meta) : id;
    }

    function fmtInt(n) {
        return Number(n).toLocaleString(lang() === "en" ? "en-US" : "pl-PL");
    }

    function fmtPct(n, digits) {
        if (!Number.isFinite(n)) return "—";
        return n.toFixed(digits == null ? 1 : digits) + "%";
    }

    function fmtMoney(n) {
        if (!Number.isFinite(n)) return "—";
        return "$" + n.toFixed(2);
    }

    function fmtEmpK(n) {
        if (!Number.isFinite(n)) return "—";
        var val = (n / 1000).toFixed(1);
        return lang() === "en" ? val + " million" : val.replace(".", ",") + " mln";
    }

    function fmtIndex(n) {
        if (!Number.isFinite(n)) return "—";
        return n.toFixed(1);
    }

    function fmtDelta(cur, prev, fmt) {
        if (!Number.isFinite(cur) || !Number.isFinite(prev)) return "";
        var en = lang() === "en";
        var d = cur - prev;
        var sign = d > 0 ? "+" : "";
        var suffix = en ? " vs a year ago" : " vs rok wcześniej";
        if (fmt === "pct") return sign + d.toFixed(1) + (en ? " pp" : " p.p.") + suffix;
        if (fmt === "money") return sign + "$" + d.toFixed(2) + suffix;
        if (fmt === "emp") return sign + (d / 1000).toFixed(2) + " mln" + suffix;
        if (fmt === "yoy") return sign + d.toFixed(1) + (en ? " pp change in inflation" : " p.p. zmiany inflacji");
        return sign + d.toFixed(2) + suffix;
    }

    function parseApiPayload(data) {
        var META = {
            LNS14000000: { pl: "Stopa bezrobocia (SA)", en: "Unemployment rate (SA)", unit: "%", fmt: "pct" },
            LNS11300000: { pl: "Aktywność zawodowa (SA)", en: "Labor force participation (SA)", unit: "%", fmt: "pct" },
            CES0000000001: { pl: "Zatrudnienie nonfarm (tys.)", en: "Total nonfarm employment (K)", unit: "K", fmt: "emp" },
            CUUR0000SA0: { pl: "CPI — wszystkie pozycje", en: "CPI all items", unit: "index", fmt: "index" },
            LNS12000000: { pl: "Poziom zatrudnienia (tys.)", en: "Employment level (K)", unit: "K", fmt: "emp" },
            CES0500000003: { pl: "Średnia stawka godzinowa", en: "Avg hourly earnings", unit: "USD", fmt: "money" }
        };
        return (data.Results && data.Results.series || []).map(function (s) {
            var monthly = (s.data || []).filter(function (p) { return /^M/.test(p.period); }).map(function (p) {
                return {
                    year: +p.year,
                    month: +p.period.slice(1),
                    period: p.period,
                    periodName: p.periodName,
                    value: p.value === "" || p.value == null ? null : +p.value,
                    preliminary: (p.footnotes || []).some(function (f) { return f.code === "P"; })
                };
            }).sort(function (a, b) {
                return a.year !== b.year ? a.year - b.year : a.month - b.month;
            });
            return { id: s.seriesID, meta: META[s.seriesID], points: monthly };
        });
    }

    function applyData(payload, source) {
        state.series = payload.series;
        state.fetchedAt = payload.fetchedAt;
        state.source = source;
        render();
    }

    function loadSnapshot() {
        var snap = window.BLS_SNAPSHOT;
        if (!snap || !snap.series) return false;
        applyData({ series: snap.series, fetchedAt: snap.fetchedAt }, "snapshot");
        return true;
    }

    function fetchLive() {
        state.loading = true;
        renderStatus();
        return fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                seriesid: SERIES_IDS,
                startyear: "2018",
                endyear: String(new Date().getFullYear())
            })
        })
            .then(function (r) {
                if (!r.ok) throw new Error("HTTP " + r.status);
                return r.json();
            })
            .then(function (data) {
                if (data.status !== "REQUEST_SUCCEEDED") throw new Error(data.status || "API error");
                applyData({
                    series: parseApiPayload(data),
                    fetchedAt: new Date().toISOString()
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
            ? "Could not load BLS data. Check network or use the embedded snapshot."
            : "Nie udało się wczytać danych BLS. Sprawdź sieć lub użyj osadzonego snapshotu.") + "</p></div>";
    }

    function getSeries(id) {
        for (var i = 0; i < state.series.length; i++) {
            if (state.series[i].id === id) return state.series[i];
        }
        return null;
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

    function cpiYoy(pts) {
        var cur = latestPoint(pts);
        var prev = pointMonthsAgo(pts, 12);
        if (!cur || !prev || !prev.value) return null;
        return ((cur.value / prev.value) - 1) * 100;
    }

    function monthLabel(p) {
        if (!p) return "—";
        return p.periodName.slice(0, 3) + " " + p.year;
    }

    function formatValue(meta, val) {
        if (!Number.isFinite(val)) return "—";
        if (meta.fmt === "pct") return fmtPct(val);
        if (meta.fmt === "emp") return fmtEmpK(val);
        if (meta.fmt === "money") return fmtMoney(val);
        return fmtIndex(val);
    }

    function barRow(labelText, value, max, color, highlight) {
        var pct = max > 0 ? Math.max(3, (value / max) * 100) : 0;
        return "<div class=\"dc-bar-row" + (highlight ? " bls-bar-latest" : "") + "\">" +
            "<span class=\"dc-bar-label\">" + labelText + "</span>" +
            "<div class=\"dc-bar-track\"><div class=\"dc-bar-fill\" style=\"width:" + pct + "%;background:" + color + "\"></div></div>" +
            "<span class=\"dc-bar-value\">" + value.toFixed(1) + "%</span></div>";
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

        if (cfg.baseline != null && cfg.baseline >= yMin && cfg.baseline <= yMax) {
            var by = yAt(cfg.baseline);
            html += "<line x1=\"" + pad.left + "\" y1=\"" + by.toFixed(1) + "\" x2=\"" + (w - pad.right) +
                "\" y2=\"" + by.toFixed(1) + "\" stroke=\"#94a3b8\" stroke-dasharray=\"5 4\" stroke-opacity=\"0.5\"/>";
            html += "<text x=\"" + (pad.left + 6) + "\" y=\"" + (by - 6).toFixed(1) +
                "\" fill=\"#94a3b8\" font-size=\"10\">" + esc(cfg.baselineLabel || "") + "</text>";
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

        html += "<polygon points=\"" + area + "\" fill=\"url(#" + gid + ")\"/>";
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
            var lbl = cfg.formatEnd
                ? cfg.formatEnd(last.value)
                : (cfg.formatY ? cfg.formatY(last.value) : last.value.toFixed(1));
            html += "<circle cx=\"" + lx.toFixed(1) + "\" cy=\"" + ly.toFixed(1) + "\" r=\"4\" fill=\"" + cfg.color + "\"/>";
            html += "<text x=\"" + (lx + 8).toFixed(1) + "\" y=\"" + (ly + 4).toFixed(1) +
                "\" fill=\"" + cfg.color + "\" font-size=\"12\" font-weight=\"700\">" + esc(lbl) + "</text>";
        }

        yearTickIndexes(pts).forEach(function (i) {
            html += "<text x=\"" + xAt(i).toFixed(1) + "\" y=\"" + (h - 10) +
                "\" text-anchor=\"middle\" fill=\"#94a3b8\" font-size=\"10\">" + pts[i].year + "</text>";
        });

        return html + "</svg>";
    }

    function yearTickIndexes(pts) {
        var n = pts.length;
        if (!n) return [];
        var tickEvery = Math.max(1, Math.floor(n / 5));
        var minGap = Math.max(tickEvery, Math.round(n * 0.12));
        var idxs = [];
        var i;
        for (i = 0; i < n; i += tickEvery) idxs.push(i);
        var last = n - 1;
        var prev = idxs[idxs.length - 1];
        if (last - prev >= minGap) {
            idxs.push(last);
        } else if (pts[last].year !== pts[prev].year) {
            idxs[idxs.length - 1] = last;
        }
        var out = [];
        idxs.forEach(function (idx) {
            if (!out.length || pts[idx].year !== pts[out[out.length - 1]].year) out.push(idx);
        });
        return out;
    }

    function svgBarYoyChart(pts, aria) {
        var w = 360;
        var h = 240;
        var pad = { top: 24, right: 16, bottom: 32, left: 48 };
        var plotW = w - pad.left - pad.right;
        var plotH = h - pad.top - pad.bottom;
        if (!pts || !pts.length) {
            return "<p class=\"dash-map-note\">" + (lang() === "en" ? "No data to plot." : "Brak danych do wykresu.") + "</p>";
        }
        var vals = pts.map(function (p) { return p.value; });
        var yMin = Math.min(0, Math.min.apply(null, vals)) - 0.5;
        var yMax = Math.max.apply(null, vals) + 0.8;
        var n = pts.length;
        var gap = plotW / n;
        var barW = Math.max(2, gap * 0.72);
        function yAt(v) { return pad.top + (1 - (v - yMin) / (yMax - yMin)) * plotH; }
        var zeroY = yAt(0);
        var html = "<svg class=\"bls-svg\" width=\"" + w + "\" height=\"" + h +
            "\" viewBox=\"0 0 " + w + " " + h + "\" preserveAspectRatio=\"xMidYMid meet\" style=\"aspect-ratio:" + w + "/" + h +
            "\" role=\"img\" aria-label=\"" + esc(aria || "") + "\">";
        html += "<rect width=\"" + w + "\" height=\"" + h + "\" rx=\"8\" fill=\"rgba(15,23,42,0.85)\"/>";
        html += "<line x1=\"" + pad.left + "\" y1=\"" + zeroY.toFixed(1) + "\" x2=\"" + (w - pad.right) +
            "\" y2=\"" + zeroY.toFixed(1) + "\" stroke=\"#94a3b8\" stroke-opacity=\"0.4\"/>";
        html += "<text x=\"" + (pad.left - 8) + "\" y=\"" + (zeroY + 3).toFixed(1) +
            "\" text-anchor=\"end\" fill=\"#94a3b8\" font-size=\"10\">0%</text>";
        pts.forEach(function (p, i) {
            var x = pad.left + i * gap + (gap - barW) / 2;
            var y = yAt(p.value);
            var top = Math.min(y, zeroY);
            var bh = Math.max(1, Math.abs(zeroY - y));
            var color = p.value >= 6 ? "#f87171" : p.value >= 3 ? "#fbbf24" : "#86efac";
            html += "<rect x=\"" + x.toFixed(1) + "\" y=\"" + top.toFixed(1) + "\" width=\"" + barW.toFixed(1) +
                "\" height=\"" + bh.toFixed(1) + "\" fill=\"" + color + "\"/>";
        });
        var peak = peakPoint(pts);
        if (peak) {
            var pi = pts.indexOf(peak);
            var px = pad.left + pi * gap + gap / 2;
            html += "<text x=\"" + px.toFixed(1) + "\" y=\"" + (pad.top - 6) +
                "\" text-anchor=\"middle\" fill=\"#fca5a5\" font-size=\"10\" font-weight=\"600\">" +
                peak.value.toFixed(1) + "%</text>";
        }
        yearTickIndexes(pts).forEach(function (i) {
            html += "<text x=\"" + (pad.left + i * gap + gap / 2).toFixed(1) + "\" y=\"" + (h - 8) +
                "\" text-anchor=\"middle\" fill=\"#94a3b8\" font-size=\"9\">" + pts[i].year + "</text>";
        });
        return html + "</svg>";
    }

    function buildLaborInsights(unempPts, partPts, nfPts) {
        var en = lang() === "en";
        var u = filteredPoints(unempPts);
        var peak = peakPoint(u);
        var cur = latestPoint(unempPts);
        var pre = findPoint(u, 2020, 2) || findPoint(u, 2019, 12);
        var partCur = latestPoint(partPts);
        var nfCur = latestPoint(nfPts);
        var nfTrough = findPoint(filteredPoints(nfPts), 2020, 4);
        var insights = [];

        if (peak && cur) {
            insights.push({
                tone: "warn",
                text: en
                    ? "In " + monthLabel(peak) + " unemployment surged to <strong>" + fmtPct(peak.value) + "</strong> — the COVID shock. Before that it was around <strong>" + (pre ? fmtPct(pre.point.value) : "3.5%") + "</strong>."
                    : "W " + monthLabel(peak) + " bezrobocie skoczyło do <strong>" + fmtPct(peak.value) + "</strong> — szok pandemii. Wcześniej było około <strong>" + (pre ? fmtPct(pre.point.value) : "3,5%") + "</strong>."
            });
        }
        if (cur && pre) {
            var back = cur.value <= pre.point.value + 0.8;
            insights.push({
                tone: back ? "ok" : "neutral",
                text: en
                    ? "Latest reading: <strong>" + fmtPct(cur.value) + "</strong> (" + monthLabel(cur) + ")" + (back ? " — back near pre-pandemic levels." : " — still above the pre-pandemic level.")
                    : "Ostatni odczyt: <strong>" + fmtPct(cur.value) + "</strong> (" + monthLabel(cur) + ")" + (back ? " — z powrotem blisko poziomu sprzed pandemii." : " — wciąż powyżej poziomu sprzed pandemii.")
            });
        }
        if (partCur) {
            insights.push({
                tone: "neutral",
                text: en
                    ? "Labour force participation is <strong>" + fmtPct(partCur.value) + "</strong> — the share of adults who work or actively look for work."
                    : "Aktywność zawodowa to <strong>" + fmtPct(partCur.value) + "</strong> — odsetek dorosłych, którzy pracują lub aktywnie szukają pracy."
            });
        }
        if (nfTrough && nfCur) {
            insights.push({
                tone: "warn",
                text: en
                    ? "Nonfarm jobs fell sharply in spring 2020, then recovered to <strong>" + fmtEmpK(nfCur.value) + "</strong> today."
                    : "Miejsca pracy poza rolnictwem mocno spadły wiosną 2020, dziś jest ich z powrotem <strong>" + fmtEmpK(nfCur.value) + "</strong>."
            });
        }
        return insights;
    }

    function insightsHtml(list) {
        return list.map(function (item) {
            return "<div class=\"bls-insight bls-insight-" + item.tone + "\">" + item.text + "</div>";
        }).join("");
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
                ? "Custom JavaScript + HTML Canvas, no charting library. Monthly time series from the BLS Public Data API v2."
                : "Własny JavaScript + HTML Canvas, bez biblioteki wykresów. Szeregi czasowe miesięczne z BLS Public Data API v2.") +
            "</div>";
    }

    function buildYoySeries(cpiPts) {
        var out = [];
        cpiPts.forEach(function (p, i) {
            if (i < 12) return;
            var prev = cpiPts[i - 12];
            if (!Number.isFinite(p.value) || !Number.isFinite(prev.value) || !prev.value) return;
            out.push({
                year: p.year,
                month: p.month,
                value: ((p.value / prev.value) - 1) * 100,
                label: monthLabel(p)
            });
        });
        return out.filter(function (p) { return p.year >= state.rangeStart; });
    }

    function comparisonTable() {
        var en = lang() === "en";
        var ids = ["LNS14000000", "LNS11300000", "CES0000000001", "CUUR0000SA0", "CES0500000003"];
        var html = "<table class=\"dc-table dash-table\"><thead><tr>" +
            "<th>" + (en ? "Indicator" : "Wskaźnik") + "</th>" +
            "<th>" + (en ? "Latest month" : "Ostatni miesiąc") + "</th>" +
            "<th>" + (en ? "One year ago" : "Rok temu") + "</th>" +
            "<th>" + (en ? "Two years ago" : "Dwa lata temu") + "</th>" +
            "<th>" + (en ? "Change over 12 months" : "Zmiana w ciągu roku") + "</th>" +
            "</tr></thead><tbody>";
        ids.forEach(function (id) {
            var s = getSeries(id);
            if (!s) return;
            var cur = latestPoint(s.points);
            var m12 = pointMonthsAgo(s.points, 12);
            var m24 = pointMonthsAgo(s.points, 24);
            var delta = cur && m12 ? fmtDelta(cur.value, m12.value, s.meta.fmt) : "—";
            html += "<tr>" +
                "<td>" + plainLabel(id, s.meta) + "</td>" +
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
                ? "Live data from the US Bureau of Labor Statistics (BLS)."
                : "Dane na żywo z amerykańskiego urzędu statystyki pracy (BLS).";
        }
        if (state.source === "snapshot-fallback") {
            return en
                ? "Fallback snapshot — the live BLS request did not succeed."
                : "Snapshot zapasowy — żywe API BLS nie odpowiedziało.";
        }
        return en
            ? "Embedded snapshot of BLS data (offline / GitHub Pages)."
            : "Osadzony snapshot danych BLS (offline / GitHub Pages).";
    }

    function renderStatus() {
        var el = document.getElementById("bls-status");
        if (!el) return;
        var en = lang() === "en";
        if (state.loading) {
            el.textContent = en ? "Loading labor market data…" : "Wczytywanie danych o rynku pracy…";
            return;
        }
        var when = state.fetchedAt
            ? new Date(state.fetchedAt).toLocaleString(lang() === "en" ? "en-GB" : "pl-PL")
            : "";
        el.textContent = sourceLabel() + (when
            ? (en ? " Data downloaded: " : " Pobrano: ") + when + "."
            : ".");
    }

    function buildSummary(uCur, yoy, nfCur, earnCur) {
        var en = lang() === "en";
        if (!uCur) return "";
        var month = monthLabel(uCur);
        var parts = [];
        if (en) {
            parts.push("Latest available month: <strong>" + month + "</strong>.");
            parts.push("Unemployment rate is <strong>" + fmtPct(uCur.value) + "</strong>.");
            if (Number.isFinite(yoy)) parts.push("Inflation (year on year) is <strong>" + fmtPct(yoy) + "</strong>.");
            if (nfCur) parts.push("There are about <strong>" + fmtEmpK(nfCur.value) + "</strong> nonfarm jobs.");
            if (earnCur) parts.push("Average hourly pay is <strong>" + fmtMoney(earnCur.value) + "</strong>.");
        } else {
            parts.push("Ostatni dostępny miesiąc: <strong>" + month + "</strong>.");
            parts.push("Stopa bezrobocia wynosi <strong>" + fmtPct(uCur.value) + "</strong>.");
            if (Number.isFinite(yoy)) parts.push("Inflacja rok do roku to <strong>" + fmtPct(yoy) + "</strong>.");
            if (nfCur) parts.push("Jest około <strong>" + fmtEmpK(nfCur.value) + "</strong> miejsc pracy poza rolnictwem.");
            if (earnCur) parts.push("Średnia stawka godzinowa to <strong>" + fmtMoney(earnCur.value) + "</strong>.");
        }
        return parts.join(" ");
    }

    function render() {
        if (!state.series.length) return;
        var en = lang() === "en";

        var unemp = getSeries("LNS14000000");
        var part = getSeries("LNS11300000");
        var nonfarm = getSeries("CES0000000001");
        var cpi = getSeries("CUUR0000SA0");
        var earnings = getSeries("CES0500000003");
        if (!unemp || !part || !nonfarm || !cpi || !earnings) return;

        var uCur = latestPoint(unemp.points);
        var u12 = pointMonthsAgo(unemp.points, 12);
        var pCur = latestPoint(part.points);
        var nfCur = latestPoint(nonfarm.points);
        var nf12 = pointMonthsAgo(nonfarm.points, 12);
        var cpiCur = latestPoint(cpi.points);
        var yoy = cpiYoy(cpi.points);
        var yoy12 = (function () {
            var prev = pointMonthsAgo(cpi.points, 13);
            var cur = pointMonthsAgo(cpi.points, 1);
            if (!cur || !prev || !prev.value) return null;
            return ((cur.value / prev.value) - 1) * 100;
        })();
        var earnCur = latestPoint(earnings.points);
        var earn12 = pointMonthsAgo(earnings.points, 12);

        var unempBars = filteredPoints(unemp.points).slice(-24);
        var maxU = Math.max.apply(null, unempBars.map(function (p) { return p.value; }).concat([1]));

        var unempLine = filteredPoints(unemp.points);
        var partLine = filteredPoints(part.points);
        var nfLine = filteredPoints(nonfarm.points).map(function (p) { return { value: p.value / 1000, year: p.year, month: p.month }; });
        var cpiLine = filteredPoints(cpi.points);
        var earnLine = filteredPoints(earnings.points);
        var yoyLine = buildYoySeries(validPoints(cpi.points));
        var laborInsights = buildLaborInsights(unemp.points, part.points, nonfarm.points);
        var uPeak = peakPoint(unempLine);
        var preCovidU = findPoint(unempLine, 2020, 2);
        var latestBarIdx = unempBars.length - 1;
        var covidLabel = lang() === "en" ? "COVID-19" : "Pandemia";
        var jobsTrough = findPoint(nfLine, 2020, 4);
        var nfPre = findPoint(nfLine, 2020, 2);
        var yoyPeak = peakPoint(yoyLine);
        var uBarFirst = unempBars[0];
        var uBarLast = unempBars.length ? unempBars[unempBars.length - 1] : null;
        var earnFirst = earnLine.length ? earnLine[0] : null;
        var cpiFirst = cpiLine.length ? cpiLine[0] : null;

        function takeUnemp24() {
            if (!uBarFirst || !uBarLast) return "";
            var d = uBarLast.value - uBarFirst.value;
            if (Math.abs(d) < 0.4) {
                return en
                    ? "Over these 24 months unemployment stays around " + fmtPct(uBarLast.value) + " — no sharp move."
                    : "W tych 24 miesiącach bezrobocie trzyma się koło " + fmtPct(uBarLast.value) + " — bez ostrego skoku.";
            }
            return en
                ? (d > 0 ? "It rose from " : "It fell from ") + fmtPct(uBarFirst.value) + " to " + fmtPct(uBarLast.value) + "."
                : (d > 0 ? "Wzrosło z " : "Spadło z ") + fmtPct(uBarFirst.value) + " do " + fmtPct(uBarLast.value) + ".";
        }
        function takeJobs() {
            if (!nfCur || !nfPre) return en
                ? "The dip in 2020 is layoffs; the climb after that is jobs returning."
                : "Dołek 2020 to zwolnienia; wzrost potem to powrót etatów.";
            var now = nfCur.value / 1000;
            var then = nfPre.point.value;
            var recovered = now >= then;
            return en
                ? (recovered
                    ? "Payrolls are back above the pre-COVID level (" + now.toFixed(1) + "M vs " + then.toFixed(1) + "M in Feb 2020)."
                    : "Payrolls are still below Feb 2020 (" + now.toFixed(1) + "M vs " + then.toFixed(1) + "M).")
                : (recovered
                    ? "Etatów jest już więcej niż przed pandemią (" + now.toFixed(1).replace(".", ",") + " mln vs " + then.toFixed(1).replace(".", ",") + " mln w lutym 2020)."
                    : "Etatów jest nadal mniej niż w lutym 2020 (" + now.toFixed(1).replace(".", ",") + " mln vs " + then.toFixed(1).replace(".", ",") + " mln).");
        }
        function takeInflation() {
            if (!Number.isFinite(yoy) || !yoyPeak) {
                return en ? "Green = low inflation, red = high. The 2022 peak stands out." : "Zielony = niska inflacja, czerwony = wysoka. Wyróżnia się szczyt 2022.";
            }
            return en
                ? "Inflation peaked at " + fmtPct(yoyPeak.value) + " (" + (yoyPeak.label || monthLabel(yoyPeak)) + "). The latest reading is " + fmtPct(yoy) + "."
                : "Szczyt inflacji to " + fmtPct(yoyPeak.value) + " (" + (yoyPeak.label || monthLabel(yoyPeak)) + "). Ostatni odczyt: " + fmtPct(yoy) + ".";
        }
        function takeWages() {
            if (!earnCur || !earnFirst) return "";
            return en
                ? "The hourly wage rose from " + fmtMoney(earnFirst.value) + " to " + fmtMoney(earnCur.value) + ". These are nominal dollars — purchasing power is the wage line versus the inflation bars."
                : "Stawka wzrosła z " + fmtMoney(earnFirst.value) + " do " + fmtMoney(earnCur.value) + ". To kwoty nominalne — siłę nabywczą widać, porównując tę linię ze słupkami inflacji.";
        }
        function takeCpi() {
            if (!cpiCur || !cpiFirst) return "";
            return en
                ? "The price index rose from " + fmtIndex(cpiFirst.value) + " to " + fmtIndex(cpiCur.value) + " since 2018. This is the level of prices, not the inflation rate."
                : "Indeks cen wzrósł z " + fmtIndex(cpiFirst.value) + " do " + fmtIndex(cpiCur.value) + " od 2018. To poziom cen, nie tempo inflacji.";
        }

        var chartUnemp = svgSeriesChart({
            points: unempLine, width: 480, height: 220, color: "#f87171",
            yMin: 0, floorZero: true, endLabel: true,
            formatY: function (v) { return v.toFixed(0) + "%"; },
            formatEnd: function (v) { return fmtPct(v); },
            baseline: preCovidU ? preCovidU.point.value : 3.5,
            baselineLabel: en
                ? "Pre-COVID ~" + (preCovidU ? preCovidU.point.value.toFixed(1) : "3.5") + "%"
                : "Przed COVID ~" + (preCovidU ? preCovidU.point.value.toFixed(1) : "3,5") + "%",
            markers: [{ year: 2020, month: 4, label: covidLabel, color: "#f87171" }],
            highlights: uPeak ? [{ year: uPeak.year, month: uPeak.month, text: fmtPct(uPeak.value), dy: -12 }] : [],
            aria: en ? "Unemployment rate over time" : "Stopa bezrobocia w czasie"
        });
        var chartPart = svgSeriesChart({
            points: partLine, width: 480, height: 220, color: "#38bdf8", endLabel: true,
            formatY: function (v) { return v.toFixed(1) + "%"; },
            markers: [{ year: 2020, month: 4, label: covidLabel, color: "#f87171" }],
            aria: en ? "Labour force participation over time" : "Aktywność zawodowa w czasie"
        });
        var chartJobs = svgSeriesChart({
            points: nfLine, width: 720, height: 240, color: "#86efac", endLabel: true,
            formatY: function (v) { return v.toFixed(0) + " mln"; },
            markers: [{ year: 2020, month: 4, label: covidLabel, color: "#f87171" }],
            highlights: jobsTrough ? [{ index: jobsTrough.index, text: jobsTrough.point.value.toFixed(1) + " mln", dy: 16 }] : [],
            aria: en ? "Nonfarm jobs over time" : "Miejsca pracy poza rolnictwem w czasie"
        });
        var chartYoy = svgBarYoyChart(yoyLine, en ? "Inflation year on year" : "Inflacja rok do roku");
        var chartEarn = svgSeriesChart({
            points: earnLine, width: 360, height: 240, color: "#7dd3fc", endLabel: true,
            formatY: function (v) { return "$" + v.toFixed(2); },
            aria: en ? "Average hourly wage" : "Średnia stawka godzinowa"
        });
        var chartCpi = svgSeriesChart({
            points: cpiLine, width: 720, height: 220, color: "#fbbf24", endLabel: true,
            formatY: function (v) { return v.toFixed(0); },
            markers: [{ year: 2022, month: 6, label: en ? "Peak inflation" : "Szczyt inflacji", color: "#fbbf24" }],
            aria: en ? "Consumer price index" : "Indeks cen konsumpcyjnych"
        });

        root.innerHTML =
            "<div class=\"dash-toolbar\">" +
            "<div class=\"dash-filters\" role=\"group\" aria-label=\"" + (en ? "Chart time range" : "Zakres wykresów") + "\">" +
            "<button type=\"button\" class=\"dash-filter" + (state.rangeStart === 2018 ? " active" : "") + "\" data-range=\"2018\">" +
            (en ? "Full period (from 2018)" : "Cały okres (od 2018)") + "</button>" +
            "<button type=\"button\" class=\"dash-filter" + (state.rangeStart === 2020 ? " active" : "") + "\" data-range=\"2020\">" +
            (en ? "From 2020 (pandemic era)" : "Od 2020 (okres pandemii)") + "</button>" +
            "</div>" +
            "<button type=\"button\" class=\"btn btn-outline dash-refresh\" id=\"bls-refresh\">" + (en ? "Refresh data" : "Odśwież dane") + "</button>" +
            "</div>" +
            "<p class=\"dash-status\" id=\"bls-status\"></p>" +
            "<p class=\"dash-summary\">" + buildSummary(uCur, yoy, nfCur, earnCur) + "</p>" +
            vizGuide([
                {
                    title: en ? "Unemployment line" : "Linia bezrobocia",
                    text: en ? "Monthly % of people without work — the COVID spike in 2020 is the main story." : "Miesięczny % osób bez pracy — główna historia to skok w 2020."
                },
                {
                    title: en ? "Participation line" : "Linia aktywności",
                    text: en ? "% of adults working or actively job-hunting — fell in 2020, partially recovered." : "% dorosłych pracujących lub szukających pracy — spadek w 2020, częściowy powrót."
                },
                {
                    title: en ? "Jobs line" : "Linia zatrudnienia",
                    text: en ? "Total payroll jobs outside farming — volume of the labour market." : "Łączna liczba etatów poza rolnictwem — skala rynku pracy."
                },
                {
                    title: en ? "Inflation bars" : "Słupki inflacji",
                    text: en ? "Year-on-year price change — green = low, red = high inflation." : "Zmiana cen rok do roku — zielony = niska, czerwony = wysoka inflacja."
                },
                {
                    title: en ? "Comparison table" : "Tabela porównawcza",
                    text: en ? "Latest month vs one and two years ago — numeric proof behind the charts." : "Ostatni miesiąc vs rok i dwa lata temu — liczby potwierdzające wykresy."
                }
            ]) +
            "<div class=\"dash-kpi-grid\">" +
            "<div class=\"dash-kpi\"><strong>" + (uCur ? fmtPct(uCur.value) : "—") + "</strong>" +
            "<span>" + (en ? "Unemployment rate" : "Stopa bezrobocia") + "</span>" +
            (u12 ? "<small class=\"dash-kpi-delta\">" + fmtDelta(uCur.value, u12.value, "pct") + "</small>" : "") + "</div>" +
            "<div class=\"dash-kpi\"><strong>" + (pCur ? fmtPct(pCur.value) : "—") + "</strong>" +
            "<span>" + (en ? "Share of people in the labour force" : "Udział osób aktywnych zawodowo") + "</span></div>" +
            "<div class=\"dash-kpi\"><strong>" + (nfCur ? fmtEmpK(nfCur.value) : "—") + "</strong>" +
            "<span>" + (en ? "Nonfarm jobs (millions)" : "Miejsca pracy poza rolnictwem") + "</span>" +
            (nf12 ? "<small class=\"dash-kpi-delta\">" + fmtDelta(nfCur.value, nf12.value, "emp") + "</small>" : "") + "</div>" +
            "<div class=\"dash-kpi\"><strong>" + (Number.isFinite(yoy) ? fmtPct(yoy) : "—") + "</strong>" +
            "<span>" + (en ? "Inflation, year on year" : "Inflacja rok do roku") + "</span>" +
            (Number.isFinite(yoy12) ? "<small class=\"dash-kpi-delta\">" + fmtDelta(yoy, yoy12, "yoy") + "</small>" : "") + "</div>" +
            "<div class=\"dash-kpi\"><strong>" + (cpiCur ? fmtIndex(cpiCur.value) : "—") + "</strong>" +
            "<span>" + (en ? "Consumer price index (CPI)" : "Indeks cen konsumpcyjnych (CPI)") + "</span></div>" +
            "<div class=\"dash-kpi\"><strong>" + (earnCur ? fmtMoney(earnCur.value) : "—") + "</strong>" +
            "<span>" + (en ? "Average hourly wage" : "Średnia stawka godzinowa") + "</span>" +
            (earn12 ? "<small class=\"dash-kpi-delta\">" + fmtDelta(earnCur.value, earn12.value, "money") + "</small>" : "") + "</div>" +
            "</div>" +
            "<div class=\"dash-grid\">" +
            vizSection(en ? "1 · Labour market shock & recovery" : "1 · Szok na rynku pracy i odbicie") +
            "<div class=\"dash-panel dash-panel-wide bls-story-panel\">" +
            "<h4>" + (en ? "Narrative — what happened since 2018" : "Narracja — co wydarzyło się od 2018") + "</h4>" +
            vizDesc(
                en ? "Read the notes first, then the two line charts — same story in words and in data."
                    : "Najpierw zdania, potem dwa wykresy — ta sama historia słowami i liczbami.",
                en ? "April 2020 is the shock: unemployment spikes, participation drops. Both charts need their own scale."
                    : "Kwiecień 2020 to szok: bezrobocie skacze, aktywność spada. Każdy wykres ma własną skalę — nie porównuj wysokości linii."
            ) +
            insightsHtml(laborInsights) +
            "<div class=\"bls-chart-split\">" +
            "<div class=\"bls-chart-box\">" +
            chartHead(
                en ? "Line chart — unemployment" : "Wykres liniowy — bezrobocie",
                uCur ? fmtPct(uCur.value) : "—",
                en ? "Share of people without a job" : "Odsetek osób bez pracy"
            ) +
            vizDesc(
                en ? "Y axis starts at 0% so the 2020 spike to ~15% is visible. Dashed line = pre-COVID level (~3.5%)."
                    : "Oś Y od 0%, żeby widać skok do ~15% w 2020. Linia przerywana = poziom sprzed COVID (~3,5%).",
                null
            ) +
            chartUnemp + "</div>" +
            "<div class=\"bls-chart-box\">" +
            chartHead(
                en ? "Line chart — participation" : "Wykres liniowy — aktywność",
                pCur ? fmtPct(pCur.value) : "—",
                en ? "Working or actively looking for work" : "Pracują lub aktywnie szukają pracy"
            ) +
            vizDesc(
                en ? "Separate scale (~58–65%) — do not compare height with the unemployment chart; read each on its own axis."
                    : "Osobna skala (~58–65%) — nie porównuj wysokości z wykresem bezrobocia; każdy czytaj na własnej osi.",
                null
            ) +
            chartPart + "</div>" +
            "</div></div>" +
            "<div class=\"dash-panel dash-panel-wide\">" +
            "<h4>" + (en ? "Bar chart — unemployment by month" : "Wykres słupkowy — bezrobocie wg miesiąca") + "</h4>" +
            vizDesc(
                en ? "Only the last 24 months — the long line chart above is history; this is the recent path month by month."
                    : "Tylko ostatnie 24 miesiące — długi wykres powyżej to historia, tu widać bieżący przebieg miesiąc po miesiącu.",
                takeUnemp24()
            ) +
            "<div class=\"dash-bars-fill\">" +
            unempBars.map(function (p, i) {
                return barRow(p.periodName.slice(0, 3) + " " + p.year, p.value, maxU, "#f87171", i === latestBarIdx);
            }).join("") +
            "</div></div>" +
            vizSection(en ? "2 · Jobs, prices & wages" : "2 · Praca, ceny i płace") +
            "<div class=\"dash-panel dash-panel-wide\">" +
            chartHead(
                en ? "Line chart — nonfarm jobs" : "Wykres liniowy — miejsca pracy",
                nfCur ? fmtEmpK(nfCur.value) : "—",
                en ? "Millions of payroll jobs" : "Liczba etatów w milionach"
            ) +
            vizDesc(
                en ? "Payroll jobs outside farming. The 2020 hole is the lockdown; the climb is the recovery."
                    : "Etatów poza rolnictwem. Dziura 2020 to lockdown; wzrost potem to odbicie rynku pracy.",
                takeJobs()
            ) +
            chartJobs + "</div>" +
            "<div class=\"dash-panel\">" +
            chartHead(
                en ? "Bar chart — inflation YoY" : "Wykres słupkowy — inflacja r/r",
                Number.isFinite(yoy) ? fmtPct(yoy) : "—",
                en ? "Price change vs same month last year" : "Zmiana cen vs ten sam miesiąc rok temu"
            ) +
            vizDesc(
                en ? "Each bar is one month: prices vs the same month a year earlier. Green under 3%, yellow 3–6%, red above 6%."
                    : "Każdy słupek to miesiąc: ceny vs ten sam miesiąc rok wcześniej. Zielony poniżej 3%, żółty 3–6%, czerwony powyżej 6%.",
                takeInflation()
            ) +
            chartYoy + "</div>" +
            "<div class=\"dash-panel\">" +
            chartHead(
                en ? "Line chart — hourly wage" : "Wykres liniowy — stawka godzinowa",
                earnCur ? fmtMoney(earnCur.value) : "—",
                en ? "Total private sector average" : "Średnia w sektorze prywatnym"
            ) +
            vizDesc(
                en ? "Average hourly pay in the private sector, in dollars — not adjusted for inflation."
                    : "Średnia stawka w sektorze prywatnym, w dolarach — bez korekty o inflację.",
                takeWages()
            ) +
            chartEarn + "</div>" +
            "<div class=\"dash-panel dash-panel-wide\">" +
            chartHead(
                en ? "Line chart — CPI index level" : "Wykres liniowy — poziom indeksu CPI",
                cpiCur ? fmtIndex(cpiCur.value) : "—",
                en ? "Absolute price index (not % change)" : "Poziom indeksu cen (nie % zmiany)"
            ) +
            vizDesc(
                en ? "CPI all-items index. It almost always rises; the speed of that rise is the inflation chart above."
                    : "Indeks CPI (wszystkie towary i usługi). Prawie zawsze rośnie; tempo tego wzrostu jest na wykresie inflacji powyżej.",
                takeCpi()
            ) +
            chartCpi + "</div>" +
            vizSection(en ? "3 · Numbers behind the charts" : "3 · Liczby za wykresami") +
            "<div class=\"dash-panel dash-panel-wide\">" +
            "<h4>" + (en ? "Table — 12-month and 24-month comparison" : "Tabela — porównanie 12 i 24 miesięcy") + "</h4>" +
            vizDesc(
                en ? "The same indicators as the charts, as exact numbers: latest month vs one and two years earlier."
                    : "Te same wskaźniki co na wykresach, jako dokładne liczby: ostatni miesiąc vs rok i dwa lata wcześniej.",
                en ? "Use this table when you need the figure, not the shape of the line."
                    : "Ta tabela jest od konkretnej liczby, nie od kształtu linii."
            ) +
            comparisonTable() +
            "</div>" +
            methodNote() +
            "<div class=\"dash-panel dash-panel-wide dash-api\">" +
            "<h4>" + (en ? "Where the data comes from" : "Skąd pochodzą dane") + "</h4>" +
            "<p class=\"dash-api-note\">" + (en
                ? "Monthly US labour market statistics from the Bureau of Labor Statistics (BLS), fetched via their public API. Indicators: unemployment, participation, payroll jobs, consumer prices and hourly wages."
                : "Miesięczne statystyki rynku pracy w USA z urzędu BLS, pobrane przez publiczne API. Wskaźniki: bezrobocie, aktywność, zatrudnienie, ceny konsumpcyjne i stawki godzinowe.") +
            "</p>" +
            "<pre class=\"hero-code dc-code\"><code>POST " + API_URL + "\n{\n  \"seriesid\": " + JSON.stringify(SERIES_IDS, null, 2).replace(/\n/g, "\n  ") + ",\n  \"startyear\": \"2018\",\n  \"endyear\": \"2025\"\n}</code></pre>" +
            "<p class=\"dash-api-cite\"><a href=\"https://www.bls.gov/developers/api_signature_v2.htm\" target=\"_blank\" rel=\"noopener\">BLS Public Data API v2</a> · " +
            "<a href=\"https://www.bls.gov/audience/developers.htm\" target=\"_blank\" rel=\"noopener\">Developer portal</a></p></div></div>";

        renderStatus();

        root.querySelectorAll("[data-range]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                state.rangeStart = +btn.getAttribute("data-range");
                render();
            });
        });
        var refreshBtn = document.getElementById("bls-refresh");
        if (refreshBtn) refreshBtn.addEventListener("click", fetchLive);
    }

    function isPanelVisible() {
        var panel = document.getElementById("bls-labor");
        return panel && !panel.hidden;
    }

    function paintCharts() {
        if (!state.series.length || !root) return;
        render();
    }

    window.__blsRerender = paintCharts;

    document.querySelectorAll("[data-set-lang]").forEach(function (btn) {
        btn.addEventListener("click", function () { setTimeout(paintCharts, 0); });
    });

    var blsPanel = document.getElementById("bls-labor");
    if (blsPanel && typeof MutationObserver !== "undefined") {
        new MutationObserver(function () {
            if (!blsPanel.hidden) paintCharts();
        }).observe(blsPanel, { attributes: true, attributeFilter: ["hidden"] });
    }

    if (!loadSnapshot()) showError();
    fetchLive().finally(function () {
        if (isPanelVisible()) paintCharts();
    });
})();
