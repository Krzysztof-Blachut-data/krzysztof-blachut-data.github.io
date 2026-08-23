(function () {
    var root = document.getElementById("pf-root");
    if (!root) return;

    var DATA = window.__PAYMENT_DATA || {};

    function isEn() {
        return document.documentElement.getAttribute("data-lang") === "en";
    }

    function t(pl, en) {
        return isEn() ? en : pl;
    }

    function money(n) {
        if (n == null || isNaN(n)) return "—";
        var abs = Math.abs(n);
        if (abs >= 1e9) return (n / 1e9).toFixed(2) + (isEn() ? " bn" : " mld");
        if (abs >= 1e6) return (n / 1e6).toFixed(1) + " M";
        if (abs >= 1e3) return (n / 1e3).toFixed(0) + " k";
        return String(Math.round(n));
    }

    function pct(n) {
        if (n == null || isNaN(n)) return "—";
        return (100 * n).toFixed(0) + "%";
    }

    function pct1(n) {
        if (n == null || isNaN(n)) return "—";
        var v = (100 * n).toFixed(1);
        return (isEn() ? v : v.replace(".", ",")) + "%";
    }

    function num(n, d) {
        if (n == null || isNaN(n)) return "—";
        return Number(n).toFixed(d == null ? 1 : d);
    }

    function metric(value, labelPl, labelEn) {
        return "<div class=\"pf-kpi\">" +
            "<span class=\"pf-kpi-value\">" + value + "</span>" +
            "<span class=\"pf-kpi-label\">" + t(labelPl, labelEn) + "</span>" +
            "</div>";
    }

    function buildMetrics() {
        var el = document.getElementById("pf-metrics");
        if (!el) return;
        var tot = DATA.totals || {};
        var cy = DATA.cycle || {};
        var pred = DATA.prediction || {};
        var rows = String(tot.rows || "—").replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
        el.innerHTML =
            metric(rows, "faktur w zbiorze", "invoices in the set") +
            metric(pct1(cy.late_rate), "zamkniętych faktur opłaconych po terminie", "closed invoices paid late") +
            metric(num(cy.median_days_to_pay, 0) + " dni", "typowy czas do spłaty", "typical days to pay") +
            metric(num(pred.mae_days, 1) + " vs " + num(pred.naive_mae_days, 1),
                "błąd prognozy i wynik modelu bazowego", "forecast error vs baseline");
    }

    function buildAging() {
        var el = document.getElementById("pf-aging");
        if (!el) return;
        var rows = DATA.openAging || [];
        var order = ["current", "1-7", "8-30", "31-60", "60+", "unknown"];
        var map = {};
        rows.forEach(function (r) { map[r.aging_bucket] = r; });
        var maxAmt = Math.max.apply(null, order.map(function (k) {
            return (map[k] && map[k].amount) || 0;
        }).concat([1]));
        var labels = {
            current: t("Jeszcze w terminie", "Still on time"),
            "1-7": t("1–7 dni po terminie", "1–7 days overdue"),
            "8-30": t("8–30 dni po terminie", "8–30 days overdue"),
            "31-60": t("31–60 dni po terminie", "31–60 days overdue"),
            "60+": t("Ponad 60 dni", "Over 60 days"),
            unknown: t("Bez daty", "No date")
        };
        el.innerHTML = order.filter(function (k) { return map[k]; }).map(function (k) {
            var r = map[k];
            var w = Math.max(6, Math.round(100 * r.amount / maxAmt));
            return "<div class=\"pf-bar-row\">" +
                "<div class=\"pf-bar-head\">" +
                "<span class=\"pf-bar-label\">" + labels[k] + "</span>" +
                "<span class=\"pf-bar-meta\">" + money(r.amount) +
                " <span class=\"pf-bar-count\">(" + r.invoices + " " + t("fakt.", "inv.") + ")</span></span>" +
                "</div>" +
                "<span class=\"pf-bar-track\"><span class=\"pf-bar-fill\" style=\"width:" + w + "%\"></span></span>" +
                "</div>";
        }).join("");
    }

    function buildTerms() {
        var el = document.getElementById("pf-terms");
        if (!el) return;
        var rows = (DATA.byTerms || []).slice(0, 5);
        var head = "<tr>" +
            "<th>" + t("Kod terminu", "Term code") + "</th>" +
            "<th>" + t("Faktury", "Invoices") + "</th>" +
            "<th>" + t("Po terminie", "Late") + "</th>" +
            "<th>" + t("Dni do spłaty", "Days to pay") + "</th>" +
            "</tr>";
        var body = rows.map(function (r) {
            return "<tr><td><code>" + r.term + "</code></td><td>" + r.invoices.toLocaleString(isEn() ? "en" : "pl") +
                "</td><td>" + pct1(r.late_rate) + "</td><td>" + num(r.median_days_to_pay, 0) + "</td></tr>";
        }).join("");
        el.innerHTML = "<table class=\"pf-table\"><thead>" + head + "</thead><tbody>" + body + "</tbody></table>";
    }

    function buildPriority() {
        var el = document.getElementById("pf-priority");
        if (!el) return;
        var rows = DATA.openPriority || [];
        var head = "<tr>" +
            "<th>#</th>" +
            "<th>" + t("Klient", "Customer") + "</th>" +
            "<th>" + t("Kwota", "Amount") + "</th>" +
            "<th>" + t("Termin płatności", "Due date") + "</th>" +
            "<th>" + t("Dni po terminie", "Days past due") + "</th>" +
            "<th>" + t("Prognozowana spłata", "Predicted clear") + "</th>" +
            "<th>" + t("Prognozowany status", "Predicted status") + "</th>" +
            "</tr>";
        var body = rows.map(function (r, i) {
            var flag = r.pred_late
                ? "<span class=\"pf-flag pf-flag-bad\">" + t("spóźnienie", "likely late") + "</span>"
                : "<span class=\"pf-flag pf-flag-ok\">" + t("w terminie", "on time") + "</span>";
            var past = r.days_past_due == null ? "—" : String(r.days_past_due);
            return "<tr>" +
                "<td class=\"pf-rank\">" + (i + 1) + "</td>" +
                "<td>" + r.customer + "</td>" +
                "<td class=\"pf-num\">" + money(r.amount) + " " + (r.currency || "") + "</td>" +
                "<td class=\"pf-num\">" + r.due + "</td>" +
                "<td class=\"pf-num\">" + past + "</td>" +
                "<td class=\"pf-num\">" + r.pred_clear + "</td>" +
                "<td>" + flag + "</td>" +
                "</tr>";
        }).join("");
        el.innerHTML = "<table class=\"pf-table\"><thead>" + head + "</thead><tbody>" + body + "</tbody></table>";
    }

    function buildMonthly() {
        var el = document.getElementById("pf-monthly");
        if (!el) return;
        var pts = DATA.monthly || [];
        if (!pts.length) { el.innerHTML = ""; return; }

        // drop sparse edge months — they distort the scale
        pts = pts.filter(function (p) { return (p.invoices || 0) >= 80; });
        if (!pts.length) { el.innerHTML = ""; return; }

        var W = 720, H = 300;
        var pad = { l: 52, r: 18, t: 40, b: 58 };
        var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
        var rates = pts.map(function (p) { return p.late_rate; });
        var avg = rates.reduce(function (a, b) { return a + b; }, 0) / rates.length;
        var mxData = Math.max.apply(null, rates);
        // headroom so value labels never sit on the top edge / avg badge
        var mx = Math.ceil((Math.max(mxData, avg) + 0.08) * 10) / 10;
        if (mx < 0.55) mx = 0.55;
        if (mx > 1) mx = 1;

        var n = pts.length;
        var gap = 0.28;
        var slot = iw / n;
        var barW = slot * (1 - gap);
        var yS = function (v) { return pad.t + ih - (v / mx) * ih; };
        var xS = function (i) { return pad.l + i * slot + (slot - barW) / 2; };

        var grid = "";
        var tickVals = [0, 0.2, 0.4, 0.6].filter(function (v) { return v <= mx + 1e-9; });
        if (mx > 0.6) tickVals.push(0.8);
        if (mx > 0.8) tickVals.push(1);
        tickVals = tickVals.filter(function (v) { return v <= mx + 1e-9; });
        tickVals.forEach(function (v) {
            var y = yS(v);
            grid += "<line x1=\"" + pad.l + "\" y1=\"" + y + "\" x2=\"" + (W - pad.r) +
                "\" y2=\"" + y + "\" stroke=\"var(--chart-grid)\" stroke-width=\"1\"/>";
            grid += "<text x=\"" + (pad.l - 10) + "\" y=\"" + (y + 4) +
                "\" text-anchor=\"end\" fill=\"var(--chart-axis)\" font-size=\"12\" " +
                "font-family=\"var(--font-mono), monospace\">" + Math.round(v * 100) + "%</text>";
        });

        var yAvg = yS(avg);
        grid += "<line x1=\"" + pad.l + "\" y1=\"" + yAvg + "\" x2=\"" + (W - pad.r) +
            "\" y2=\"" + yAvg + "\" stroke=\"var(--series-2)\" stroke-width=\"1.5\" " +
            "stroke-dasharray=\"5 4\"/>";
        // badge in the top-left margin — never on the bars
        grid += "<text x=\"" + pad.l + "\" y=\"" + (pad.t - 14) +
            "\" text-anchor=\"start\" fill=\"var(--series-2)\" font-size=\"12\" " +
            "font-family=\"var(--font-mono), monospace\">" +
            t("średnia ", "avg ") + Math.round(avg * 100) + "%</text>";

        var bars = "";
        var labels = "";
        var labelEvery = n > 14 ? 2 : 1;
        pts.forEach(function (p, i) {
            var x = xS(i);
            var y = yS(p.late_rate);
            var h = pad.t + ih - y;
            bars += "<rect x=\"" + x.toFixed(1) + "\" y=\"" + y.toFixed(1) +
                "\" width=\"" + barW.toFixed(1) + "\" height=\"" + Math.max(h, 1).toFixed(1) +
                "\" fill=\"var(--series-1)\" opacity=\"0.92\" rx=\"2\"/>";
            // values inside the bar near the top — no clash with the avg badge
            if (h >= 22) {
                bars += "<text x=\"" + (x + barW / 2).toFixed(1) + "\" y=\"" + (y + 14).toFixed(1) +
                    "\" text-anchor=\"middle\" fill=\"#0b1220\" font-size=\"10\" font-weight=\"700\" " +
                    "font-family=\"var(--font-mono), monospace\">" +
                    Math.round(p.late_rate * 100) + "</text>";
            }
            if (i % labelEvery === 0 || i === n - 1) {
                var m = String(p.month);
                var short = m.slice(2, 4) + "-" + m.slice(5);
                labels += "<text x=\"" + (x + barW / 2).toFixed(1) + "\" y=\"" + (H - 28) +
                    "\" text-anchor=\"middle\" fill=\"var(--chart-axis)\" font-size=\"11\" " +
                    "transform=\"rotate(-40 " + (x + barW / 2).toFixed(1) + " " + (H - 28) + ")\">" +
                    short + "</text>";
            }
        });

        var caption = t(
            "Słupki = % faktur zamkniętych po terminie w danym miesiącu. Linia przerywana = średnia z całego okresu.",
            "Bars = % of invoices that cleared late that month. Dashed line = period average."
        );

        el.innerHTML = "<figure class=\"ep-chart-wrap pf-chart\">" +
            "<svg class=\"ep-chart\" viewBox=\"0 0 " + W + " " + H +
            "\" role=\"img\" aria-label=\"" +
            t("Faktury opłacone po terminie w kolejnych miesiącach", "Invoices paid late by month") +
            "\">" + grid + bars + labels + "</svg>" +
            "<figcaption class=\"pf-chart-cap\">" + caption + "</figcaption></figure>";
    }

    function buildTakeaway() {
        var el = document.getElementById("pf-takeaway");
        if (!el) return;
        var cy = DATA.cycle || {};
        var pred = DATA.prediction || {};
        var sc = DATA.scenario || {};
        el.innerHTML = t(
            "Około dwie na pięć zamkniętych faktur zostały opłacone po terminie (<strong>" + pct1(cy.late_rate) +
            "</strong>). Prognoza z historii klienta myli się średnio o <strong>" +
            num(pred.mae_days, 1) + " dni</strong> (model bazowy: " + num(pred.naive_mae_days, 1) +
            "). Dwudziestu klientów z największymi opóźnieniami to <strong>" +
            money(sc.late_amount_top20) +
            "</strong> kwoty po terminie — od nich warto zacząć kontakt i przegląd warunków płatności.",
            "About two in five closed invoices were paid late (<strong>" + pct1(cy.late_rate) +
            "</strong>). A customer-history forecast misses by <strong>" +
            num(pred.mae_days, 1) + " days</strong> on average (baseline: " + num(pred.naive_mae_days, 1) +
            "). The twenty customers with the largest late amounts account for <strong>" +
            money(sc.late_amount_top20) +
            "</strong> of late amount — start contact and term reviews there."
        );
    }

    function render() {
        buildMetrics();
        buildAging();
        buildTerms();
        buildPriority();
        buildMonthly();
        buildTakeaway();
    }

    render();
    window.__pfRerender = render;
    document.querySelectorAll("[data-set-lang]").forEach(function (btn) {
        btn.addEventListener("click", function () {
            setTimeout(render, 0);
        });
    });
})();

(function () {
    var root = document.getElementById("pf-walkthrough");
    if (!root) return;
    var step = 0;
    var total = root.querySelectorAll("[data-pf-panel]").length;

    function show(i) {
        step = i;
        root.querySelectorAll("[data-pf-panel]").forEach(function (panel) {
            panel.hidden = Number(panel.getAttribute("data-pf-panel")) !== i;
        });
        root.querySelectorAll("[data-pf]").forEach(function (btn) {
            var n = Number(btn.getAttribute("data-pf"));
            btn.classList.toggle("active", n === i);
            btn.classList.toggle("done", n < i);
        });
        var prev = document.getElementById("pf-prev");
        var next = document.getElementById("pf-next");
        if (prev) prev.disabled = i === 0;
        if (next) next.disabled = i === total - 1;
    }

    root.querySelectorAll("[data-pf]").forEach(function (btn) {
        btn.addEventListener("click", function () {
            show(Number(btn.getAttribute("data-pf")));
        });
    });
    var prevBtn = document.getElementById("pf-prev");
    var nextBtn = document.getElementById("pf-next");
    if (prevBtn) prevBtn.addEventListener("click", function () { if (step > 0) show(step - 1); });
    if (nextBtn) nextBtn.addEventListener("click", function () { if (step < total - 1) show(step + 1); });
    show(0);
})();
