#!/usr/bin/env node
"use strict";

var fs = require("fs");
var path = require("path");

var BBOX = { lamin: 49, lomin: 14, lamax: 55, lomax: 24 };
var API_URL =
    "https://opensky-network.org/api/states/all?" +
    "lamin=" + BBOX.lamin + "&lomin=" + BBOX.lomin +
    "&lamax=" + BBOX.lamax + "&lomax=" + BBOX.lomax + "&extended=1";
var OUT = path.join(__dirname, "..", "projects", "opensky-live", "snapshot.js");

function compact(s) {
    return {
        i: s[0],
        c: (s[1] || "").trim(),
        o: s[2] || "",
        lat: s[6],
        lon: s[5],
        alt: s[7],
        g: !!s[8],
        v: s[9],
        h: s[10],
        vr: s[11],
        ga: s[13],
        sq: s[14] != null ? String(s[14]) : null,
        cat: s[17] || 0
    };
}

async function main() {
    var res = await fetch(API_URL, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("OpenSky HTTP " + res.status);
    var data = await res.json();
    var states = (data.states || [])
        .filter(function (s) { return s[5] != null && s[6] != null; })
        .map(compact);
    var payload = {
        fetchedAt: new Date().toISOString(),
        time: data.time,
        bbox: BBOX,
        count: states.length,
        states: states
    };
    fs.writeFileSync(OUT, "window.OPENSKY_SNAPSHOT=" + JSON.stringify(payload) + ";\n", "utf8");
    console.log("wrote " + path.relative(process.cwd(), OUT) + " (" + states.length + " aircraft)");
}

main().catch(function (err) {
    console.error(err.message || err);
    process.exit(1);
});
