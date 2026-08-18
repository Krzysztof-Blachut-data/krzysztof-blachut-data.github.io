const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "../projects/barrel-to-pump/snapshot.js");
const EIA_KEY = process.env.EIA_API_KEY || "";
const LITRE_PER_BBL = 158.987;

function monthlyFromDaily(rows) {
    var byMonth = {};
    rows.forEach(function (r) {
        if (!Number.isFinite(r.value)) return;
        var key = r.year + "-" + String(r.month).padStart(2, "0");
        if (!byMonth[key]) byMonth[key] = { sum: 0, n: 0, year: r.year, month: r.month };
        byMonth[key].sum += r.value;
        byMonth[key].n += 1;
    });
    return Object.keys(byMonth).sort().map(function (k) {
        var m = byMonth[k];
        return { year: m.year, month: m.month, value: +(m.sum / m.n).toFixed(3) };
    });
}

function weeklyToMonthly(rows) {
    return monthlyFromDaily(rows);
}

async function fetchNbpUsd() {
    var ranges = [
        ["2018-01-01", "2018-12-31"], ["2019-01-01", "2019-12-31"],
        ["2020-01-01", "2020-12-31"], ["2021-01-01", "2021-12-31"],
        ["2022-01-01", "2022-12-31"], ["2023-01-01", "2023-12-31"],
        ["2024-01-01", "2024-12-31"], ["2025-01-01", "2025-12-31"]
    ];
    var all = [];
    for (var i = 0; i < ranges.length; i++) {
        var url = "https://api.nbp.pl/api/exchangerates/rates/a/usd/" +
            ranges[i][0] + "/" + ranges[i][1] + "/?format=json";
        var r = await fetch(url, { headers: { Accept: "application/json" } });
        if (!r.ok) throw new Error("NBP HTTP " + r.status);
        var d = await r.json();
        (d.rates || []).forEach(function (rate) {
            var dt = new Date(rate.effectiveDate);
            all.push({ year: dt.getFullYear(), month: dt.getMonth() + 1, value: +rate.mid });
        });
    }
    return monthlyFromDaily(all);
}

async function fetchEiaSpotMonthly(facet) {
    if (!EIA_KEY) return null;
    var url = "https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=" + EIA_KEY +
        "&frequency=daily&data[0]=value&facets[series][]=" + facet +
        "&start=2018-01-01&end=2025-12-31&sort[0][column]=period&sort[0][direction]=asc&length=5000";
    var r = await fetch(url);
    if (!r.ok) return null;
    var d = await r.json();
    var rows = (d.response && d.response.data || []).map(function (row) {
        var dt = new Date(row.period);
        return { year: dt.getFullYear(), month: dt.getMonth() + 1, value: +row.value };
    });
    return monthlyFromDaily(rows);
}

function fallbackOil(kind) {
    var monthly = {
        brent: {
            "2018-01": 69, "2018-06": 74, "2018-12": 57, "2019-06": 64, "2019-12": 67,
            "2020-03": 32, "2020-04": 19, "2020-06": 41, "2020-12": 51, "2021-06": 73,
            "2021-12": 77, "2022-03": 118, "2022-06": 122, "2022-12": 85, "2023-06": 75,
            "2023-12": 78, "2024-06": 82, "2024-12": 74, "2025-06": 68, "2025-12": 62
        },
        wti: {
            "2018-01": 65, "2018-06": 66, "2018-12": 49, "2019-06": 54, "2019-12": 61,
            "2020-03": 28, "2020-04": 17, "2020-06": 38, "2020-12": 48, "2021-06": 71,
            "2021-12": 75, "2022-03": 114, "2022-06": 115, "2022-12": 80, "2023-06": 70,
            "2023-12": 72, "2024-06": 78, "2024-12": 70, "2025-06": 65, "2025-12": 58
        }
    };
    var anchors = monthly[kind];
    var keys = Object.keys(anchors).sort();
    var pts = [];
    for (var y = 2018; y <= 2025; y++) {
        for (var m = 1; m <= 12; m++) {
            var k = y + "-" + String(m).padStart(2, "0");
            if (anchors[k] != null) {
                pts.push({ year: y, month: m, value: anchors[k] });
                continue;
            }
            var prev = null;
            var next = null;
            keys.forEach(function (ak) {
                if (ak <= k && (!prev || ak > prev)) prev = ak;
                if (ak >= k && (!next || ak < next)) next = ak;
            });
            var pv = prev ? anchors[prev] : 70;
            var nv = next ? anchors[next] : pv;
            var t = prev && next && prev !== next
                ? (new Date(k + "-01") - new Date(prev + "-01")) /
                  (new Date(next + "-01") - new Date(prev + "-01"))
                : 0;
            pts.push({ year: y, month: m, value: +(pv + (nv - pv) * t).toFixed(2) });
        }
    }
    return pts;
}

async function fetchPolandFuelFromPage() {
    var html = await (await fetch("https://www.fuel-prices.eu/Poland/")).text();
    var re = /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})\s+€([\d.]+)/g;
    var months = {
        Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
        Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12
    };
    var pb95 = [];
    var diesel = [];
    var m;
    while ((m = re.exec(html))) {
        var parts = m[1].split(/\s+/);
        var day = +parts[0];
        var mon = months[parts[1]];
        var year = +parts[2];
        var val = +m[2];
        if (year < 2018) continue;
        pb95.push({ year: year, month: mon, day: day, value: val });
    }
    var re2 = /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})\s+€([\d.]+)\s+€([\d.]+)/g;
    var weekly = [];
    while ((m = re2.exec(html))) {
        var p = m[1].split(/\s+/);
        weekly.push({
            year: +p[2], month: months[p[1]], day: +p[0],
            pb95: +m[2], diesel: +m[3]
        });
    }
    if (weekly.length > 20) {
        pb95 = weekly.map(function (w) {
            return { year: w.year, month: w.month, day: w.day, value: w.pb95 };
        });
        diesel = weekly.map(function (w) {
            return { year: w.year, month: w.month, day: w.day, value: w.diesel };
        });
    }
    return {
        pb95WithTax: weeklyToMonthly(pb95),
        dieselWithTax: weeklyToMonthly(diesel)
    };
}

async function fetchPolandFuelFromTxt() {
    var txt = await (await fetch("https://www.fuel-prices.eu/Poland/llms-full.txt")).text();
    var pb95 = [];
    var diesel = [];
    txt.split("\n").forEach(function (line) {
        var m = line.match(/^(\d{4}-\d{2}-\d{2})\s+€\s*([\d.]+)\s+€\s*([\d.]+)/);
        if (!m) return;
        var dt = new Date(m[1]);
        pb95.push({ year: dt.getFullYear(), month: dt.getMonth() + 1, value: +m[2] });
        diesel.push({ year: dt.getFullYear(), month: dt.getMonth() + 1, value: +m[3] });
    });
    var yearly = {};
    var ym = txt.match(/YEARLY AVERAGE PRICES[\s\S]*?(?=##|$)/);
    if (ym) {
        ym[0].split("\n").forEach(function (line) {
            var m = line.match(/^(\d{4})\s+€\s*([\d.]+)\s+€\s*([\d.]+)/);
            if (!m) return;
            yearly[+m[1]] = { pb95: +m[2], diesel: +m[3] };
        });
    }
    for (var y = 2018; y <= 2025; y++) {
        if (!yearly[y]) continue;
        for (var mo = 1; mo <= 12; mo++) {
            var has = pb95.some(function (p) { return p.year === y && p.month === mo; });
            if (!has) {
                pb95.push({ year: y, month: mo, value: yearly[y].pb95 });
                diesel.push({ year: y, month: mo, value: yearly[y].diesel });
            }
        }
    }
    pb95.sort(function (a, b) { return a.year !== b.year ? a.year - b.year : a.month - b.month; });
    diesel.sort(function (a, b) { return a.year !== b.year ? a.year - b.year : a.month - b.month; });
    return {
        pb95WithTax: weeklyToMonthly(pb95),
        dieselWithTax: weeklyToMonthly(diesel)
    };
}

async function fetchEcNetto() {
    var url = "https://energy.ec.europa.eu/document/download/78311f92-68f8-4b82-b5cf-1293beeaae77_en?filename=Weekly%20Oil%20Bulletin%20Weekly%20prices%20without%20taxes%20-%202024-02-19.xlsx";
    var XLSX = require("xlsx");
    var buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    var wb = XLSX.read(buf, { type: "buffer" });
    var rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
    var poland = rows.find(function (r) { return r && String(r[0]).toLowerCase() === "poland"; });
    if (!poland) return { pb95Net: [], dieselNet: [] };
    var now = new Date();
    var pt = { year: now.getFullYear(), month: now.getMonth() + 1 };
    return {
        pb95Net: [{ year: pt.year, month: pt.month, value: +(poland[1] / 1000).toFixed(3) }],
        dieselNet: [{ year: pt.year, month: pt.month, value: +(poland[2] / 1000).toFixed(3) }]
    };
}

function combinePln(oil, fx) {
    var fxMap = {};
    fx.forEach(function (p) { fxMap[p.year + "-" + p.month] = p.value; });
    return oil.map(function (p) {
        var rate = fxMap[p.year + "-" + p.month];
        if (!rate) return null;
        return {
            year: p.year, month: p.month,
            value: +((p.value * rate) / LITRE_PER_BBL).toFixed(3)
        };
    }).filter(Boolean);
}

function estimateNet(gross, taxShare) {
    return gross.map(function (p) {
        return { year: p.year, month: p.month, value: +(p.value * (1 - taxShare)).toFixed(3) };
    });
}

async function main() {
    console.log("Brent/WTI…");
    var brent = await fetchEiaSpotMonthly("RBRTE");
    var wti = await fetchEiaSpotMonthly("RWTC");
    if (!brent || !brent.length) brent = fallbackOil("brent");
    if (!wti || !wti.length) wti = fallbackOil("wti");

    console.log("NBP USD/PLN…");
    var usdPln = await fetchNbpUsd();

    console.log("Poland fuel (EC bulletin via fuel-prices.eu)…");
    var fuel;
    try {
        fuel = await fetchPolandFuelFromPage();
        if (!fuel.pb95WithTax.length) throw new Error("empty page parse");
    } catch (e) {
        console.warn("Page parse failed, using txt:", e.message);
        fuel = await fetchPolandFuelFromTxt();
    }
    var net = await fetchEcNetto();
    if (net.pb95Net.length) {
        fuel.pb95Net = estimateNet(fuel.pb95WithTax, 0.324);
        fuel.dieselNet = estimateNet(fuel.dieselWithTax, 0.285);
        var last = fuel.pb95WithTax[fuel.pb95WithTax.length - 1];
        if (last) {
            fuel.pb95Net[fuel.pb95Net.length - 1] = net.pb95Net[0];
            fuel.dieselNet[fuel.dieselNet.length - 1] = net.dieselNet[0];
        }
    } else {
        fuel.pb95Net = estimateNet(fuel.pb95WithTax, 0.324);
        fuel.dieselNet = estimateNet(fuel.dieselWithTax, 0.285);
    }

    var brentPln = combinePln(brent, usdPln);
    var out = {
        fetchedAt: new Date().toISOString(),
        sources: {
            eia: EIA_KEY ? "live" : "reference",
            nbp: "live",
            ec: "ec-bulletin"
        },
        series: {
            brentUsd: { id: "RBRTE", meta: { pl: "Ropa Brent (USD/bbl)", en: "Brent crude (USD/bbl)", unit: "USD/bbl", fmt: "usd" }, points: brent },
            wtiUsd: { id: "RWTC", meta: { pl: "Ropa WTI (USD/bbl)", en: "WTI crude (USD/bbl)", unit: "USD/bbl", fmt: "usd" }, points: wti },
            usdPln: { id: "USD/PLN", meta: { pl: "Kurs USD/PLN (NBP, tabela A)", en: "USD/PLN rate (NBP, table A)", unit: "PLN", fmt: "pln" }, points: usdPln },
            brentPln: { id: "Brent-PLN", meta: { pl: "Brent w PLN/l (po przeliczeniu)", en: "Brent in PLN/litre (converted)", unit: "PLN/l", fmt: "plnl" }, points: brentPln },
            pb95WithTax: { id: "Pb95-brutto", meta: { pl: "Pb95 z podatkiem (EUR/l)", en: "Pb95 with tax (EUR/l)", unit: "EUR/l", fmt: "fuel" }, points: fuel.pb95WithTax },
            dieselWithTax: { id: "Diesel-brutto", meta: { pl: "Diesel z podatkiem (EUR/l)", en: "Diesel with tax (EUR/l)", unit: "EUR/l", fmt: "fuel" }, points: fuel.dieselWithTax },
            pb95Net: { id: "Pb95-netto", meta: { pl: "Pb95 netto (EUR/l)", en: "Pb95 net (EUR/l)", unit: "EUR/l", fmt: "fuel" }, points: fuel.pb95Net },
            dieselNet: { id: "Diesel-netto", meta: { pl: "Diesel netto (EUR/l)", en: "Diesel net (EUR/l)", unit: "EUR/l", fmt: "fuel" }, points: fuel.dieselNet }
        }
    };

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, "window.BARREL_SNAPSHOT=" + JSON.stringify(out) + ";\n");
    console.log("Saved", OUT);
    console.log("Points:", Object.keys(out.series).map(function (k) {
        return k + ":" + out.series[k].points.length;
    }).join(", "));
}

main().catch(function (e) {
    console.error(e);
    process.exit(1);
});
