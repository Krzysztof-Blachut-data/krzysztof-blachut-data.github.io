(function () {
    if (!document.getElementById("dc-table")) return;

    var NAME_MAP = {
        "Glucose": "Glucose",
        "Fasting Glucose": "Glucose",
        "Blood Sugar": "Glucose",
        "Cholesterol": "Cholesterol",
        "Serum Cholesterol": "Cholesterol",
        "Total Chol": "Cholesterol",
        "HbA1c": "HbA1c",
        "Hemoglobin A1c": "HbA1c",
        "Glycated Hemoglobin": "HbA1c"
    };

    var GLUCOSE_MGDL = 18.0182;
    var CHOL_MGDL = 38.67;
    var PREVIEW = 14;

    var STEPS = [
        {
            titlePl: "Surowe dane — problemy w secie",
            titleEn: "Raw data — problems in the set",
            bodyPl: "W tabeli widać te same problemy co na liście powyżej. Żółte komórki to braki i ujemne strażniki, niebieskie — za długa precyzja, fioletowe — zakres niedopasowany do jednostki.",
            bodyEn: "The table shows the same issues listed above. Yellow cells are missing values and negative sentinels, blue is excess precision, purple is a range that does not match the unit.",
            issuesPl: [],
            issuesEn: [],
            code: "df = pd.read_csv(\"multi_hospital_lab_results.csv\")\nprint(df[\"test_value\"].head(12))\nprint(df[\"test_name\"].nunique(), df[\"unit\"].unique())"
        },
        {
            titlePl: "Braki i wartości strażnicze",
            titleEn: "Missing & sentinel values",
            bodyPl: "Puste komórki, tekst „not collected” i wartość -999 to ten sam problem: brak wyniku. Zamieniam je na braki (NaN), żeby nie psuły średnich i wykresów.",
            bodyEn: "Empty cells, “not collected” and -999 are the same issue: a missing result. They become NaN so they do not distort averages or charts.",
            code: "df[\"test_value\"] = pd.to_numeric(df[\"test_value\"], errors=\"coerce\")\ndf.loc[df[\"test_value\"] == -999, \"test_value\"] = np.nan"
        },
        {
            titlePl: "Słownik nazw badań",
            titleEn: "Standardise test names",
            bodyPl: "9 etykiet sprowadzam do 3 anality: Glucose, Cholesterol, HbA1c. Inaczej ten sam parametr liczyłby się jako osobne badania.",
            bodyEn: "9 labels collapse into 3 analytes: Glucose, Cholesterol, HbA1c. Otherwise the same test would be counted as separate assays.",
            code: "name_map = {\n  \"Fasting Glucose\": \"Glucose\", \"Blood Sugar\": \"Glucose\",\n  \"Serum Cholesterol\": \"Cholesterol\", \"Total Chol\": \"Cholesterol\",\n  \"Hemoglobin A1c\": \"HbA1c\", \"Glycated Hemoglobin\": \"HbA1c\"\n}\ndf[\"test_name\"] = df[\"test_name\"].replace(name_map)"
        },
        {
            titlePl: "Jednostki SI",
            titleEn: "Harmonise units (SI)",
            bodyPl: "Glukoza i cholesterol są w mmol/L albo mg/dL. Przeliczam mg/dL na mmol/L (glukoza ÷ 18.02, cholesterol ÷ 38.67) i zaokrąglam do 2 miejsc.",
            bodyEn: "Glucose and cholesterol mix mmol/L and mg/dL. mg/dL is converted to mmol/L (glucose ÷ 18.02, cholesterol ÷ 38.67) and rounded to 2 decimals.",
            code: "mask_g = (df[\"analyte\"]==\"Glucose\") & (df[\"unit\"]==\"mg/dL\")\ndf.loc[mask_g, \"test_value\"] /= 18.0182\nmask_c = (df[\"analyte\"]==\"Cholesterol\") & (df[\"unit\"]==\"mg/dL\")\ndf.loc[mask_c, \"test_value\"] /= 38.67\ndf[\"unit\"] = df[\"analyte\"].map({\"Glucose\":\"mmol/L\",\"Cholesterol\":\"mmol/L\",\"HbA1c\":\"%\"})"
        },
        {
            titlePl: "Zakresy referencyjne",
            titleEn: "Align reference ranges",
            bodyPl: "Szpitale używają 9 różnych zapisów zakresu, często niedopasowanych do jednostki (np. 70–99 przy mmol/L). Ujednolicam do SI: glukoza 3.9–5.5, cholesterol 3.2–5.2, HbA1c <5.7%.",
            bodyEn: "Hospitals use 9 range formats, often mismatched to the unit (e.g. 70–99 next to mmol/L). Ranges are aligned to SI: glucose 3.9–5.5, cholesterol 3.2–5.2, HbA1c <5.7%.",
            code: "ranges = {\n  \"Glucose\": \"3.9–5.5 mmol/L\",\n  \"Cholesterol\": \"3.2–5.2 mmol/L\",\n  \"HbA1c\": \"<5.7%\"\n}\ndf[\"reference_range\"] = df[\"analyte\"].map(ranges)"
        },
        {
            titlePl: "Wartości odstające",
            titleEn: "Flag outliers",
            bodyPl: "500 i 1860 mmol/L przy glukozie są fizjologicznie niemożliwe — to błędy zapisu, nie wyniki. Oznaczam je jako outlier i wyłączam z dalszej analizy.",
            bodyEn: "500 and 1860 mmol/L for glucose are physiologically impossible — recording errors, not results. They are flagged as outliers and excluded.",
            code: "limits = {\"Glucose\": (0.5, 40), \"Cholesterol\": (0.5, 20), \"HbA1c\": (3, 20)}\nlo, hi = zip(*df[\"analyte\"].map(limits))\ndf[\"outlier\"] = ~df[\"test_value\"].between(lo, hi) & df[\"test_value\"].notna()"
        },
        {
            titlePl: "Zestaw gotowy do analizy",
            titleEn: "Analysis-ready dataset",
            bodyPl: "Usuwam braki i outliery. Zostaje spójna tabela: 3 anality, jednostki SI, jeden zakres referencyjny. Na tym można już liczyć KPI i porównywać szpitale.",
            bodyEn: "Missing values and outliers are dropped. What remains is a consistent table: 3 analytes, SI units, one reference range. KPIs and hospital comparisons can start from here.",
            code: "clean = df.loc[~df[\"outlier\"] & df[\"test_value\"].notna()].copy()\nclean.to_csv(\"lab_results_clean.csv\", index=False)"
        }
    ];

    var rawRows = [];
    var step = 0;

    function initRows(data) {
        rawRows = data.map(function (row, i) {
            var copy = {};
            Object.keys(row).forEach(function (k) { copy[k] = row[k]; });
            copy._i = i;
            return copy;
        });
        renderStep();
    }

    function parseCSV(text) {
        var lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
        var headers = lines[0].split(",");
        return lines.slice(1).map(function (line, i) {
            var cols = line.split(",");
            var row = { _i: i };
            headers.forEach(function (h, idx) {
                row[h] = cols[idx] === undefined ? "" : cols[idx];
            });
            return row;
        });
    }

    function isRangeMismatch(name, unit, range) {
        var r = String(range || "");
        var mgdlRange = r === "70-99" || r === "125-200" || r === "Normal: <100" || r === "<200";
        var mmolRange = r === "3.9-5.5" || r === "3.2-5.2";
        if (unit === "mmol/L" && mgdlRange) return true;
        if (unit === "mg/dL" && mmolRange) return true;
        return false;
    }

    function isMissingRaw(v) {
        var s = String(v == null ? "" : v).trim();
        return s === "" || s === "nan" || s.toLowerCase() === "not collected" || s === "-999";
    }

    function analyteOf(name) {
        return NAME_MAP[name] || name;
    }

    function toNumber(v) {
        if (v === "" || v == null || v === "—") return NaN;
        var n = Number(v);
        return Number.isFinite(n) ? n : NaN;
    }

    function convertValue(name, value, unit) {
        var n = toNumber(value);
        if (!Number.isFinite(n)) return n;
        var a = analyteOf(name);
        if (a === "Glucose" && unit === "mg/dL") return n / GLUCOSE_MGDL;
        if (a === "Cholesterol" && unit === "mg/dL") return n / CHOL_MGDL;
        return n;
    }

    function siUnit(name) {
        return analyteOf(name) === "HbA1c" ? "%" : "mmol/L";
    }

    function siRange(name) {
        var a = analyteOf(name);
        if (a === "Glucose") return "3.9–5.5 mmol/L";
        if (a === "Cholesterol") return "3.2–5.2 mmol/L";
        return "<5.7%";
    }

    function isOutlier(name, siValue) {
        if (!Number.isFinite(siValue)) return false;
        var a = analyteOf(name);
        if (a === "Glucose") return siValue < 0.5 || siValue > 40;
        if (a === "Cholesterol") return siValue < 0.5 || siValue > 20;
        return siValue < 3 || siValue > 20;
    }

    function process(level) {
        return rawRows.map(function (src) {
            var row = {
                hospital: src.hospital,
                patient_id: src.patient_id,
                test_name: src.test_name,
                test_value: src.test_value,
                unit: src.unit,
                reference_range: src.reference_range,
                collection_date: src.collection_date,
                flags: {},
                drop: false
            };

            var missing = isMissingRaw(src.test_value);
            var numeric = toNumber(src.test_value);
            if (String(src.test_value).trim() === "-999") numeric = NaN;

            if (level === 0) {
                var raw = String(src.test_value == null ? "" : src.test_value).trim();
                var n0 = Number(raw);
                if (raw === "" || raw.toLowerCase() === "not collected" || raw.toLowerCase() === "nan" || raw === "-999" || (Number.isFinite(n0) && n0 < 0)) {
                    row.flags.value = "invalid";
                } else if (/\.\d{4,}/.test(raw)) {
                    row.flags.value = "noisy";
                }
                if (isRangeMismatch(src.test_name, src.unit, src.reference_range)) {
                    row.flags.range = "mismatch";
                }
            }

            if (level >= 1) {
                if (missing) {
                    row.test_value = "—";
                    row.flags.value = "invalid";
                }
            }

            if (level >= 2) {
                var mapped = analyteOf(src.test_name);
                if (mapped !== src.test_name) row.flags.name = "changed";
                row.test_name = mapped;
            }

            if (level >= 3 && !missing) {
                var converted = convertValue(src.test_name, src.test_value, src.unit);
                var newUnit = siUnit(src.test_name);
                if (src.unit !== newUnit) row.flags.unit = "changed";
                if (src.unit === "mg/dL") row.flags.value = "changed";
                row.test_value = Number.isFinite(converted) ? converted.toFixed(2) : "—";
                row.unit = newUnit;
            } else if (level >= 3 && missing) {
                row.unit = siUnit(src.test_name);
            }

            if (level >= 4) {
                var newRange = siRange(src.test_name);
                if (src.reference_range !== newRange) row.flags.range = "changed";
                row.reference_range = newRange;
            }

            if (level >= 5) {
                var siVal = missing ? NaN : convertValue(src.test_name, src.test_value, src.unit);
                if (isOutlier(src.test_name, siVal)) {
                    row.flags.value = "outlier";
                    row.outlier = true;
                }
            }

            if (level >= 6) {
                var siVal2 = missing ? NaN : convertValue(src.test_name, src.test_value, src.unit);
                if (missing || isOutlier(src.test_name, siVal2)) row.drop = true;
            }

            return row;
        });
    }

    function lang() {
        return document.documentElement.getAttribute("data-lang") === "en" ? "en" : "pl";
    }

    function stats(rows) {
        var visible = rows.filter(function (r) { return !r.drop; });
        var names = {};
        var missing = 0;
        var outliers = 0;
        visible.forEach(function (r) {
            names[r.test_name] = true;
            var v = String(r.test_value).trim().toLowerCase();
            if (v === "—" || v === "" || v === "nan" || v === "not collected" || v === "-999" || r.flags.value === "invalid") {
                missing += 1;
            }
            if (r.outlier) outliers += 1;
        });
        return {
            rows: visible.length,
            names: Object.keys(names).length,
            missing: missing,
            outliers: outliers
        };
    }

    function cellClass(flag) {
        if (flag === "invalid") return "dc-cell invalid";
        if (flag === "outlier") return "dc-cell outlier";
        if (flag === "changed") return "dc-cell changed";
        if (flag === "noisy") return "dc-cell noisy";
        if (flag === "mismatch") return "dc-cell mismatch";
        return "";
    }

    function renderTable(rows) {
        var preview = [];
        for (var i = 0; i < rows.length && preview.length < PREVIEW; i++) {
            if (!rows[i].drop) preview.push(rows[i]);
        }
        var html = "<thead><tr>" +
            "<th>hospital</th><th>patient_id</th><th>test_name</th>" +
            "<th>test_value</th><th>unit</th><th>reference_range</th><th>collection_date</th>" +
            "</tr></thead><tbody>";
        preview.forEach(function (r) {
            html += "<tr>" +
                "<td>" + r.hospital + "</td>" +
                "<td>" + r.patient_id + "</td>" +
                "<td class=\"" + cellClass(r.flags.name) + "\">" + r.test_name + "</td>" +
                "<td class=\"" + cellClass(r.flags.value) + "\">" + r.test_value + "</td>" +
                "<td class=\"" + cellClass(r.flags.unit) + "\">" + r.unit + "</td>" +
                "<td class=\"" + cellClass(r.flags.range) + "\">" + r.reference_range + "</td>" +
                "<td>" + r.collection_date + "</td>" +
                "</tr>";
        });
        html += "</tbody>";
        document.getElementById("dc-table").innerHTML = html;
        var s = stats(rows);
        var en = lang() === "en";
        document.getElementById("dc-caption").textContent = en
            ? "Showing " + preview.length + " of " + s.rows + " rows"
            : "Podgląd " + preview.length + " z " + s.rows + " wierszy";
        document.getElementById("m-rows").textContent = s.rows.toLocaleString("pl-PL");
        document.getElementById("m-names").textContent = s.names;
        document.getElementById("m-missing").textContent = s.missing;
        document.getElementById("m-outliers").textContent = s.outliers;
    }

    function renderStep() {
        var meta = STEPS[step];
        var en = lang() === "en";
        document.getElementById("dc-step-title").textContent = en ? meta.titleEn : meta.titlePl;
        document.getElementById("dc-step-body").textContent = en ? meta.bodyEn : meta.bodyPl;
        var issues = en ? (meta.issuesEn || []) : (meta.issuesPl || []);
        var list = document.getElementById("dc-issues");
        list.innerHTML = issues.map(function (item) { return "<li>" + item + "</li>"; }).join("");
        list.hidden = issues.length === 0;
        document.getElementById("dc-code").textContent = meta.code;
        document.getElementById("dc-progress").textContent = (step + 1) + " / " + STEPS.length;
        document.querySelectorAll(".dc-step").forEach(function (btn) {
            var n = Number(btn.getAttribute("data-step"));
            btn.classList.toggle("active", n === step);
            btn.classList.toggle("done", n < step);
        });
        document.getElementById("dc-prev").disabled = step === 0;
        document.getElementById("dc-next").disabled = step === STEPS.length - 1;
        renderTable(process(step));
    }

    function go(n) {
        var previous = step;
        step = Math.max(0, Math.min(STEPS.length - 1, n));
        renderStep();
        if (step === previous) return;
        var target = document.getElementById("dc-walkthrough");
        if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }

    document.getElementById("dc-prev").addEventListener("click", function () { go(step - 1); });
    document.getElementById("dc-next").addEventListener("click", function () { go(step + 1); });
    document.querySelectorAll(".dc-step").forEach(function (btn) {
        btn.addEventListener("click", function () { go(Number(btn.getAttribute("data-step"))); });
    });
    document.querySelectorAll("[data-set-lang]").forEach(function (btn) {
        btn.addEventListener("click", function () { setTimeout(renderStep, 0); });
    });

    var CSV_URL = "projects/data-cleaning/multi_hospital_lab_results.csv";

    function boot() {
        if (window.LAB_ROWS && window.LAB_ROWS.length) {
            initRows(window.LAB_ROWS);
            return;
        }

        fetch(CSV_URL)
            .then(function (r) {
                if (!r.ok) throw new Error("HTTP " + r.status);
                return r.text();
            })
            .then(function (text) {
                initRows(parseCSV(text));
            })
            .catch(function () {
                document.getElementById("dc-step-body").textContent =
                    lang() === "en"
                        ? "Could not load data. Refresh the page or use a local server."
                        : "Nie udało się wczytać danych. Odśwież stronę lub uruchom lokalny serwer.";
            });
    }

    boot();
})();
