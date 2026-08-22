#!/usr/bin/env node
/**
 * Smoke-test the energy pipeline charts in jsdom.
 *
 *   python -m http.server 8791 --bind 127.0.0.1
 *   node scripts/check_render.js
 *   node scripts/check_render.js http://127.0.0.1:8791/projects/energy-pipeline/
 */
const path = require("path");
const { JSDOM } = require("jsdom");

const BASE = process.argv[2] || "http://127.0.0.1:8791/projects/energy-pipeline/";
const failures = [];
const notes = [];

function check(label, condition, detail) {
  if (condition) {
    notes.push(`  ok   ${label}`);
  } else {
    failures.push(`  FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

function pathsIn(svgHost) {
  return Array.from(svgHost.querySelectorAll("path")).map((p) => p.getAttribute("d") || "");
}

(async () => {
  const dom = await JSDOM.fromURL(BASE, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const { document } = window;

  await new Promise((resolve) => {
    if (document.readyState === "complete") resolve();
    else window.addEventListener("load", resolve);
  });
  // the project bundles are lazy-loaded, so give the idle callbacks a chance to fire
  await new Promise((r) => setTimeout(r, 1500));

  check("pipeline payload present", !!window.__PIPELINE_DATA);
  const DATA = window.__PIPELINE_DATA || {};
  check("daily layer present in payload", !!DATA.daily, "run pipeline.py then build_pipeline_data.py");

  // step 8 is the visualisation panel; clicking its chip triggers the chart build
  const chips = Array.from(document.querySelectorAll(".ep-chip"));
  check("pipeline step chips found", chips.length > 0);
  if (chips.length) chips[chips.length - 1].click();
  await new Promise((r) => setTimeout(r, 300));

  const main = document.getElementById("ep-viz-main");
  check("main chart container exists", !!main);

  // --- monthly grain ---------------------------------------------------------
  let monthly = main ? pathsIn(main) : [];
  check("monthly chart drew lines", monthly.length >= 2, `found ${monthly.length} paths`);
  check("monthly paths have no NaN", !monthly.some((d) => d.includes("NaN")));
  check(
    "monthly title mentions Pb95",
    (document.getElementById("ep-chart-title") || {}).textContent?.includes("Pb95")
  );
  check("monthly note visible", !document.getElementById("ep-note-monthly")?.hidden);
  check("daily note hidden", document.getElementById("ep-note-daily")?.hidden === true);

  const grain = document.getElementById("ep-grain");
  check("granularity control rendered", !!grain && grain.style.display !== "none");
  const dailyBtn = document.querySelector('[data-grain="daily"]');
  const monthlyBtn = document.querySelector('[data-grain="monthly"]');
  check("both grain buttons exist", !!dailyBtn && !!monthlyBtn);

  // --- daily grain -----------------------------------------------------------
  if (dailyBtn) {
    dailyBtn.click();
    await new Promise((r) => setTimeout(r, 300));
    const daily = main ? pathsIn(main) : [];
    check("daily chart drew lines", daily.length >= 3, `found ${daily.length} paths`);
    check("daily paths have no NaN", !daily.some((d) => d.includes("NaN")));
    check(
      "daily chart is denser than monthly",
      daily.join(" ").length > monthly.join(" ").length,
      "daily should contain far more vertices"
    );
    check("daily button marked pressed", dailyBtn.getAttribute("aria-pressed") === "true");
    check("monthly button unpressed", monthlyBtn.getAttribute("aria-pressed") === "false");
    check("daily note visible", document.getElementById("ep-note-daily")?.hidden === false);
    check("monthly note hidden", document.getElementById("ep-note-monthly")?.hidden === true);

    const note = document.getElementById("ep-grain-note");
    const text = note ? note.textContent : "";
    check("daily note explains the averaging loss", /9\.12|9,12/.test(text), text.slice(0, 120));
    check("daily note explains negative WTI", /-36\.98|−36,98|-36,98/.test(text));
    check(
      "grain meta reports the quote count",
      (document.getElementById("ep-grain-meta") || {}).textContent?.includes(String(DATA.daily?.rows))
    );

    // switching back must restore the monthly view, not leave a half-updated chart
    monthlyBtn.click();
    await new Promise((r) => setTimeout(r, 300));
    check("returns to monthly cleanly", pathsIn(main).length === monthly.length);
    check("monthly note restored", document.getElementById("ep-note-monthly")?.hidden === false);
  }

  // --- KPI cards -------------------------------------------------------------
  const metrics = document.getElementById("ep-viz-metrics");
  const metricText = metrics ? metrics.textContent : "";
  check("KPI cards rendered", (metrics?.querySelectorAll(".metric").length || 0) >= 5);
  if (DATA.latest?.date) {
    const year = DATA.latest.date.slice(0, 4);
    check("KPI month label derives from the data", metricText.includes(year), metricText.slice(0, 160));
  }
  if (DATA.daily?.latest) {
    check(
      "KPI shows the freshest daily quote",
      metricText.includes(DATA.daily.latest.date),
      "expected " + DATA.daily.latest.date
    );
  }

  // --- language switch -------------------------------------------------------
  const en = document.querySelector('[data-set-lang="en"]');
  if (en && dailyBtn) {
    dailyBtn.click();
    en.click();
    await new Promise((r) => setTimeout(r, 400));
    const text = document.getElementById("ep-grain-note")?.textContent || "";
    check("daily note follows the language switch", /quote|averaging|crash/i.test(text), text.slice(0, 120));
    check("grain survives the language switch", dailyBtn.getAttribute("aria-pressed") === "true");
  }

  console.log(notes.join("\n"));
  if (failures.length) {
    console.error("\n" + failures.join("\n"));
    console.error(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log(`\nall ${notes.length} render checks passed`);
  window.close();
})().catch((err) => {
  console.error("render check crashed:", err);
  process.exit(1);
});
