(function () {
    var root = document.getElementById("opensky-dashboard");
    if (!root) return;

    var BBOX = { lamin: 49, lomin: 14, lamax: 55, lomax: 24 };
    var API_URL = "https://opensky-network.org/api/states/all?" +
        "lamin=" + BBOX.lamin + "&lomin=" + BBOX.lomin +
        "&lamax=" + BBOX.lamax + "&lomax=" + BBOX.lomax + "&extended=1";

    var CAT_LABELS = {
        pl: { 0: "Bez kategorii", 1: "Brak ADS-B", 2: "Lekki", 3: "Mały", 4: "Duży", 5: "Ciężki odrzutowiec", 6: "Ciężki", 7: "Wys. osiągi", 8: "Śmigłowiec", 9: "Szybowiec", 10: "Balon", 11: "Spadochron", 14: "BSP" },
        en: { 0: "Uncategorized", 1: "No ADS-B cat.", 2: "Light", 3: "Small", 4: "Large", 5: "Heavy jet", 6: "Heavy", 7: "High perf.", 8: "Rotorcraft", 9: "Glider", 10: "Lighter-than-air", 11: "Parachute", 14: "UAV" }
    };

    var state = {
        aircraft: [],
        source: "snapshot",
        time: null,
        fetchedAt: null,
        filter: "all",
        loading: false
    };

    function lang() {
        return document.documentElement.getAttribute("data-lang") === "en" ? "en" : "pl";
    }

    function fmtInt(n) {
        return Number(n).toLocaleString(lang() === "en" ? "en-US" : "pl-PL");
    }

    function fmtTime(unix) {
        if (!unix) return "—";
        return new Date(unix * 1000).toLocaleString(lang() === "en" ? "en-GB" : "pl-PL", {
            hour: "2-digit", minute: "2-digit", second: "2-digit",
            day: "2-digit", month: "short"
        });
    }

    function mapRow(s, fromApi) {
        if (fromApi) {
            return {
                icao24: s[0],
                callsign: (s[1] || "").trim(),
                country: s[2] || "—",
                lon: s[5],
                lat: s[6],
                alt: s[7],
                onGround: !!s[8],
                velocity: s[9],
                heading: s[10],
                vrate: s[11],
                squawk: s[14] != null ? String(s[14]) : null,
                category: s[17]
            };
        }
        return {
            icao24: s.i,
            callsign: s.c || "",
            country: s.o || "—",
            lon: s.lon,
            lat: s.lat,
            alt: s.alt,
            onGround: !!s.g,
            velocity: s.v,
            heading: s.h,
            vrate: s.vr,
            squawk: s.sq,
            category: s.cat
        };
    }

    function parseList(states, fromApi) {
        return (states || []).map(function (s) { return mapRow(s, fromApi); })
            .filter(function (a) { return a.lat != null && a.lon != null; });
    }

    function applyData(payload, source) {
        state.aircraft = payload.aircraft;
        state.time = payload.time;
        state.fetchedAt = payload.fetchedAt;
        state.source = source;
        render();
    }

    function loadSnapshot() {
        var snap = window.OPENSKY_SNAPSHOT;
        if (!snap) return false;
        applyData({
            aircraft: parseList(snap.states, false),
            time: snap.time,
            fetchedAt: snap.fetchedAt
        }, "snapshot");
        return true;
    }

    function fetchLive() {
        state.loading = true;
        renderStatus();
        return fetch(API_URL)
            .then(function (r) {
                if (!r.ok) throw new Error("HTTP " + r.status);
                return r.json();
            })
            .then(function (data) {
                applyData({
                    aircraft: parseList(data.states, true),
                    time: data.time,
                    fetchedAt: new Date().toISOString()
                }, "live");
            })
            .catch(function () {
                if (!loadSnapshot()) showError();
                else state.source = "snapshot-cors";
            })
            .finally(function () {
                state.loading = false;
                render();
            });
    }

    function showError() {
        var en = lang() === "en";
        root.innerHTML = "<div class=\"dash-error\"><p>" + (en
            ? "Could not load data. OpenSky blocks direct browser calls from GitHub Pages (CORS)."
            : "Nie udało się wczytać danych. OpenSky blokuje bezpośrednie wywołania z GitHub Pages (CORS).") + "</p></div>";
    }

    function filtered() {
        if (state.filter === "air") return state.aircraft.filter(function (a) { return !a.onGround; });
        if (state.filter === "ground") return state.aircraft.filter(function (a) { return a.onGround; });
        return state.aircraft.slice();
    }

    function airborneOnly(rows) {
        return rows.filter(function (a) { return !a.onGround; });
    }

    function computeKpis(rows) {
        var air = airborneOnly(rows);
        var ground = rows.filter(function (a) { return a.onGround; });
        var countries = {};
        var poland = 0;
        var withCall = 0;
        rows.forEach(function (a) {
            countries[a.country] = true;
            if (a.country === "Poland") poland += 1;
            if (a.callsign) withCall += 1;
        });
        var alts = air.map(function (a) { return a.alt; }).filter(Number.isFinite);
        var vels = air.map(function (a) { return a.velocity; }).filter(Number.isFinite);
        function avg(arr) {
            return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : 0;
        }
        var maxAlt = alts.length ? Math.max.apply(null, alts) : 0;
        var vr = verticalRateStats(air);
        return {
            total: rows.length,
            airborne: air.length,
            ground: ground.length,
            countries: Object.keys(countries).length,
            poland: poland,
            withCallsign: withCall,
            avgAlt: avg(alts),
            avgVel: avg(vels),
            maxAlt: maxAlt,
            climbing: vr.climb,
            descending: vr.descend,
            level: vr.level
        };
    }

    function verticalRateStats(air) {
        var climb = 0;
        var descend = 0;
        var level = 0;
        air.forEach(function (a) {
            if (!Number.isFinite(a.vrate)) { level += 1; return; }
            if (a.vrate > 1) climb += 1;
            else if (a.vrate < -1) descend += 1;
            else level += 1;
        });
        return { climb: climb, descend: descend, level: level };
    }

    function topCountries(rows, n) {
        var counts = {};
        rows.forEach(function (a) { counts[a.country] = (counts[a.country] || 0) + 1; });
        var all = Object.keys(counts).map(function (k) { return { name: k, count: counts[k] }; })
            .sort(function (a, b) { return b.count - a.count; });
        var top = all.slice(0, n);
        var topSum = top.reduce(function (s, c) { return s + c.count; }, 0);
        var rest = rows.length - topSum;
        if (rest > 0) {
            top.push({
                name: lang() === "en" ? "Other countries" : "Pozostałe kraje",
                count: rest,
                isOther: true
            });
        }
        return top;
    }

    function altitudeBins(air) {
        var en = lang() === "en";
        var bins = [
            { label: en ? "0–3 km" : "0–3 km", min: 0, max: 3000, count: 0 },
            { label: en ? "3–6 km" : "3–6 km", min: 3000, max: 6000, count: 0 },
            { label: en ? "6–9 km" : "6–9 km", min: 6000, max: 9000, count: 0 },
            { label: en ? "9–12 km" : "9–12 km", min: 9000, max: 12000, count: 0 },
            { label: en ? "12 km+" : "12 km+", min: 12000, max: Infinity, count: 0 }
        ];
        air.forEach(function (a) {
            if (!Number.isFinite(a.alt)) return;
            for (var i = 0; i < bins.length; i++) {
                if (a.alt >= bins[i].min && a.alt < bins[i].max) { bins[i].count += 1; break; }
            }
        });
        return bins;
    }

    function speedBins(air) {
        var en = lang() === "en";
        var bins = [
            { label: en ? "< 100" : "< 100", min: 0, max: 100, count: 0 },
            { label: "100–150", min: 100, max: 150, count: 0 },
            { label: "150–200", min: 150, max: 200, count: 0 },
            { label: "200–250", min: 200, max: 250, count: 0 },
            { label: "250+", min: 250, max: Infinity, count: 0 }
        ];
        air.forEach(function (a) {
            if (!Number.isFinite(a.velocity)) return;
            for (var i = 0; i < bins.length; i++) {
                if (a.velocity >= bins[i].min && a.velocity < bins[i].max) { bins[i].count += 1; break; }
            }
        });
        return bins;
    }

    function headingBins(air) {
        var en = lang() === "en";
        var labels = en
            ? ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
            : ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
        var counts = labels.map(function (l) { return { label: l, count: 0 }; });
        air.forEach(function (a) {
            if (!Number.isFinite(a.heading)) return;
            var idx = Math.round(a.heading / 45) % 8;
            counts[idx].count += 1;
        });
        return counts;
    }

    function categoryCounts(air) {
        var labels = CAT_LABELS[lang()] || CAT_LABELS.pl;
        var counts = {};
        air.forEach(function (a) {
            if (a.category == null) return;
            var key = labels[a.category] || ("cat " + a.category);
            counts[key] = (counts[key] || 0) + 1;
        });
        return Object.keys(counts).map(function (k) { return { name: k, count: counts[k] }; })
            .sort(function (a, b) { return b.count - a.count; }).slice(0, 6);
    }

    function esc(s) {
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function barRow(label, value, max, color, opts) {
        opts = opts || {};
        var pct = max > 0 ? Math.max(opts.minPct || 3, (value / max) * 100) : 0;
        var share = max > 0 ? Math.round((value / max) * 100) : 0;
        var cls = "dc-bar-row" + (opts.dash ? " dash-bar-row" : "");
        var valText = fmtInt(value) + (opts.showShare && max ? " (" + share + "%)" : "");
        return "<div class=\"" + cls + "\">" +
            "<span class=\"dc-bar-label\">" + esc(label) + "</span>" +
            "<div class=\"dc-bar-track\"><div class=\"dc-bar-fill\" style=\"width:" + pct + "%;background:" + color + "\"></div></div>" +
            "<span class=\"dc-bar-value\">" + valText + "</span></div>";
    }

    function dashBarRow(label, value, max, color, total) {
        var share = total > 0 ? Math.round((value / total) * 100) : 0;
        var pct = max > 0 ? Math.max(6, (value / max) * 100) : 0;
        return "<div class=\"dc-bar-row dash-bar-row\">" +
            "<span class=\"dc-bar-label\">" + esc(label) + "</span>" +
            "<div class=\"dc-bar-track\"><div class=\"dc-bar-fill\" style=\"width:" + pct + "%;background:" + color + "\"></div></div>" +
            "<span class=\"dc-bar-value\">" + fmtInt(value) + (total ? " (" + share + "%)" : "") + "</span></div>";
    }

    function binsHtml(bins, color) {
        var max = Math.max.apply(null, bins.map(function (b) { return b.count; }).concat([1]));
        return bins.map(function (b) { return barRow(b.label, b.count, max, color); }).join("");
    }

    function stackedBar(parts) {
        var total = parts.reduce(function (a, p) { return a + p.value; }, 0) || 1;
        var en = lang() === "en";
        var html = "<div class=\"dash-vs-cards\">";
        parts.forEach(function (p) {
            var pct = Math.round((p.value / total) * 100);
            html += "<div class=\"dash-vs-card\" style=\"--vs-color:" + p.color + "\">" +
                "<strong>" + fmtInt(p.value) + "</strong>" +
                "<span>" + esc(p.label) + "</span>" +
                "<small>" + pct + "%</small></div>";
        });
        html += "</div><div class=\"dash-stacked\">";
        parts.forEach(function (p) {
            var pct = (p.value / total) * 100;
            if (pct < 0.5) return;
            html += "<div class=\"dash-stacked-seg\" style=\"width:" + pct + "%;background:" + p.color + "\">" +
                (pct >= 14 ? "<span>" + Math.round(pct) + "%</span>" : "") + "</div>";
        });
        return html + "</div>";
    }

    function svgHeadingRose(bins) {
        var w = 300;
        var h = 300;
        var cx = w / 2;
        var cy = h / 2;
        var maxR = 98;
        var maxCount = Math.max.apply(null, bins.map(function (b) { return b.count; }).concat([1]));
        var peakIdx = 0;
        bins.forEach(function (b, i) { if (b.count >= bins[peakIdx].count) peakIdx = i; });

        var html = "<svg class=\"bls-svg dash-rose-svg\" width=\"" + w + "\" height=\"" + h +
            "\" viewBox=\"0 0 " + w + " " + h + "\" role=\"img\" aria-label=\"" +
            esc(lang() === "en" ? "Flight direction rose" : "Róża kierunków lotu") + "\">";
        html += "<rect width=\"" + w + "\" height=\"" + h + "\" rx=\"8\" fill=\"rgba(15,23,42,0.85)\"/>";

        for (var ring = 1; ring <= 4; ring++) {
            var rr = (maxR / 4) * ring;
            html += "<circle cx=\"" + cx + "\" cy=\"" + cy + "\" r=\"" + rr.toFixed(1) +
                "\" fill=\"none\" stroke=\"rgba(148,163,184,0.12)\"/>";
        }

        bins.forEach(function (b, i) {
            var start = (i * 45 - 112.5) * Math.PI / 180;
            var end = (i * 45 - 67.5) * Math.PI / 180;
            var len = maxCount ? (b.count / maxCount) * maxR : 0;
            var isPeak = i === peakIdx && b.count > 0;
            var x1 = cx + Math.cos(start) * len;
            var y1 = cy + Math.sin(start) * len;
            var x2 = cx + Math.cos(end) * len;
            var y2 = cy + Math.sin(end) * len;
            var large = 0;
            var path = "M " + cx + " " + cy + " L " + x1.toFixed(1) + " " + y1.toFixed(1) +
                " A " + len.toFixed(1) + " " + len.toFixed(1) + " 0 " + large + " 1 " +
                x2.toFixed(1) + " " + y2.toFixed(1) + " Z";
            html += "<path d=\"" + path + "\" fill=\"" + (isPeak ? "#38bdf8" : "rgba(56,189,248,0.35)") +
                "\" stroke=\"" + (isPeak ? "#7dd3fc" : "rgba(56,189,248,0.5)") + "\" stroke-width=\"1\"/>";

            var mid = (i * 45 - 90) * Math.PI / 180;
            var lx = cx + Math.cos(mid) * (maxR + 22);
            var ly = cy + Math.sin(mid) * (maxR + 22);
            html += "<text x=\"" + lx.toFixed(1) + "\" y=\"" + (ly - 5).toFixed(1) +
                "\" text-anchor=\"middle\" fill=\"" + (isPeak ? "#f8fafc" : "#94a3b8") +
                "\" font-size=\"" + (isPeak ? "12" : "10") + "\" font-weight=\"" + (isPeak ? "700" : "500") + "\">" +
                esc(b.label) + "</text>";
            if (b.count > 0) {
                html += "<text x=\"" + lx.toFixed(1) + "\" y=\"" + (ly + 9).toFixed(1) +
                    "\" text-anchor=\"middle\" fill=\"" + (isPeak ? "#38bdf8" : "#64748b") +
                    "\" font-size=\"10\" font-weight=\"600\">" + fmtInt(b.count) + "</text>";
            }
        });

        html += "<circle cx=\"" + cx + "\" cy=\"" + cy + "\" r=\"3\" fill=\"#94a3b8\"/>";
        return html + "</svg>";
    }

    function renderMap(canvas, rows) {
        if (!canvas) return;
        var ctx = canvas.getContext("2d");
        if (!ctx) return;
        var w = canvas.width;
        var h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
        ctx.fillRect(0, 0, w, h);

        function x(lon) { return ((lon - BBOX.lomin) / (BBOX.lomax - BBOX.lomin)) * (w - 24) + 12; }
        function y(lat) { return (1 - (lat - BBOX.lamin) / (BBOX.lamax - BBOX.lamin)) * (h - 24) + 12; }

        ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
        ctx.strokeRect(12, 12, w - 24, h - 24);
        ctx.fillStyle = "rgba(148, 163, 184, 0.5)";
        ctx.font = "11px system-ui";
        ctx.fillText("PL", x(19.5), y(52));

        rows.forEach(function (a) {
            var px = x(a.lon);
            var py = y(a.lat);
            if (!a.onGround && Number.isFinite(a.heading)) {
                var rad = (a.heading - 90) * Math.PI / 180;
                var len = 10;
                ctx.strokeStyle = "rgba(134, 239, 172, 0.55)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(px + Math.cos(rad) * len, py + Math.sin(rad) * len);
                ctx.stroke();
            }
            ctx.beginPath();
            ctx.arc(px, py, a.onGround ? 3 : 4, 0, Math.PI * 2);
            ctx.fillStyle = a.onGround ? "#fbbf24" : "#86efac";
            ctx.fill();
        });
    }

    function renderTable(rows) {
        var sorted = rows.slice().sort(function (a, b) { return (b.alt || 0) - (a.alt || 0); }).slice(0, 12);
        var en = lang() === "en";
        var html = "<table class=\"dc-table dash-table\"><thead><tr>" +
            "<th>" + (en ? "Callsign" : "Znaki") + "</th>" +
            "<th>" + (en ? "Country" : "Kraj") + "</th>" +
            "<th>" + (en ? "Alt (m)" : "Wys. (m)") + "</th>" +
            "<th>" + (en ? "Spd" : "Prędk.") + "</th>" +
            "<th>" + (en ? "Hdg°" : "Kurs°") + "</th>" +
            "<th>" + (en ? "V/S" : "V/S") + "</th>" +
            "</tr></thead><tbody>";
        sorted.forEach(function (a) {
            var vr = Number.isFinite(a.vrate) ? (a.vrate > 0 ? "+" : "") + a.vrate.toFixed(1) : "—";
            html += "<tr>" +
                "<td>" + (a.callsign || a.icao24) + "</td>" +
                "<td>" + a.country + "</td>" +
                "<td>" + (Number.isFinite(a.alt) ? Math.round(a.alt).toLocaleString("pl-PL") : "—") + "</td>" +
                "<td>" + (Number.isFinite(a.velocity) ? a.velocity.toFixed(0) : "—") + "</td>" +
                "<td>" + (Number.isFinite(a.heading) ? Math.round(a.heading) : "—") + "</td>" +
                "<td class=\"" + (a.vrate > 1 ? "dc-cell changed" : a.vrate < -1 ? "dc-cell noisy" : "") + "\">" + vr + "</td>" +
                "</tr>";
        });
        return html + "</tbody></table>";
    }

    function sourceLabel() {
        var en = lang() === "en";
        if (state.source === "live") {
            return en
                ? "Live data from OpenSky Network."
                : "Dane na żywo z OpenSky Network.";
        }
        if (state.source === "snapshot-cors") {
            return en
                ? "Fallback snapshot — the browser cannot call OpenSky directly (CORS)."
                : "Snapshot zapasowy — przeglądarka nie może wywołać OpenSky (CORS).";
        }
        return en
            ? "Embedded OpenSky snapshot (offline / GitHub Pages)."
            : "Osadzony snapshot OpenSky (offline / GitHub Pages).";
    }

    function renderStatus() {
        var el = document.getElementById("dash-status");
        if (!el) return;
        var en = lang() === "en";
        if (state.loading) {
            el.textContent = en ? "Loading aircraft positions…" : "Wczytywanie pozycji samolotów…";
            return;
        }
        var obs = fmtTime(state.time);
        var fetched = state.fetchedAt
            ? fmtTime(Math.floor(new Date(state.fetchedAt).getTime() / 1000))
            : "";
        el.textContent = sourceLabel()
            + (obs ? (en ? " Last observation: " : " Ostatnia obserwacja: ") + obs + "." : "")
            + (fetched ? (en ? " Downloaded: " : " Pobrano: ") + fetched + "." : "");
    }

    function buildSummary(kpis) {
        var en = lang() === "en";
        if (!kpis.total) return "";
        if (en) {
            return "Right now there are <strong>" + fmtInt(kpis.airborne) + "</strong> aircraft flying and " +
                "<strong>" + fmtInt(kpis.ground) + "</strong> on the ground over Poland " +
                "(<strong>" + fmtInt(kpis.total) + "</strong> total in the map area). " +
                "They come from <strong>" + fmtInt(kpis.countries) + "</strong> countries; " +
                "<strong>" + fmtInt(kpis.poland) + "</strong> are registered in Poland.";
        }
        return "Teraz nad Polską leci <strong>" + fmtInt(kpis.airborne) + "</strong> samolotów, a na ziemi stoi " +
            "<strong>" + fmtInt(kpis.ground) + "</strong> " +
            "(łącznie <strong>" + fmtInt(kpis.total) + "</strong> w obszarze mapy). " +
            "Pochodzą z <strong>" + fmtInt(kpis.countries) + "</strong> krajów; " +
            "<strong>" + fmtInt(kpis.poland) + "</strong> ma rejestrację polską.";
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
                ? "Custom code in JavaScript — HTML Canvas charts, live fetch to the OpenSky REST API, no charting library and no manual CSV upload."
                : "Własny kod w JavaScript — wykresy na Canvas, pobieranie na żywo z OpenSky REST API, bez biblioteki wykresów i bez ręcznego wgrywania CSV.") +
            "</div>";
    }

    function render() {
        var en = lang() === "en";
        var rows = filtered();
        var air = airborneOnly(rows);
        var kpis = computeKpis(rows);
        var countries = topCountries(rows, 6);
        var maxC = countries.length ? countries[0].count : 1;
        var altBins = altitudeBins(air);
        var spdBins = speedBins(air);
        var hdgBins = headingBins(air);
        var cats = categoryCounts(air);
        var maxCat = cats.length ? cats[0].count : 1;
        var topAlt = altBins.slice().sort(function (a, b) { return b.count - a.count; })[0];
        var topSpd = spdBins.slice().sort(function (a, b) { return b.count - a.count; })[0];
        var topHdg = hdgBins.slice().sort(function (a, b) { return b.count - a.count; })[0];
        var vsTotal = kpis.climbing + kpis.level + kpis.descending;
        var takeMap = en
            ? "Clusters of dots are busy corridors and airports. Empty map = little traffic, not missing data."
            : "Zagęszczenie kropek to korytarze i lotniska. Puste pole na mapie = mało ruchu, nie brak danych.";
        var takeCountries = countries.length
            ? (en
                ? countries[0].name + " leads (" + fmtInt(countries[0].count) + "). The bars above sum to " + fmtInt(kpis.total) + " — top countries plus any “Other countries” row."
                : countries[0].name + " ma najwięcej (" + fmtInt(countries[0].count) + "). Słupki powyżej dają łącznie " + fmtInt(kpis.total) + " — top kraje plus ewentualny wiersz „Pozostałe kraje”.")
            : "";
        var takeAlt = topAlt
            ? (en
                ? "The most common band is " + topAlt.label + " (" + fmtInt(topAlt.count) + " aircraft) — typically cruise, not landing."
                : "Najczęstszy przedział to " + topAlt.label + " (" + fmtInt(topAlt.count) + " samolotów) — typowy pułap przelotowy, nie lądowanie.")
            : "";
        var takeSpd = topSpd
            ? (en
                ? "Most airborne aircraft sit in " + topSpd.label + " m/s."
                : "Większość samolotów w powietrzu jest w przedziale " + topSpd.label + " m/s.")
            : "";
        var takeHdg = topHdg
            ? (en
                ? "The longest spoke is " + topHdg.label + " — that direction has the most flights in this snapshot."
                : "Najdłuższy promień to " + topHdg.label + " — w tę stronę leci teraz najwięcej maszyn.")
            : "";
        var takeVs = vsTotal
            ? (en
                ? fmtInt(kpis.level) + " are in level flight; " + fmtInt(kpis.climbing) + " climbing, " + fmtInt(kpis.descending) + " descending."
                : fmtInt(kpis.level) + " leci poziomo; " + fmtInt(kpis.climbing) + " się wznosi, " + fmtInt(kpis.descending) + " opada.")
            : "";
        var takeCat = cats.length
            ? (en
                ? "Most transponders send no type (“" + cats[0].name + "”: " + fmtInt(cats[0].count) + "). Only " + fmtInt(cats.length) + " labels appear in this snapshot."
                : "Większość transponderów nie podaje typu („" + cats[0].name + "”: " + fmtInt(cats[0].count) + "). W tym ujęciu widać tylko " + fmtInt(cats.length) + " etykiety.")
            : "";
        var takeTable = en
            ? "These 12 rows are the highest aircraft from the same moment as the map."
            : "Te 12 wierszy to najwyżej lecące maszyny z tej samej chwili co mapa.";

        root.innerHTML =
            "<div class=\"dash-toolbar\">" +
            "<div class=\"dash-filters\" role=\"group\">" +
            "<button type=\"button\" class=\"dash-filter" + (state.filter === "all" ? " active" : "") + "\" data-filter=\"all\">" + (en ? "All" : "Wszystkie") + "</button>" +
            "<button type=\"button\" class=\"dash-filter" + (state.filter === "air" ? " active" : "") + "\" data-filter=\"air\">" + (en ? "Airborne" : "W powietrzu") + "</button>" +
            "<button type=\"button\" class=\"dash-filter" + (state.filter === "ground" ? " active" : "") + "\" data-filter=\"ground\">" + (en ? "On ground" : "Na ziemi") + "</button>" +
            "</div>" +
            "<button type=\"button\" class=\"btn btn-outline dash-refresh\" id=\"dash-refresh\">" + (en ? "Refresh data" : "Odśwież dane") + "</button>" +
            "</div>" +
            "<p class=\"dash-status\" id=\"dash-status\"></p>" +
            "<p class=\"dash-summary\">" + buildSummary(kpis) + "</p>" +
            vizGuide([
                {
                    title: en ? "Map" : "Mapa",
                    text: en ? "Geographic snapshot — where aircraft are relative to Poland." : "Obraz geograficzny — gdzie względem Polski znajdują się samoloty."
                },
                {
                    title: en ? "Country bars" : "Słupki krajów",
                    text: en ? "Which countries the visible aircraft are registered in." : "W jakich krajach zarejestrowane są widoczne samoloty."
                },
                {
                    title: en ? "Altitude & speed" : "Wysokość i prędkość",
                    text: en ? "How high and how fast airborne traffic moves — cruise vs approach patterns." : "Jak wysoko i jak szybko porusza się ruch w powietrzu — typowe wzorce lotu."
                },
                {
                    title: en ? "Heading rose" : "Róża kierunków",
                    text: en ? "Dominant flight directions over the area (N/NE/E…)." : "Dominujące kierunki lotu nad obszarem (N/NE/E…)."
                },
                {
                    title: en ? "Top-12 table" : "Tabela top 12",
                    text: en ? "Concrete examples — callsigns of the highest-flying aircraft right now." : "Konkretne przykłady — znaki samolotów lecących najwyżej."
                }
            ]) +
            "<div class=\"dash-kpi-grid\">" +
            "<div class=\"dash-kpi\"><strong>" + fmtInt(kpis.total) + "</strong><span>" + (en ? "Aircraft on the map (Poland area)" : "Samolotów na mapie (obszar Polski)") + "</span></div>" +
            "<div class=\"dash-kpi\"><strong>" + fmtInt(kpis.airborne) + "</strong><span>" + (en ? "Currently flying" : "Obecnie w powietrzu") + "</span></div>" +
            "<div class=\"dash-kpi\"><strong>" + fmtInt(kpis.ground) + "</strong><span>" + (en ? "On the ground" : "Na ziemi (lotniska)") + "</span></div>" +
            "<div class=\"dash-kpi\"><strong>" + fmtInt(kpis.poland) + "</strong><span>" + (en ? "Registered in Poland" : "Zarejestrowanych w Polsce") + "</span></div>" +
            "<div class=\"dash-kpi\"><strong>" + fmtInt(kpis.countries) + "</strong><span>" + (en ? "Different countries of origin" : "Różnych krajów pochodzenia") + "</span></div>" +
            "<div class=\"dash-kpi\"><strong>" + fmtInt(kpis.withCallsign) + "</strong><span>" + (en ? "With a callsign (flight number)" : "Ze znakiem rozpoznawczym (numer lotu)") + "</span></div>" +
            "<div class=\"dash-kpi\"><strong>" + (kpis.maxAlt ? Math.round(kpis.maxAlt).toLocaleString("pl-PL") : "—") + "</strong><span>" + (en ? "Highest altitude (metres)" : "Najwyższa wysokość (metry)") + "</span></div>" +
            "<div class=\"dash-kpi\"><strong>" + (kpis.avgVel ? kpis.avgVel.toFixed(0) : "—") + "</strong><span>" + (en ? "Average speed (m/s)" : "Średnia prędkość (m/s)") + "</span></div>" +
            "</div>" +
            "<div class=\"dash-grid\">" +
            vizSection(en ? "1 · Where are they?" : "1 · Gdzie są?") +
            "<div class=\"dash-panel dash-panel-map\">" +
            "<h4>" + (en ? "Map — aircraft positions" : "Mapa — pozycje samolotów") + "</h4>" +
            vizDesc(
                en ? "Each dot is one aircraft. The short line shows the direction of flight (heading). Green = airborne, yellow = on the ground at an airport."
                    : "Każda kropka to jeden samolot. Krótka linia to kierunek lotu. Zielony = w powietrzu, żółty = na ziemi (lotnisko).",
                takeMap
            ) +
            "<canvas id=\"dash-canvas\" width=\"520\" height=\"360\"></canvas></div>" +
            "<div class=\"dash-panel\">" +
            "<h4>" + (en ? "Bar chart — countries of origin" : "Wykres słupkowy — kraje pochodzenia") + "</h4>" +
            vizDesc(
                en ? "Top 6 registration countries; any remaining aircraft are grouped in “Other countries”. All bars together equal the total on the map."
                    : "Top 6 krajów rejestracji; reszta samolotów trafia do „Pozostałe kraje”. Suma wszystkich słupków = liczba kropek na mapie.",
                takeCountries
            ) +
            countries.map(function (c) {
                return dashBarRow(c.name, c.count, maxC, c.isOther ? "#64748b" : "#38bdf8", kpis.total);
            }).join("") +
            "</div>" +
            vizSection(en ? "2 · How are they flying?" : "2 · Jak lecą?") +
            "<div class=\"dash-panel\">" +
            "<h4>" + (en ? "Histogram — flight altitude" : "Histogram — wysokość lotu") + "</h4>" +
            vizDesc(
                en ? "Distribution of barometric altitude for airborne aircraft only. Most airliners cruise between 9–12 km."
                    : "Rozkład wysokości barometrycznej tylko dla samolotów w powietrzu. Większość airlinerów leci na 9–12 km.",
                takeAlt
            ) +
            binsHtml(altBins, "#86efac") +
            "</div>" +
            "<div class=\"dash-panel\">" +
            "<h4>" + (en ? "Histogram — ground speed" : "Histogram — prędkość nad ziemią") + "</h4>" +
            vizDesc(
                en ? "How fast aircraft move over the ground (m/s). Higher speeds usually mean en-route flight."
                    : "Jak szybko samoloty poruszają się nad ziemią (m/s). Wyższe prędkości = zwykle lot przelotowy.",
                takeSpd
            ) +
            binsHtml(spdBins, "#c084fc") +
            "</div>" +
            "<div class=\"dash-flight-split\">" +
            "<div class=\"dash-panel dash-polar-panel\">" +
            "<h4>" + (en ? "Polar chart — flight direction" : "Wykres polarny — kierunek lotu") + "</h4>" +
            vizDesc(
                en ? "Eight compass sectors (45°). Brighter wedge = most aircraft; number under label = count in that direction."
                    : "Osiem sektorów kompasu (45°). Jaśniejszy wycinek = najwięcej maszyn; liczba pod etykietą = ile leci w tę stronę.",
                takeHdg
            ) +
            "<div class=\"dash-rose-wrap\">" + svgHeadingRose(hdgBins) + "</div></div>" +
            "<div class=\"dash-flight-side\">" +
            "<div class=\"dash-panel\">" +
            "<h4>" + (en ? "Climb / level / descend" : "Wznoszenie / poziom / opadanie") + "</h4>" +
            vizDesc(
                en ? "Vertical speed for airborne aircraft only. Cards show counts; bar below shows proportions."
                    : "Prędkość pionowa tylko dla samolotów w powietrzu. Kafelki = liczby; pasek poniżej = proporcje.",
                takeVs
            ) +
            stackedBar([
                { label: en ? "Climbing" : "Wznoszenie", value: kpis.climbing, color: "#86efac" },
                { label: en ? "Level" : "Poziom", value: kpis.level, color: "#64748b" },
                { label: en ? "Descending" : "Opadanie", value: kpis.descending, color: "#fbbf24" }
            ]) + "</div>" +
            (cats.length
                ? "<div class=\"dash-panel\"><h4>" + (en ? "Aircraft type (ADS-B)" : "Typ statku (ADS-B)") + "</h4>" +
                vizDesc(
                    en ? "Transponder category when available. Many aircraft report no type — that is normal, not missing data."
                        : "Kategoria z transpondera, gdy jest dostępna. Wiele maszyn nie podaje typu — to normalne, nie brak danych.",
                    takeCat
                ) +
                "<div class=\"dash-bars\">" +
                cats.map(function (c) { return dashBarRow(c.name, c.count, maxCat, "#7dd3fc", kpis.airborne); }).join("") +
                "</div></div>"
                : "<div class=\"dash-panel\"><h4>" + (en ? "Aircraft type" : "Typ statku") + "</h4><p class=\"dash-map-note\">" +
                (en ? "No ADS-B category in this snapshot." : "W tym ujęciu brak kategorii ADS-B.") + "</p></div>") +
            "</div></div>" +
            vizSection(en ? "3 · Examples" : "3 · Przykłady") +
            "<div class=\"dash-panel dash-panel-wide\">" +
            "<h4>" + (en ? "Table — 12 highest aircraft" : "Tabela — 12 najwyżej lecących") + "</h4>" +
            vizDesc(
                en ? "Sorts visible aircraft by altitude and lists callsign, country, speed and heading — concrete rows behind the aggregates."
                    : "Sortuje widoczne samoloty wg wysokości i podaje znak, kraj, prędkość i kurs — konkretne wiersze za agregatami.",
                takeTable
            ) +
            renderTable(rows) +
            "</div>" +
            methodNote() +
            "<div class=\"dash-panel dash-panel-wide dash-api\">" +
            "<h4>" + (en ? "Data source (API)" : "Źródło danych (API)") + "</h4>" +
            vizDesc(
                en ? "Technical endpoint used to fetch state vectors. If the live call fails (CORS on GitHub Pages, or the API is down), a saved snapshot is shown and the fetch date is labelled in the status line."
                    : "Endpoint techniczny do pobrania wektorów stanu. Gdy wywołanie na żywo nie przejdzie (CORS na GitHub Pages albo API nie odpowiada), pokazywany jest snapshot, a data pobrania jest w statusie.",
                null
            ) +
            "<pre class=\"hero-code dc-code\"><code>GET " + API_URL + "</code></pre>" +
            "<p class=\"dash-api-cite\"><a href=\"https://openskynetwork.github.io/opensky-api/rest.html\" target=\"_blank\" rel=\"noopener\">OpenSky REST API</a></p></div></div>";

        var mapCanvas = document.getElementById("dash-canvas");
        if (mapCanvas) renderMap(mapCanvas, rows);
        renderStatus();

        root.querySelectorAll(".dash-filter").forEach(function (btn) {
            btn.addEventListener("click", function () {
                state.filter = btn.getAttribute("data-filter");
                render();
            });
        });
        var refreshBtn = document.getElementById("dash-refresh");
        if (refreshBtn) refreshBtn.addEventListener("click", fetchLive);
    }

    function isPanelVisible() {
        var panel = document.getElementById("opensky-live");
        return panel && !panel.hidden;
    }

    window.__openskyRerender = function () {
        if (isPanelVisible()) render();
    };

    document.querySelectorAll("[data-set-lang]").forEach(function (btn) {
        btn.addEventListener("click", function () { setTimeout(function () { if (isPanelVisible()) render(); }, 0); });
    });

    var skyPanel = document.getElementById("opensky-live");
    if (skyPanel && typeof MutationObserver !== "undefined") {
        new MutationObserver(function () {
            if (!skyPanel.hidden) window.__openskyRerender();
        }).observe(skyPanel, { attributes: true, attributeFilter: ["hidden"] });
    }

    loadSnapshot();
    fetchLive().finally(function () {
        if (isPanelVisible()) window.__openskyRerender();
    });
})();
