(function () {
    if (!document.getElementById("dc-table")) return;

    var NAME_GROUPS = {
        "Glucose": ["Glucose", "Fasting Glucose", "Blood Sugar"],
        "Cholesterol": ["Cholesterol", "Serum Cholesterol", "Total Chol"],
        "HbA1c": ["HbA1c", "Hemoglobin A1c", "Glycated Hemoglobin"]
    };

    var NAME_MAP = {};
    Object.keys(NAME_GROUPS).forEach(function (canonical) {
        NAME_GROUPS[canonical].forEach(function (variant) {
            NAME_MAP[variant] = canonical;
        });
    });

    var GLUCOSE_MGDL = 18.0182;
    var CHOL_MGDL = 38.67;
    var PREVIEW = 14;

    var STEPS = [
        {
            titlePl: "Surowe dane — ocena jakości",
            titleEn: "Raw data — quality assessment",
            bodyPl: "Zanim cokolwiek usunę, liczę problemy w każdym wymiarze jakości danych. Na tym etapie nic nie znika — tylko wykrywam braki, strażniki, niespójne nazwy i wartości mało prawdopodobne (np. 500 mmol/L glukozy).",
            bodyEn: "Before removing anything, I count issues across each data-quality dimension. At this stage nothing is dropped — I only detect missing values, sentinels, inconsistent labels and implausible values (e.g. 500 mmol/L glucose).",
            issuesPl: [],
            issuesEn: [],
            code: "profile = {\n  \"missing_empty\": (df[\"test_value\"].isna() | df[\"test_value\"].eq(\"\")).sum(),\n  \"sentinel_-999\": (df[\"test_value\"] == -999).sum(),\n  \"implausible\": flag_implausible_values(df).sum(),\n  \"name_variants\": df[\"test_name\"].nunique(),\n  \"range_mismatches\": flag_range_unit_mismatch(df).sum()\n}\nprint(profile)"
        },
        {
            titlePl: "Braki i wartości strażnicze",
            titleEn: "Missing & sentinel values",
            bodyPl: "Puste wartości, tekst „not collected” oraz kod −999 reprezentują brak dostępnego wyniku, ale pochodzą z różnych sposobów zapisu w systemach źródłowych. Przed analizą ujednolicam je do NaN, zachowując surową wartość i przyczynę braku — rekordy nie są usuwane (NaN ≠ delete row).",
            bodyEn: "Empty values, “not collected” text and the −999 code all represent a missing result, but they come from different source-system conventions. Before analysis I standardise them to NaN while keeping the raw value and the reason — rows are not deleted (NaN ≠ delete row).",
            missingStory: true,
            code: "df[\"test_value_raw\"] = df[\"test_value\"]\n\ndf[\"missing_reason\"] = np.select(\n    [\n        df[\"test_value\"].isna(),\n        df[\"test_value\"].astype(str).str.strip().eq(\"\"),\n        df[\"test_value\"].astype(str).str.lower().eq(\"not collected\"),\n        df[\"test_value\"].astype(str).eq(\"-999\")\n    ],\n    [\"missing\", \"blank\", \"not_collected\", \"sentinel_-999\"],\n    default=None\n)\n\ndf[\"test_value\"] = pd.to_numeric(df[\"test_value\"], errors=\"coerce\")\ndf.loc[df[\"test_value\"] == -999, \"test_value\"] = np.nan\n# 1,500 rows kept — exclusion happens only at the analysis-ready step"
        },
        {
            titlePl: "Słownik nazw badań",
            titleEn: "Standardise test names",
            bodyPl: "Dziewięć wariantów nazw reprezentuje trzy rzeczywiste anality. Standaryzuję etykiety do jednej nazwy kanonicznej dla każdego badania, żeby uniknąć sztucznego rozbijania agregacji, KPI i porównań między szpitalami. Grupuję tylko semantycznie równoważne etykiety — bez automatycznego fuzzy matchingu.",
            bodyEn: "Nine label variants represent three real analytes. I standardise labels to one canonical name per test to avoid artificially splitting aggregations, KPIs and cross-hospital comparisons. Only semantically equivalent labels are grouped — no automatic fuzzy matching.",
            namesStory: true,
            code: "name_map = {\n    \"Glucose\": [\"Glucose\", \"Fasting Glucose\", \"Blood Sugar\"],\n    \"Cholesterol\": [\"Cholesterol\", \"Serum Cholesterol\", \"Total Chol\"],\n    \"HbA1c\": [\"HbA1c\", \"Hemoglobin A1c\", \"Glycated Hemoglobin\"]\n}\n\ncanonical_map = {\n    variant: canonical\n    for canonical, variants in name_map.items()\n    for variant in variants\n}\n\ndf[\"test_name_raw\"] = df[\"test_name\"]\ndf[\"test_name\"] = df[\"test_name\"].replace(canonical_map)\n# only semantically equivalent labels — no fuzzy matching"
        },
        {
            titlePl: "Jednostki SI",
            titleEn: "Harmonise units (SI)",
            bodyPl: "Wyniki tego samego analitu zapisane w mg/dL i mmol/L nie są bezpośrednio porównywalne. Wartości standaryzuję do jednej jednostki docelowej, stosując współczynnik konwersji właściwy dla danego analitu. Konwersja wartości ≠ kompletna standaryzacja rekordu — zakresy referencyjne nadal mogą być niedopasowane (krok 5).",
            bodyEn: "Results for the same analyte recorded in mg/dL and mmol/L are not directly comparable. I standardise values to one target unit using the conversion factor appropriate to each analyte. Value conversion ≠ full record standardisation — reference ranges may still be incompatible (Step 5).",
            story: true,
            code: "# Glucose: mg/dL → mmol/L\nmask_glucose = (\n    (df[\"test_name\"] == \"Glucose\") &\n    (df[\"unit\"] == \"mg/dL\")\n)\ndf.loc[mask_glucose, \"test_value\"] = (\n    df.loc[mask_glucose, \"test_value\"] / 18.0182\n).round(2)\ndf.loc[mask_glucose, \"unit\"] = \"mmol/L\"\n\n# Cholesterol: mg/dL → mmol/L\nmask_cholesterol = (\n    (df[\"test_name\"] == \"Cholesterol\") &\n    (df[\"unit\"] == \"mg/dL\")\n)\ndf.loc[mask_cholesterol, \"test_value\"] = (\n    df.loc[mask_cholesterol, \"test_value\"] / 38.67\n).round(2)\ndf.loc[mask_cholesterol, \"unit\"] = \"mmol/L\""
        },
        {
            titlePl: "Zakresy referencyjne",
            titleEn: "Align reference ranges",
            bodyPl: "Standaryzuję format zakresów referencyjnych do jednego słownika na analit. Na potrzeby tego syntetycznego case study przyjmuję jeden zestaw wartości docelowych — celem jest demonstracja standaryzacji danych, a nie interpretacja kliniczna. W praktyce zakres zależy od metody, laboratorium, populacji i kontekstu pobrania.",
            bodyEn: "I standardise reference-range format to one dictionary per analyte. For this synthetic case study I apply one set of target values — the goal is to demonstrate data standardisation, not clinical interpretation. In practice, ranges depend on method, laboratory, population and collection context.",
            code: "# case-study dictionary — not universal clinical ranges\nstudy_ranges = {\n  \"Glucose\": \"3.9–5.5 mmol/L\",\n  \"Cholesterol\": \"3.2–5.2 mmol/L\",\n  \"HbA1c\": \"<5.7%\"\n}\ndf[\"reference_range\"] = df[\"test_name\"].map(study_ranges)"
        },
        {
            titlePl: "Wartości mało prawdopodobne — flagowanie",
            titleEn: "Implausible values — flagging",
            bodyPl: "500 mmol/L glukozy to mało prawdopodobna wartość, nie automatyczny błąd do usunięcia. Najpierw flaguję (quality_flag), potem decyduję o wykluczeniu z analizy — audytowalny pipeline: detection → flagging → decision → exclusion.",
            bodyEn: "500 mmol/L glucose is implausible, not an automatic delete. I flag it first (quality_flag), then decide on exclusion — an auditable pipeline: detection → flagging → decision → exclusion.",
            flagStory: true,
            code: "df[\"quality_flag\"] = \"valid\"\n\ndf.loc[\n    df[\"test_value\"].isna(),\n    \"quality_flag\"\n] = \"missing_value\"\n\ndf.loc[\n    (df[\"test_name\"] == \"Glucose\") &\n    (df[\"test_value\"] > 40),\n    \"quality_flag\"\n] = \"implausible_value\"\n# Glucose > 40 mmol/L — data-quality rule, not clinical diagnosis"
        },
        {
            titlePl: "Zestaw gotowy do analizy",
            titleEn: "Analysis-ready dataset",
            bodyPl: "Wykluczam z analytical dataset rekordy z quality_flag ≠ valid (101 braków/invalid + 7 mało prawdopodobnych). Pozostaje 1 392 wiersze (92,8%). Surowe i standaryzowane dane zachowuję osobno — lineage: raw → standardized/audit → analysis.",
            bodyEn: "I exclude records where quality_flag ≠ valid from the analytical dataset (101 missing/invalid + 7 implausible). 1,392 rows remain (92.8%). Raw and standardized data are kept separately — lineage: raw → standardized/audit → analysis.",
            cleanStory: true,
            code: "df.to_csv(\"lab_results_standardized.csv\", index=False)  # 1,500 rows — audit trail\n\nanalysis = df.loc[df[\"quality_flag\"] == \"valid\"].copy()\nanalysis.to_csv(\"lab_results_analysis.csv\", index=False)  # 1,392 rows"
        },
        {
            titlePl: "Analiza — różnice między szpitalami",
            titleEn: "Analysis — differences between hospitals",
            bodyPl: "1 392 obserwacji gotowych do analizy. Pytanie: czy wyniki laboratoryjne różnią się między szpitalami po standaryzacji? Poniżej mediana Glucose, Cholesterol i HbA1c wg Hospital A / B / C.",
            bodyEn: "1,392 analysis-ready observations. Question: do laboratory results differ between hospitals after standardisation? Below: median Glucose, Cholesterol and HbA1c by Hospital A / B / C.",
            code: "raw = pd.read_csv(\"multi_hospital_lab_results.csv\")\n# ... cleaning pipeline ...\nanalysis = df.loc[df[\"quality_flag\"] == \"valid\"].copy()\n\nraw_name_count = raw[\"test_name\"].nunique()\nclean_name_count = analysis[\"test_name\"].nunique()\n\nanalysis.groupby([\"hospital\", \"test_name\"])[\"test_value\"].median().unstack()",
            visualize: true
        },
        {
            titlePl: "Wnioski z oczyszczonych danych",
            titleEn: "What the cleaned data actually says",
            bodyPl: "Czyszczenie nie jest celem samym w sobie. Bez niego porównanie szpitali byłoby fałszywe: Hospital_B wyglądałby na outlier, bo kilka błędów zapisu zawyża średnią glukozy.",
            bodyEn: "Cleaning is not the end goal. Without it, the hospital comparison would be false: Hospital_B would look like an outlier because a few recording errors inflate the glucose mean.",
            code: "raw = pd.read_csv(\"multi_hospital_lab_results.csv\")\n# ... cleaning pipeline ...\nanalysis = df.loc[df[\"quality_flag\"] == \"valid\"].copy()\n\ng_unfiltered = df.loc[\n    (df[\"test_name\"] == \"Glucose\") &\n    df[\"quality_flag\"].isin([\"valid\", \"implausible_value\"])\n].groupby(\"hospital\")[\"test_value\"].mean()\n\ng_ready = analysis.loc[analysis[\"test_name\"] == \"Glucose\"].groupby(\"hospital\")[\"test_value\"].mean()\nprint(\"Standardized, unfiltered:\\n\", g_unfiltered.round(2))\nprint(\"Analysis-ready:\\n\", g_ready.round(2))",
            insights: true
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

    function isBlank(v) {
        return String(v == null ? "" : v).trim() === "";
    }

    function isNotCollected(v) {
        return String(v == null ? "" : v).trim().toLowerCase() === "not collected";
    }

    function isNullish(v) {
        if (v == null) return true;
        var s = String(v).trim().toLowerCase();
        return s === "nan";
    }

    function isMissingEmpty(v) {
        return isBlank(v) || isNotCollected(v) || isNullish(v);
    }

    function classifyMissingReason(v) {
        if (isNullish(v)) return "missing";
        if (isBlank(v)) return "blank";
        if (isNotCollected(v)) return "not_collected";
        if (isSentinel(v)) return "sentinel_-999";
        if (isNonNumeric(v)) return "non_numeric";
        return null;
    }

    function computeMissingBreakdown() {
        var blank = 0;
        var notCollected = 0;
        var sentinel = 0;
        var nullish = 0;
        var nonNumeric = 0;
        rawRows.forEach(function (r) {
            var reason = classifyMissingReason(r.test_value);
            if (reason === "blank") blank += 1;
            else if (reason === "not_collected") notCollected += 1;
            else if (reason === "sentinel_-999") sentinel += 1;
            else if (reason === "missing") nullish += 1;
            else if (reason === "non_numeric") nonNumeric += 1;
        });
        return {
            blank: blank,
            notCollected: notCollected,
            sentinel: sentinel,
            nullish: nullish,
            nonNumeric: nonNumeric,
            totalStandardized: blank + notCollected + sentinel + nullish
        };
    }

    function isSentinel(v) {
        return String(v == null ? "" : v).trim() === "-999";
    }

    function isMissingRaw(v) {
        return isMissingEmpty(v) || isSentinel(v);
    }

    function isNonNumeric(v) {
        if (isMissingEmpty(v) || isSentinel(v)) return false;
        var s = String(v).trim();
        return !Number.isFinite(Number(s));
    }

    function rawQualityFlag(src) {
        if (isMissingEmpty(src.test_value)) return "missing";
        if (isSentinel(src.test_value)) return "sentinel";
        if (isNonNumeric(src.test_value)) return "non_numeric";
        var si = convertValue(src.test_name, src.test_value, src.unit);
        if (isOutlier(src.test_name, si)) return "implausible_value";
        return "valid";
    }

    function computeRawProfile() {
        var names = {};
        var blank = 0;
        var notCollected = 0;
        var nullish = 0;
        var sentinel = 0;
        var nonNumeric = 0;
        var implausible = 0;
        var rangeMismatch = 0;
        var mgdl = 0;
        rawRows.forEach(function (r) {
            names[r.test_name] = true;
            var reason = classifyMissingReason(r.test_value);
            if (reason === "blank") blank += 1;
            else if (reason === "not_collected") notCollected += 1;
            else if (reason === "missing") nullish += 1;
            else if (reason === "sentinel_-999") sentinel += 1;
            else if (reason === "non_numeric") nonNumeric += 1;
            else {
                var si = convertValue(r.test_name, r.test_value, r.unit);
                if (isOutlier(r.test_name, si)) implausible += 1;
            }
            if (isRangeMismatch(r.test_name, r.unit, r.reference_range)) rangeMismatch += 1;
            if (r.unit === "mg/dL") mgdl += 1;
        });
        var missing = blank + notCollected + nullish;
        var missingTestValues = missing + sentinel + nonNumeric;
        var invalid = missingTestValues + implausible;
        return {
            rows: rawRows.length,
            names: Object.keys(names).length,
            blank: blank,
            notCollected: notCollected,
            nullish: nullish,
            missing: missing,
            missingTestValues: missingTestValues,
            sentinel: sentinel,
            sentinelRaw: sentinel,
            nonNumeric: nonNumeric,
            implausible: implausible,
            invalid: invalid,
            rangeMismatch: rangeMismatch,
            mgdl: mgdl,
            valid: rawRows.length - invalid,
            totalStandardized: blank + notCollected + sentinel + nullish,
            valuesConverted: 0
        };
    }

    function isInvalidTestValue(row) {
        return row.test_value === "NaN" ||
            row.quality_flag === "missing" ||
            row.quality_flag === "sentinel" ||
            row.quality_flag === "non_numeric";
    }

    function computeProcessedProfile(level) {
        var rows = process(level);
        var visible = rows.filter(function (r) { return !r.drop; });
        var names = {};
        var missingTestValues = 0;
        var implausible = 0;
        var rangeMismatch = 0;
        var mgdl = 0;
        var valuesConverted = 0;
        visible.forEach(function (r) {
            names[r.test_name] = true;
            if (isInvalidTestValue(r)) missingTestValues += 1;
            if (r.implausible || r.quality_flag === "implausible_value") implausible += 1;
            if (isRangeMismatch(r.test_name, r.unit, r.reference_range)) rangeMismatch += 1;
            if (r.unit === "mg/dL") mgdl += 1;
            if (level >= 3 && r.flags.unit === "changed") valuesConverted += 1;
        });
        return {
            rows: visible.length,
            names: Object.keys(names).length,
            blank: 0,
            notCollected: 0,
            missing: missingTestValues,
            missingTestValues: missingTestValues,
            sentinel: 0,
            sentinelRaw: 0,
            nonNumeric: 0,
            implausible: implausible,
            invalid: missingTestValues,
            rangeMismatch: rangeMismatch,
            mgdl: mgdl,
            valid: visible.length - missingTestValues - implausible,
            valuesConverted: valuesConverted
        };
    }

    function computeQualityProfile(level) {
        return level === 0 ? computeRawProfile() : computeProcessedProfile(level);
    }

    function getRawSnapshot() {
        return computeRawProfile();
    }

    function getAnalysisSnapshot() {
        return computeProcessedProfile(6);
    }

    function getStandardizedSnapshot() {
        return computeProcessedProfile(5);
    }

    function computePipelineCounts() {
        var raw = getRawSnapshot();
        var standardized = getStandardizedSnapshot();
        var analysis = getAnalysisSnapshot();
        var retainedPct = raw.rows
            ? ((analysis.rows / raw.rows) * 100).toLocaleString(lang() === "en" ? "en-US" : "pl-PL", {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1
            })
            : "0";
        return {
            raw: raw,
            standardized: standardized,
            analysis: analysis,
            excludedInvalid: raw.missingTestValues,
            excludedImplausible: raw.implausible,
            excludedTotal: raw.missingTestValues + raw.implausible,
            retained: analysis.rows,
            retainedPct: retainedPct
        };
    }

    function renderPipelineFunnel(pipe) {
        var en = lang() === "en";
        return "<div class=\"dc-pipeline-funnel\">" +
            "<div class=\"dc-funnel-step\"><strong>1 500</strong><span>" +
            (en ? "raw records" : "rekordów surowych") + "</span></div>" +
            "<div class=\"dc-funnel-arrow\">↓ " + pipe.excludedInvalid + " " +
            (en ? "missing / invalid" : "braków / invalid") + "</div>" +
            "<div class=\"dc-funnel-step\"><strong>" + (1500 - pipe.excludedInvalid).toLocaleString("pl-PL") + "</strong><span>" +
            (en ? "after missing handling" : "po obsłudze braków") + "</span></div>" +
            "<div class=\"dc-funnel-arrow\">↓ " + pipe.excludedImplausible + " " +
            (en ? "implausible values" : "wartości mało prawdopodobnych") + "</div>" +
            "<div class=\"dc-funnel-step highlight\"><strong>" + pipe.retained.toLocaleString("pl-PL") + "</strong><span>" +
            (en ? "analysis-ready records" : "rekordów gotowych do analizy") + "</span></div>" +
            "</div>";
    }

    function renderExecutiveSummaryTable() {
        var raw = getRawSnapshot();
        var analysis = getAnalysisSnapshot();
        var en = lang() === "en";
        function row(label, rawVal, analysisVal) {
            return "<tr><td>" + label + "</td><td>" + rawVal.toLocaleString("pl-PL") + "</td>" +
                "<td class=\"dc-cell changed\">" + analysisVal.toLocaleString("pl-PL") + "</td></tr>";
        }
        return "<h3>" + (en ? "Pipeline executive summary" : "Podsumowanie pipeline'u") + "</h3>" +
            "<p class=\"dc-progress-note\">" + (en
                ? "Raw vs analysis set — excluded records remain in lab_results_standardized.csv."
                : "Raw vs zestaw analityczny — wykluczone rekordy pozostają w lab_results_standardized.csv.") +
            "</p>" +
            "<table class=\"dc-table dc-progress-table dc-executive-table\">" +
            "<thead><tr><th>" + (en ? "Problem" : "Problem") + "</th><th>Raw</th><th>" + (en ? "Analysis" : "Analiza") + "</th></tr></thead><tbody>" +
            row(en ? "Missing / invalid test values" : "Braki / invalid wartości", raw.missingTestValues, 0) +
            row(en ? "Sentinel −999" : "Strażnik −999", raw.sentinelRaw, 0) +
            row(en ? "Non-numeric values" : "Wartości nienumeryczne", raw.nonNumeric, 0) +
            row(en ? "Test-name variants" : "Warianty nazw", raw.names, analysis.names) +
            row(en ? "mg/dL records" : "Rekordy mg/dL", raw.mgdl, 0) +
            row(en ? "Range / unit mismatches" : "Niedopas. zakres / jednostka", raw.rangeMismatch, 0) +
            row(en ? "Implausible values" : "Mało prawdopodobne", raw.implausible, 0) +
            row(en ? "Total excluded from analysis" : "Łącznie wykluczone z analizy", raw.missingTestValues + raw.implausible, 0) +
            row(en ? "Records in dataset" : "Rekordy w secie", raw.rows, analysis.rows) +
            "</tbody></table>";
    }

    function analyteOf(name) {
        return NAME_MAP[name] || name;
    }

    function toNumber(v) {
        if (v === "" || v == null || v === "—") return NaN;
        if (String(v).trim().toLowerCase() === "nan") return NaN;
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
                quality_flag: "valid",
                drop: false
            };

            var missingReason = classifyMissingReason(src.test_value);
            var missing = missingReason !== null;
            var missingEmpty = isMissingEmpty(src.test_value);
            var sentinel = isSentinel(src.test_value);
            var numeric = toNumber(src.test_value);
            if (sentinel) numeric = NaN;

            if (level === 0) {
                var raw = String(src.test_value == null ? "" : src.test_value).trim();
                var n0 = Number(raw);
                if (missingEmpty || (Number.isFinite(n0) && n0 < 0 && !sentinel)) {
                    row.flags.value = "invalid";
                } else if (sentinel) {
                    row.flags.value = "invalid";
                } else if (isNonNumeric(src.test_value)) {
                    row.flags.value = "invalid";
                } else if (/\.\d{4,}/.test(raw)) {
                    row.flags.value = "noisy";
                }
                if (isRangeMismatch(src.test_name, src.unit, src.reference_range)) {
                    row.flags.range = "mismatch";
                }
                if (!missing) {
                    var si0 = convertValue(src.test_name, src.test_value, src.unit);
                    if (isOutlier(src.test_name, si0)) {
                        row.flags.value = "outlier";
                        row.implausible = true;
                    }
                }
            }

            if (level >= 1) {
                row.test_value_raw = src.test_value;
                var reason = classifyMissingReason(src.test_value);
                if (reason) {
                    row.missing_reason = reason;
                    row.test_value = "NaN";
                    row.flags.value = "invalid";
                    if (reason === "sentinel_-999") row.quality_flag = "sentinel";
                    else if (reason === "non_numeric") row.quality_flag = "non_numeric";
                    else row.quality_flag = "missing";
                }
            }

            if (level >= 2) {
                row.test_name_raw = src.test_name;
                var mapped = analyteOf(src.test_name);
                if (mapped !== src.test_name) row.flags.name = "changed";
                row.test_name = mapped;
            }

            if (level >= 3 && !missing) {
                var converted = convertValue(src.test_name, src.test_value, src.unit);
                var newUnit = siUnit(src.test_name);
                if (src.unit !== newUnit) row.flags.unit = "changed";
                if (src.unit === "mg/dL") row.flags.value = "changed";
                row.test_value = Number.isFinite(converted) ? converted.toFixed(2) : "NaN";
                row.unit = newUnit;
                if (level < 4 && isRangeMismatch(row.test_name, row.unit, row.reference_range)) {
                    row.flags.range = "mismatch";
                }
            } else if (level >= 3 && missing) {
                row.unit = siUnit(src.test_name);
            }

            if (level >= 4) {
                var newRange = siRange(src.test_name);
                if (src.reference_range !== newRange) row.flags.range = "changed";
                row.reference_range = newRange;
            }

            if (level >= 5) {
                if (row.quality_flag === "valid") {
                    var siVal = missing ? NaN : convertValue(src.test_name, src.test_value, src.unit);
                    if (!missing && isOutlier(src.test_name, siVal)) {
                        row.flags.value = "outlier";
                        row.quality_flag = "implausible_value";
                        row.implausible = true;
                    }
                }
            }

            if (level >= 6) {
                if (row.quality_flag !== "valid") row.drop = true;
            }

            return row;
        });
    }

    function computeNameStats() {
        var rawLabels = {};
        rawRows.forEach(function (r) { rawLabels[r.test_name] = true; });
        var rawCount = Object.keys(rawLabels).length;
        var canonicalCount = Object.keys(NAME_GROUPS).length;
        var variantLabels = 0;
        Object.keys(NAME_GROUPS).forEach(function (canonical) {
            NAME_GROUPS[canonical].forEach(function (variant) {
                if (variant !== canonical) variantLabels += 1;
            });
        });
        var rowsRenamed = 0;
        rawRows.forEach(function (r) {
            if (analyteOf(r.test_name) !== r.test_name) rowsRenamed += 1;
        });
        var reduction = rawCount
            ? ((rawCount - canonicalCount) / rawCount * 100).toLocaleString(lang() === "en" ? "en-US" : "pl-PL", {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1
            })
            : "0";
        return {
            rawLabels: rawCount,
            canonical: canonicalCount,
            variantLabels: variantLabels,
            rowsRenamed: rowsRenamed,
            reduction: reduction
        };
    }

    function renderNameTreeHtml() {
        return Object.keys(NAME_GROUPS).map(function (canonical) {
            var variants = NAME_GROUPS[canonical];
            return "<div class=\"dc-name-tree-group\">" +
                "<p class=\"dc-name-tree-root\">" + canonical + "</p>" +
                "<ul class=\"dc-name-tree-variants\">" +
                variants.map(function (v, i) {
                    var prefix = i === variants.length - 1 ? "└─ " : "├─ ";
                    var isCanonical = v === canonical;
                    return "<li class=\"" + (isCanonical ? "canonical" : "variant") + "\">" +
                        prefix + v +
                        (isCanonical ? " <span class=\"dc-name-tree-tag\">canonical</span>" : "") +
                        "</li>";
                }).join("") +
                "</ul></div>";
        }).join("");
    }

    function lang() {
        return document.documentElement.getAttribute("data-lang") === "en" ? "en" : "pl";
    }

    function updateMetricLabels(currentStep) {
        var en = lang() === "en";
        if (currentStep === 1) {
            document.getElementById("m-rows-label").textContent = en ? "records" : "rekordów";
            document.getElementById("m-names-label").textContent = en ? "empty" : "pustych";
            document.getElementById("m-missing-label").textContent = "not collected";
            document.getElementById("m-outliers-label").textContent = en ? "sentinel −999" : "strażnik −999";
            return;
        }
        if (currentStep === 2) {
            document.getElementById("m-rows-label").textContent = en ? "records" : "rekordów";
            document.getElementById("m-names-label").textContent = en ? "raw labels" : "etykiet surowych";
            document.getElementById("m-missing-label").textContent = en ? "canonical analytes" : "anality kanoniczne";
            document.getElementById("m-outliers-label").textContent = en ? "labels standardized" : "etykiet ustandaryz.";
            return;
        }
        if (currentStep === 3) {
            document.getElementById("m-rows-label").textContent = en ? "records" : "rekordów";
            document.getElementById("m-names-label").textContent = en ? "mg/dL rows remaining" : "wierszy mg/dL";
            document.getElementById("m-missing-label").textContent = en ? "values converted" : "wartości przeliczonych";
            document.getElementById("m-outliers-label").textContent = en ? "range mismatches left" : "niedopas. zakresów";
            return;
        }
        if (currentStep === 5) {
            document.getElementById("m-rows-label").textContent = en ? "records" : "rekordów";
            document.getElementById("m-names-label").textContent = en ? "invalid flagged" : "ozn. invalid";
            document.getElementById("m-missing-label").textContent = en ? "implausible flagged" : "flag. mało prawd.";
            document.getElementById("m-outliers-label").textContent = en ? "still in audit set" : "w secie audytowym";
            return;
        }
        if (currentStep === 6) {
            document.getElementById("m-rows-label").textContent = en ? "raw records" : "rekordów raw";
            document.getElementById("m-names-label").textContent = en ? "analysis records" : "rekordów analiza";
            document.getElementById("m-missing-label").textContent = en ? "invalid in analysis" : "invalid w analizie";
            document.getElementById("m-outliers-label").textContent = en ? "implausible in analysis" : "mało prawd. w analizie";
            return;
        }
        document.getElementById("m-rows-label").textContent = en ? "rows" : "wierszy";
        document.getElementById("m-names-label").textContent = en ? "test names" : "nazw badań";
        if (currentStep === 0) {
            document.getElementById("m-missing-label").textContent = en ? "invalid / missing values" : "invalid / braków";
            document.getElementById("m-outliers-label").textContent = en ? "flagged implausible" : "flag. mało prawd.";
        } else if (currentStep >= 6) {
            document.getElementById("m-missing-label").textContent = en ? "invalid in analysis set" : "invalid w secie analizy";
            document.getElementById("m-outliers-label").textContent = en ? "implausible in analysis set" : "mało prawd. w analizie";
        } else {
            document.getElementById("m-missing-label").textContent = en ? "invalid test values" : "invalid wartości";
            document.getElementById("m-outliers-label").textContent = en ? "flagged implausible" : "flag. mało prawd.";
        }
    }

    function progressRow(label, rawVal, currentVal) {
        return "<tr><td>" + label + "</td><td>" + rawVal.toLocaleString("pl-PL") + "</td>" +
            "<td class=\"dc-cell changed\">" + currentVal.toLocaleString("pl-PL") + "</td></tr>";
    }

    function renderIssuesProgressPanel(currentStep, profile) {
        var raw = getRawSnapshot();
        var en = lang() === "en";
        if (currentStep === 6) {
            var analysis = getAnalysisSnapshot();
            return renderExecutiveSummaryTable();
        }
        var stepLabel = en ? ("After step " + (currentStep + 1)) : ("Po kroku " + (currentStep + 1));
        return "<h3>" + (en ? "Issues remaining in the dataset" : "Problemy pozostałe w secie") + "</h3>" +
            "<p class=\"dc-progress-note\">" + (en
                ? "Counts reflect the current pipeline state — not the original raw file."
                : "Liczniki odzwierciedlają aktualny stan pipeline'u — nie surowy plik.") +
            "</p>" +
            "<table class=\"dc-table dc-progress-table\">" +
            "<thead><tr><th>" + (en ? "Metric" : "Metryka") + "</th><th>Raw</th><th>" + stepLabel + "</th></tr></thead><tbody>" +
            progressRow(en ? "Missing / invalid test values" : "Braki / invalid wartości", raw.missingTestValues, profile.missingTestValues) +
            progressRow(en ? "Sentinel −999 (raw cells)" : "Strażnik −999 (surowe komórki)", raw.sentinelRaw, profile.sentinelRaw) +
            progressRow(en ? "Non-numeric text (e.g. N/A)" : "Tekst nienumeryczny (np. N/A)", raw.nonNumeric, profile.nonNumeric) +
            progressRow(en ? "Test-name variants" : "Warianty nazw badań", raw.names, profile.names) +
            progressRow(en ? "mg/dL rows" : "Wiersze mg/dL", raw.mgdl, profile.mgdl) +
            progressRow(en ? "Range / unit mismatch" : "Niedopas. zakres / jednostka", raw.rangeMismatch, profile.rangeMismatch) +
            progressRow(en ? "Implausible values" : "Mało prawdopodobne", raw.implausible, profile.implausible) +
            "</tbody></table>";
    }

    function renderMetricsSummary(currentStep, profile) {
        var el = document.getElementById("dc-metrics-summary");
        if (!el) return;
        var en = lang() === "en";
        profile = profile || computeQualityProfile(currentStep);
        if (currentStep === 1) {
            var bd = computeMissingBreakdown();
            el.hidden = false;
            el.innerHTML =
                "<p class=\"dc-metrics-total\">" +
                (en ? "Total missing after standardization: " : "Brakujących wyników po standaryzacji: ") +
                "<strong>" + bd.totalStandardized.toLocaleString("pl-PL") + "</strong>" +
                (bd.nonNumeric
                    ? (en
                        ? " · plus " + bd.nonNumeric + " non-numeric (e.g. N/A) also standardised to NaN"
                        : " · plus " + bd.nonNumeric + " nienumerycznych (np. N/A) też ujednoliconych do NaN")
                    : "") +
                "</p>" +
                "<p class=\"dc-metrics-note\">" +
                (en
                    ? "All 1,500 records retained at this step — NaN ≠ delete row."
                    : "Wszystkie 1 500 rekordów zachowane na tym etapie — NaN ≠ usunięcie wiersza.") +
                "</p>";
            return;
        }
        if (currentStep === 2) {
            var ns = computeNameStats();
            el.hidden = false;
            el.innerHTML =
                "<div class=\"dc-metrics-compare\">" +
                "<div><span class=\"dc-metrics-compare-label\">BEFORE</span><strong>" + ns.rawLabels + "</strong> " +
                (en ? "unique labels" : "unikalnych etykiet") + "</div>" +
                "<div class=\"dc-metrics-compare-arrow\">→</div>" +
                "<div><span class=\"dc-metrics-compare-label\">AFTER</span><strong>" + ns.canonical + "</strong> " +
                (en ? "canonical analytes" : "anality kanoniczne") + "</div>" +
                "</div>" +
                "<p class=\"dc-metrics-total\">" +
                (en ? "Reduction in label fragmentation: " : "Redukcja fragmentacji etykiet: ") +
                "<strong>" + ns.reduction + "%</strong>" +
                " · " + ns.rowsRenamed.toLocaleString("pl-PL") + " " +
                (en ? "rows mapped to a canonical label" : "wierszy zmapowanych do etykiety kanonicznej") +
                "</p>";
            return;
        }
        if (currentStep === 3) {
            el.hidden = false;
            el.innerHTML =
                "<p class=\"dc-metrics-note\">" +
                (en
                    ? "Value conversion ≠ full record standardisation. Units are harmonised, but reference ranges may still reflect the original source format."
                    : "Konwersja wartości ≠ pełna standaryzacja rekordu. Jednostki są ujednolicone, ale zakresy referencyjne mogą nadal pochodzić z formatu źródłowego.") +
                "</p>" +
                "<p class=\"dc-metrics-total\">" +
                (en
                    ? "Values are now in consistent units, but <strong>" + profile.rangeMismatch.toLocaleString("pl-PL") + "</strong> reference ranges remain incompatible with those units — resolved in Step 5 (Ranges)."
                    : "Wartości są już w spójnych jednostkach, ale <strong>" + profile.rangeMismatch.toLocaleString("pl-PL") + "</strong> zakresów referencyjnych nadal nie pasuje do tych jednostek — rozwiązane w kroku 5 (Ranges).") +
                "</p>";
            return;
        }
        if (currentStep === 6) {
            var pipe = computePipelineCounts();
            el.hidden = false;
            el.innerHTML =
                renderPipelineFunnel(pipe) +
                "<div class=\"dc-lineage\">" +
                "<div class=\"dc-lineage-step\"><span class=\"label\">RAW</span><strong>1 500</strong><br>lab_results_raw.csv</div>" +
                "<div class=\"dc-lineage-arrow\">→</div>" +
                "<div class=\"dc-lineage-step\"><span class=\"label\">STANDARDIZED / AUDIT</span><strong>1 500</strong><br>lab_results_standardized.csv<br>" +
                "<span class=\"dc-lineage-meta\">quality_flag · missing_reason · names · units</span></div>" +
                "<div class=\"dc-lineage-arrow\">→</div>" +
                "<div class=\"dc-lineage-step highlight\"><span class=\"label\">ANALYSIS</span><strong>" + pipe.retained.toLocaleString("pl-PL") + "</strong><br>lab_results_analysis.csv<br>" +
                "<span class=\"dc-lineage-meta\">" + pipe.retainedPct + "% " + (en ? "retained" : "zachowanych") + "</span></div>" +
                "</div>" +
                "<p class=\"dc-metrics-total\">" +
                (en
                    ? "<strong>1 500 → " + pipe.retained.toLocaleString("pl-PL") + "</strong> analysis-ready records · " + pipe.excludedInvalid + " missing/invalid + " + pipe.excludedImplausible + " implausible excluded from analysis (not deleted from audit set)"
                    : "<strong>1 500 → " + pipe.retained.toLocaleString("pl-PL") + "</strong> rekordów gotowych do analizy · " + pipe.excludedInvalid + " braków/invalid + " + pipe.excludedImplausible + " mało prawdopodobnych wykluczonych z analizy (nie usuniętych z audytu)") +
                "</p>";
            return;
        }
        el.hidden = true;
        el.innerHTML = "";
    }

    function applyStepMetrics(currentStep) {
        var profile = computeQualityProfile(currentStep);
        updateMetricLabels(currentStep);
        if (currentStep === 1) {
            var bd = computeMissingBreakdown();
            document.getElementById("m-rows").textContent = profile.rows.toLocaleString("pl-PL");
            document.getElementById("m-names").textContent = bd.blank;
            document.getElementById("m-missing").textContent = bd.notCollected;
            document.getElementById("m-outliers").textContent = bd.sentinel;
            renderMetricsSummary(currentStep, profile);
            return profile;
        }
        if (currentStep === 2) {
            var ns = computeNameStats();
            document.getElementById("m-rows").textContent = profile.rows.toLocaleString("pl-PL");
            document.getElementById("m-names").textContent = ns.rawLabels;
            document.getElementById("m-missing").textContent = ns.canonical;
            document.getElementById("m-outliers").textContent = ns.variantLabels;
            renderMetricsSummary(currentStep, profile);
            return profile;
        }
        if (currentStep === 3) {
            document.getElementById("m-rows").textContent = profile.rows.toLocaleString("pl-PL");
            document.getElementById("m-names").textContent = profile.mgdl;
            document.getElementById("m-missing").textContent = profile.valuesConverted;
            document.getElementById("m-outliers").textContent = profile.rangeMismatch;
            renderMetricsSummary(currentStep, profile);
            return profile;
        }
        if (currentStep === 5) {
            var std = getStandardizedSnapshot();
            document.getElementById("m-rows").textContent = std.rows.toLocaleString("pl-PL");
            document.getElementById("m-names").textContent = std.missingTestValues;
            document.getElementById("m-missing").textContent = std.implausible;
            document.getElementById("m-outliers").textContent = std.rows.toLocaleString("pl-PL");
            renderMetricsSummary(currentStep, profile);
            return profile;
        }
        if (currentStep === 6) {
            var pipe = computePipelineCounts();
            document.getElementById("m-rows").textContent = pipe.raw.rows.toLocaleString("pl-PL");
            document.getElementById("m-names").textContent = pipe.analysis.rows.toLocaleString("pl-PL");
            document.getElementById("m-missing").textContent = pipe.excludedInvalid + " → 0";
            document.getElementById("m-outliers").textContent = pipe.excludedImplausible + " → 0";
            renderMetricsSummary(currentStep, profile);
            return profile;
        }
        renderMetricsSummary(currentStep, profile);
        document.getElementById("m-rows").textContent = profile.rows.toLocaleString("pl-PL");
        document.getElementById("m-names").textContent = profile.names;
        if (currentStep === 0) {
            document.getElementById("m-missing").textContent = profile.missingTestValues;
            document.getElementById("m-outliers").textContent = profile.implausible;
        } else if (currentStep >= 6) {
            document.getElementById("m-missing").textContent = "0";
            document.getElementById("m-outliers").textContent = "0";
        } else {
            document.getElementById("m-missing").textContent = profile.missingTestValues;
            document.getElementById("m-outliers").textContent = profile.implausible;
        }
        return profile;
    }

    function qualityItem(label, value) {
        var display = typeof value === "number" ? value.toLocaleString("pl-PL") : String(value);
        return "<div class=\"dc-quality-item\"><span>" + label + "</span><strong>" + display + "</strong></div>";
    }

    function renderQualityPanel(currentStep, profile) {
        var panel = document.getElementById("dc-quality-panel");
        if (!panel) return;
        var en = lang() === "en";
        if (currentStep === 1) {
            var bd = computeMissingBreakdown();
            panel.innerHTML =
                "<h3>" + (en ? "Missing-value breakdown" : "Rozbicie brakujących wyników") + "</h3>" +
                "<div class=\"dc-missing-breakdown\">" +
                qualityItem("EMPTY", bd.blank) +
                qualityItem("NOT COLLECTED", bd.notCollected) +
                qualityItem("−999", bd.sentinel) +
                (bd.nullish ? qualityItem("NULL / NaN", bd.nullish) : "") +
                "<div class=\"dc-quality-item dc-quality-total\"><span>TOTAL</span><strong>" + bd.totalStandardized.toLocaleString("pl-PL") + "</strong></div>" +
                (bd.nonNumeric ? qualityItem(en ? "Non-numeric (e.g. N/A)" : "Nienumeryczne (np. N/A)", bd.nonNumeric) : "") +
                "</div>";
            return;
        }
        if (currentStep === 2) {
            panel.innerHTML =
                "<h3>" + (en ? "Canonical name dictionary" : "Słownik nazw kanonicznych") + "</h3>" +
                "<div class=\"dc-name-tree\">" + renderNameTreeHtml() + "</div>" +
                "<p class=\"dc-name-tree-note\">" +
                (en
                    ? "Only semantically equivalent labels are grouped. No fuzzy matching is applied automatically, because similar test names may represent different analytes."
                    : "Grupuję tylko semantycznie równoważne etykiety. Bez automatycznego fuzzy matchingu — podobne nazwy mogą oznaczać różne anality.") +
                "</p>";
            return;
        }
        if (currentStep === 5) {
            panel.innerHTML =
                "<h3>" + (en ? "Validation rules (data quality)" : "Reguły walidacji (jakość danych)") + "</h3>" +
                "<div class=\"dc-validation-rules\">" +
                "<div class=\"dc-validation-rule\"><span class=\"label\">Rule</span><code>Glucose &gt; 40 mmol/L → implausible_value</code></div>" +
                "<div class=\"dc-validation-rule\"><span class=\"label\">Rule</span><code>Cholesterol &gt; 20 mmol/L → implausible_value</code></div>" +
                "<div class=\"dc-validation-rule\"><span class=\"label\">Rule</span><code>HbA1c &lt; 3 or &gt; 20 % → implausible_value</code></div>" +
                "<div class=\"dc-validation-rule\"><span class=\"label\">Rule</span><code>test_value is NaN → missing_value</code></div>" +
                "</div>" +
                "<p class=\"dc-name-tree-note\">" +
                (en
                    ? "<strong>Purpose:</strong> data-quality flag, not clinical diagnosis. Thresholds are conservative bounds for detecting recording errors in this synthetic dataset (e.g. 500 mmol/L glucose)."
                    : "<strong>Cel:</strong> flaga jakości danych, nie diagnoza kliniczna. Progi to konserwatywne granice wykrywania błędów zapisu w tym syntetycznym secie (np. 500 mmol/L glukozy).") +
                "</p>";
            return;
        }
        if (currentStep === 6) {
            panel.innerHTML = renderExecutiveSummaryTable();
            return;
        }
        if (currentStep >= 3) {
            panel.innerHTML = renderIssuesProgressPanel(currentStep, profile);
            return;
        }
        var title = en ? "Issues detected in raw data" : "Problemy wykryte w surowych danych";
        var items = [
            [en ? "Missing / invalid test values" : "Braki / invalid wartości", profile.missingTestValues],
            [en ? "Sentinel −999" : "Strażnik −999", profile.sentinelRaw],
            [en ? "Non-numeric text" : "Tekst nienumeryczny", profile.nonNumeric],
            [en ? "Implausible values" : "Mało prawdopodobne", profile.implausible],
            [en ? "Test-name variants" : "Warianty nazw badań", profile.names],
            [en ? "mg/dL rows" : "Wiersze mg/dL", profile.mgdl],
            [en ? "Range / unit mismatch" : "Niedopas. zakres / jednostka", profile.rangeMismatch]
        ];
        items.push([en ? "Valid records (before cleaning)" : "Poprawne rekordy (przed czyszczeniem)", profile.valid]);
        panel.innerHTML = "<h3>" + title + "</h3><div class=\"dc-quality-grid\">" +
            items.map(function (pair) {
                return qualityItem(pair[0], pair[1]);
            }).join("") +
            "</div>";
    }

    function renderNamesStoryPanel() {
        var panel = document.getElementById("dc-story-panel");
        if (!panel) return;
        var en = lang() === "en";
        var ns = computeNameStats();
        panel.hidden = false;
        panel.innerHTML =
            "<h3>" + (en ? "Problem → transformation → result → impact" : "Problem → transformacja → wynik → wpływ") + "</h3>" +
            "<div class=\"dc-story-flow dc-names-story-flow\">" +
            "<div class=\"dc-story-step\"><span class=\"label\">" + (en ? "Problem" : "Problem") + "</span>" +
            "<strong>" + ns.rawLabels + " " + (en ? "labels" : "etykiet") + "</strong><br>" +
            (en ? "describe 3 real tests" : "opisują 3 badania") + "</div>" +
            "<div class=\"dc-story-arrow\">→</div>" +
            "<div class=\"dc-story-step\"><span class=\"label\">" + (en ? "Transformation" : "Transformacja") + "</span>" +
            (en ? "Canonical name dictionary" : "Słownik nazw kanonicznych") + "<br>" +
            "<span style=\"color:var(--text-muted)\">" + ns.variantLabels + " " + (en ? "variants mapped" : "wariantów zmapowanych") + "</span></div>" +
            "<div class=\"dc-story-arrow\">→</div>" +
            "<div class=\"dc-story-step\"><span class=\"label\">" + (en ? "Result" : "Wynik") + "</span>" +
            "<strong>" + ns.canonical + " " + (en ? "analytes" : "anality") + "</strong><br>" +
            (en ? "consistent labels" : "spójne etykiety") + "</div>" +
            "<div class=\"dc-story-arrow\">→</div>" +
            "<div class=\"dc-story-step\"><span class=\"label\">" + (en ? "Impact" : "Wpływ") + "</span>" +
            (en
                ? "Correct aggregations, cross-hospital comparisons and stable KPIs."
                : "Poprawne agregacje, porównania między szpitalami i stabilne KPI.") +
            "</div></div>";
    }

    function renderMissingStoryPanel() {
        var panel = document.getElementById("dc-story-panel");
        if (!panel) return;
        var en = lang() === "en";
        panel.hidden = false;
        panel.innerHTML =
            "<h3>" + (en ? "Source representations → standardised missing" : "Reprezentacje źródłowe → ujednolicony brak") + "</h3>" +
            "<div class=\"dc-missing-story\">" +
            "<div class=\"dc-missing-story-col\">" +
            "<span class=\"label\">" + (en ? "Source data" : "Dane źródłowe") + "</span>" +
            "<ul class=\"dc-missing-sources\">" +
            "<li><code>\"\"</code></li>" +
            "<li><code>\"not collected\"</code></li>" +
            "<li><code>\"-999\"</code></li>" +
            "<li><code>NULL</code></li>" +
            "</ul></div>" +
            "<div class=\"dc-missing-story-arrow\">" + (en ? "standardise" : "standaryzacja") + "<br>→</div>" +
            "<div class=\"dc-missing-story-col dc-missing-target\">" +
            "<span class=\"label\">" + (en ? "Standardised" : "Ustandaryzowane") + "</span>" +
            "<p class=\"dc-missing-nan\"><code>NaN</code></p>" +
            "<p class=\"dc-missing-why\">" + (en
                ? "Standardizing missing-value representations prevents sentinel values such as −999 from contaminating statistical calculations while preserving the original record and missing_reason."
                : "Ujednolicenie reprezentacji braków zapobiega zanieczyszczaniu statystyk wartościami strażniczymi (np. −999), zachowując oryginalny rekord i missing_reason.") +
            "</p></div></div>";
    }

    function renderStoryPanel() {
        var panel = document.getElementById("dc-story-panel");
        if (!panel) return;
        var en = lang() === "en";
        var glucoseRaw = 132.91942730033406;
        var glucoseSi = glucoseRaw / GLUCOSE_MGDL;
        var cholRaw = 208.94318817997245;
        var cholSi = cholRaw / CHOL_MGDL;
        panel.hidden = false;
        panel.innerHTML =
            "<h3>" + (en ? "Before → transformation → after" : "Przed → transformacja → po") + "</h3>" +
            "<div class=\"dc-unit-examples\">" +
            "<div class=\"dc-unit-example\">" +
            "<div class=\"dc-story-step\"><span class=\"label\">" + (en ? "Problem" : "Problem") + "</span>" +
            "<strong>Glucose</strong><br>" + glucoseRaw.toFixed(1) + " mg/dL</div>" +
            "<div class=\"dc-story-arrow\">↓</div>" +
            "<div class=\"dc-story-step\"><span class=\"label\">" + (en ? "Transformation" : "Transformacja") + "</span>" +
            glucoseRaw.toFixed(1) + " ÷ " + GLUCOSE_MGDL.toFixed(4) + "</div>" +
            "<div class=\"dc-story-arrow\">↓</div>" +
            "<div class=\"dc-story-step\"><span class=\"label\">" + (en ? "Standardised" : "Ustandaryzowane") + "</span>" +
            "<strong>Glucose</strong><br>" + glucoseSi.toFixed(2) + " mmol/L</div>" +
            "</div>" +
            "<div class=\"dc-unit-example\">" +
            "<div class=\"dc-story-step\"><span class=\"label\">" + (en ? "Problem" : "Problem") + "</span>" +
            "<strong>Cholesterol</strong><br>" + cholRaw.toFixed(2) + " mg/dL</div>" +
            "<div class=\"dc-story-arrow\">↓</div>" +
            "<div class=\"dc-story-step\"><span class=\"label\">" + (en ? "Transformation" : "Transformacja") + "</span>" +
            cholRaw.toFixed(2) + " ÷ " + CHOL_MGDL.toFixed(2) + "</div>" +
            "<div class=\"dc-story-arrow\">↓</div>" +
            "<div class=\"dc-story-step\"><span class=\"label\">" + (en ? "Standardised" : "Ustandaryzowane") + "</span>" +
            "<strong>Cholesterol</strong><br>" + cholSi.toFixed(2) + " mmol/L</div>" +
            "</div></div>" +
            "<p class=\"dc-name-tree-note\">" +
            (en
                ? "Each analyte uses its own conversion factor — glucose ÷ 18.0182, cholesterol ÷ 38.67."
                : "Każdy analit ma własny współczynnik — glukoza ÷ 18.0182, cholesterol ÷ 38.67.") +
            "</p>";
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
        var showMissingCols = step === 1;
        var showNameCols = step === 2;
        var preview = [];
        if (step === 1) {
            var withMissing = rows.filter(function (r) { return !r.drop && r.missing_reason; });
            var withoutMissing = rows.filter(function (r) { return !r.drop && !r.missing_reason; });
            preview = withMissing.slice(0, 10).concat(withoutMissing.slice(0, Math.max(0, PREVIEW - Math.min(10, withMissing.length))));
        } else if (step === 2) {
            var renamed = rows.filter(function (r) { return !r.drop && r.flags.name === "changed"; });
            var unchanged = rows.filter(function (r) { return !r.drop && r.flags.name !== "changed"; });
            preview = renamed.slice(0, 10).concat(unchanged.slice(0, Math.max(0, PREVIEW - Math.min(10, renamed.length))));
        } else if (step === 3) {
            var converted = rows.filter(function (r) { return !r.drop && r.flags.unit === "changed"; });
            var notConverted = rows.filter(function (r) { return !r.drop && r.flags.unit !== "changed"; });
            preview = converted.slice(0, 10).concat(notConverted.slice(0, Math.max(0, PREVIEW - Math.min(10, converted.length))));
        } else {
            for (var i = 0; i < rows.length && preview.length < PREVIEW; i++) {
                if (!rows[i].drop) preview.push(rows[i]);
            }
        }
        var html = "<thead><tr>" +
            "<th>hospital</th><th>patient_id</th>";
        if (showNameCols) {
            html += "<th>test_name_raw</th>";
        }
        html += "<th>test_name</th>";
        if (showMissingCols) {
            html += "<th>test_value_raw</th><th>missing_reason</th>";
        }
        html += "<th>test_value</th><th>unit</th><th>reference_range</th><th>collection_date</th>" +
            "</tr></thead><tbody>";
        preview.forEach(function (r) {
            html += "<tr>" +
                "<td>" + r.hospital + "</td>" +
                "<td>" + r.patient_id + "</td>";
            if (showNameCols) {
                html += "<td class=\"dc-cell noisy\">" + (r.test_name_raw || r.test_name) + "</td>";
            }
            html += "<td class=\"" + cellClass(r.flags.name) + "\">" + r.test_name + "</td>";
            if (showMissingCols) {
                var rawDisplay = r.test_value_raw == null ? "" : String(r.test_value_raw);
                if (rawDisplay === "") rawDisplay = "(empty)";
                html += "<td class=\"" + cellClass(r.flags.value) + "\">" + rawDisplay + "</td>" +
                    "<td class=\"dc-cell changed\">" + (r.missing_reason || "—") + "</td>";
            }
            html += "<td class=\"" + cellClass(r.flags.value) + "\">" + r.test_value + "</td>" +
                "<td class=\"" + cellClass(r.flags.unit) + "\">" + r.unit + "</td>" +
                "<td class=\"" + cellClass(r.flags.range) + "\">" + r.reference_range + "</td>" +
                "<td>" + r.collection_date + "</td>" +
                "</tr>";
        });
        html += "</tbody>";
        document.getElementById("dc-table").innerHTML = html;
        var visible = rows.filter(function (r) { return !r.drop; });
        var en = lang() === "en";
        document.getElementById("dc-caption").textContent = step === 1
            ? (en
                ? "Showing " + preview.length + " of " + visible.length + " rows — all records kept; missing values standardised to NaN"
                : "Podgląd " + preview.length + " z " + visible.length + " wierszy — wszystkie rekordy zachowane; braki ujednolicone do NaN")
            : step === 2
                ? (en
                    ? "Showing " + preview.length + " of " + visible.length + " rows — raw label preserved in test_name_raw; canonical name in test_name"
                    : "Podgląd " + preview.length + " z " + visible.length + " wierszy — surowa etykieta w test_name_raw; nazwa kanoniczna w test_name")
                : step === 3
                    ? (en
                        ? "Showing " + preview.length + " of " + visible.length + " rows — converted values in mmol/L; reference_range may still be incompatible"
                        : "Podgląd " + preview.length + " z " + visible.length + " wierszy — wartości w mmol/L; reference_range może nadal być niedopasowany")
                    : (en
                    ? "Showing " + preview.length + " of " + visible.length + " rows"
                    : "Podgląd " + preview.length + " z " + visible.length + " wierszy");
        var profile = applyStepMetrics(step);
        renderQualityPanel(step, profile);
        var storyPanel = document.getElementById("dc-story-panel");
        if (storyPanel) {
            if (STEPS[step] && STEPS[step].missingStory) {
                renderMissingStoryPanel();
            } else if (STEPS[step] && STEPS[step].namesStory) {
                renderNamesStoryPanel();
            } else if (STEPS[step] && STEPS[step].story) {
                renderStoryPanel();
            } else {
                storyPanel.hidden = true;
                storyPanel.innerHTML = "";
            }
        }
    }

    function binIndex(value, edges) {
        for (var i = 0; i < edges.length - 1; i++) {
            if (value >= edges[i] && value < edges[i + 1]) return i;
        }
        return edges.length - 2;
    }

    function median(arr) {
        if (!arr.length) return 0;
        var sorted = arr.slice().sort(function (a, b) { return a - b; });
        var mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    function computeVizData() {
        var cleanRows = process(6).filter(function (r) { return !r.drop; });
        var hospitals = [];
        var hospitalSet = {};
        cleanRows.forEach(function (r) {
            if (!hospitalSet[r.hospital]) {
                hospitalSet[r.hospital] = true;
                hospitals.push(r.hospital);
            }
        });
        hospitals.sort();

        var analytes = ["Glucose", "Cholesterol", "HbA1c"];
        var hospitalMedians = hospitals.map(function (h) {
            var entry = { name: h.replace("Hospital_", ""), full: h };
            analytes.forEach(function (a) {
                var vals = [];
                cleanRows.forEach(function (r) {
                    if (r.hospital !== h || r.test_name !== a) return;
                    var v = Number(r.test_value);
                    if (Number.isFinite(v)) vals.push(v);
                });
                entry[a] = median(vals);
                entry[a + "_n"] = vals.length;
            });
            return entry;
        });

        var outOfRange = { Glucose: 0, Cholesterol: 0, HbA1c: 0 };
        cleanRows.forEach(function (r) {
            var v = Number(r.test_value);
            if (!Number.isFinite(v)) return;
            if (r.test_name === "Glucose" && (v < 3.9 || v > 5.5)) outOfRange.Glucose += 1;
            if (r.test_name === "Cholesterol" && (v < 3.2 || v > 5.2)) outOfRange.Cholesterol += 1;
            if (r.test_name === "HbA1c" && v >= 5.7) outOfRange.HbA1c += 1;
        });

        return {
            cleanCount: cleanRows.length,
            hospitals: hospitals,
            hospitalMedians: hospitalMedians,
            outOfRange: outOfRange,
            analytes: analytes
        };
    }

    function renderViz() {
        var d = computeVizData();
        var en = lang() === "en";
        var hospitalAvgs = computeHospitalGlucoseComparison();
        var maxGlucoseMean = Math.max.apply(null, hospitalAvgs.map(function (h) {
            return Math.max(h.before, h.after);
        }).concat([1]));

        var glucoseCompareHtml = hospitalAvgs.map(function (h) {
            return "<div class=\"dc-dual-bar-row\">" +
                "<span class=\"dc-dual-bar-label\">" + h.name + "</span>" +
                "<div class=\"dc-dual-bars\">" +
                barRow(en ? "Unfiltered" : "Niefiltrowane", h.before, maxGlucoseMean, "#f87171") +
                barRow(en ? "Analysis-ready" : "Analiza", h.after, maxGlucoseMean, "#86efac") +
                "</div></div>";
        }).join("");

        var maxMed = Math.max.apply(null, d.hospitalMedians.map(function (h) {
            return Math.max(h.Glucose, h.Cholesterol, h.HbA1c / 2);
        }).concat([1]));

        var glucoseHtml = d.hospitalMedians.map(function (h) {
            return barRow(h.name, h.Glucose, maxMed, "#86efac");
        }).join("");

        var cholHtml = d.hospitalMedians.map(function (h) {
            return barRow(h.name, h.Cholesterol, maxMed, "#38bdf8");
        }).join("");

        var maxHba1c = Math.max.apply(null, d.hospitalMedians.map(function (h) { return h.HbA1c; }).concat([1]));
        var hba1cHtml = d.hospitalMedians.map(function (h) {
            return barRow(h.name, h.HbA1c, maxHba1c, "#c084fc");
        }).join("");

        var maxOut = Math.max(d.outOfRange.Glucose, d.outOfRange.Cholesterol, d.outOfRange.HbA1c, 1);
        var outOfRangeHtml = d.analytes.map(function (a) {
            return barRow(a, d.outOfRange[a], maxOut, "#fbbf24");
        }).join("");

        document.getElementById("dc-viz").innerHTML =
            "<div class=\"dc-viz-lead\">" +
            "<p class=\"dc-insight-kicker\">" + (en ? "Analysis question" : "Pytanie analityczne") + "</p>" +
            "<p><strong>" + (en ? "How do laboratory results differ between hospitals?" : "Czy wyniki laboratoryjne różnią się między szpitalami?") + "</strong> — " +
            d.cleanCount.toLocaleString("pl-PL") + " " + (en ? "analysis-ready observations after cleaning." : "obserwacji gotowych do analizy po czyszczeniu.") +
            "</p></div>" +
            "<div class=\"dc-viz-grid\">" +
            "<div class=\"dc-chart dc-chart-wide\">" +
            "<h3>" + (en ? "Mean glucose by hospital (mmol/L, SI)" : "Średnia glukoza wg szpitala (mmol/L, SI)") + "</h3>" +
            "<p class=\"dc-chart-note\">" + (en
                ? "Before = standardized & unfiltered (includes implausible). After = analysis-ready only."
                : "Przed = standaryzowane i niefiltrowane (z mało prawdopodobnymi). Po = tylko gotowe do analizy.") +
            "</p>" +
            glucoseCompareHtml +
            "</div>" +
            "<div class=\"dc-chart\">" +
            "<h3>" + (en ? "Median Glucose (mmol/L)" : "Mediana Glucose (mmol/L)") + "</h3>" +
            glucoseHtml +
            "</div>" +
            "<div class=\"dc-chart\">" +
            "<h3>" + (en ? "Median Cholesterol (mmol/L)" : "Mediana Cholesterol (mmol/L)") + "</h3>" +
            cholHtml +
            "</div>" +
            "<div class=\"dc-chart\">" +
            "<h3>" + (en ? "Median HbA1c (%)" : "Mediana HbA1c (%)") + "</h3>" +
            hba1cHtml +
            "</div>" +
            "<div class=\"dc-chart\">" +
            "<h3>" + (en ? "Outside case-study reference range" : "Poza zakresem case study") + "</h3>" +
            outOfRangeHtml +
            "<p class=\"dc-chart-note\">" +
            (en
                ? "Using the case-study reference dictionary from Step 5 — illustrative only, not clinical interpretation."
                : "Na podstawie słownika zakresów z kroku 5 — wyłącznie ilustracyjnie, bez interpretacji klinicznej.") +
            "</p></div></div>";
    }

    function barRow(label, value, max, color) {
        var pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
        return "<div class=\"dc-bar-row\">" +
            "<span class=\"dc-bar-label\">" + label + "</span>" +
            "<div class=\"dc-bar-track\"><div class=\"dc-bar-fill\" style=\"width:" + pct + "%;background:" + color + "\"></div></div>" +
            "<span class=\"dc-bar-value\">" + value.toLocaleString("pl-PL") + "</span>" +
            "</div>";
    }

    function compareBars(label, before, after, max, fmt) {
        var bPct = max > 0 ? Math.max(2, (before / max) * 100) : 0;
        var aPct = max > 0 ? Math.max(2, (after / max) * 100) : 0;
        return "<div class=\"dc-compare-row\">" +
            "<span class=\"dc-bar-label\">" + label + "</span>" +
            "<div class=\"dc-compare-cell\">" +
            "<div class=\"dc-bar-track\"><div class=\"dc-bar-fill\" style=\"width:" + bPct + "%;background:#fbbf24\"></div></div>" +
            "<span class=\"dc-bar-value\">" + fmt(before) + "</span>" +
            "</div>" +
            "<div class=\"dc-compare-cell\">" +
            "<div class=\"dc-bar-track\"><div class=\"dc-bar-fill\" style=\"width:" + aPct + "%;background:#86efac\"></div></div>" +
            "<span class=\"dc-bar-value\">" + fmt(after) + "</span>" +
            "</div>" +
            "</div>";
    }

    function fmtNum(n, digits) {
        return n.toLocaleString(lang() === "en" ? "en-US" : "pl-PL", {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits
        });
    }

    function computeHospitalGlucoseComparison() {
        var standardizedRows = process(5);
        var cleanRows = process(6).filter(function (r) { return !r.drop; });
        var hospitals = ["Hospital_A", "Hospital_B", "Hospital_C"];
        return hospitals.map(function (h) {
            var beforeVals = [];
            var afterVals = [];
            standardizedRows.forEach(function (r) {
                if (r.hospital !== h || r.test_name !== "Glucose") return;
                if (r.quality_flag !== "valid" && r.quality_flag !== "implausible_value") return;
                var v = Number(r.test_value);
                if (Number.isFinite(v)) beforeVals.push(v);
            });
            cleanRows.forEach(function (r) {
                if (r.hospital !== h || r.test_name !== "Glucose") return;
                var v = Number(r.test_value);
                if (Number.isFinite(v)) afterVals.push(v);
            });
            function avg(arr) {
                if (!arr.length) return 0;
                return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
            }
            return {
                name: h.replace("Hospital_", ""),
                before: avg(beforeVals),
                after: avg(afterVals)
            };
        });
    }

    function renderPortfolioSummary(pipe) {
        var raw = pipe.raw;
        var analysis = pipe.analysis;
        var en = lang() === "en";
        function card(stat, label) {
            return "<div class=\"dc-portfolio-kpi\"><strong>" + stat + "</strong><span>" + label + "</span></div>";
        }
        return "<div class=\"dc-portfolio-summary\">" +
            "<h3>" + (en ? "Project outcome" : "Wynik projektu") + "</h3>" +
            "<div class=\"dc-portfolio-kpi-grid\">" +
            card("1 500", en ? "RAW RECORDS" : "REKORDÓW RAW") +
            card(pipe.excludedTotal.toLocaleString("pl-PL"), en ? "RECORDS EXCLUDED FROM ANALYSIS" : "REKORDÓW WYKLUCZONYCH Z ANALIZY") +
            card(pipe.retainedPct + "%", en ? "DATA RETAINED" : "DANYCH ZACHOWANYCH") +
            card(raw.names + " → " + analysis.names, en ? "TEST LABELS STANDARDIZED" : "ETYKIET BADAŃ USTANDARYZOWANYCH") +
            card(raw.mgdl + " → 0", en ? "MIXED-UNIT RECORDS" : "REKORDÓW MIESZANYCH JEDNOSTEK") +
            card(raw.rangeMismatch + " → 0", en ? "RANGE / UNIT MISMATCHES" : "NIEDOPAS. ZAKRES / JEDNOSTKA") +
            card(raw.implausible + " → 0", en ? "FLAGGED IMPLAUSIBLE VALUES" : "FLAG. WARTOŚCI MAŁO PRAWD.") +
            "</div>" +
            "<p class=\"dc-portfolio-result\">" + (en
                ? "Result: " + pipe.retained.toLocaleString("pl-PL") + " analysis-ready laboratory records with standardized analytes, units and reference-range representation."
                : "Rezultat: " + pipe.retained.toLocaleString("pl-PL") + " rekordów laboratoryjnych gotowych do analizy ze standaryzowanymi analitymi, jednostkami i reprezentacją zakresów referencyjnych.") +
            "</p></div>";
    }

    function hospitalByName(avgs, letter) {
        for (var i = 0; i < avgs.length; i++) {
            if (avgs[i].name === letter) return avgs[i];
        }
        return { name: letter, before: 0, after: 0 };
    }

    function renderInsights() {
        var pipe = computePipelineCounts();
        var raw = pipe.raw;
        var analysis = pipe.analysis;
        var en = lang() === "en";
        var hospitalAvgs = computeHospitalGlucoseComparison();
        var a = hospitalByName(hospitalAvgs, "A");
        var b = hospitalByName(hospitalAvgs, "B");
        var c = hospitalByName(hospitalAvgs, "C");

        function hospitalRow(h) {
            return "<tr>" +
                "<td>Hospital_" + h.name + "</td>" +
                "<td class=\"dc-cell invalid\">" + fmtNum(h.before, 2) + "</td>" +
                "<td class=\"dc-cell changed\">" + fmtNum(h.after, 2) + "</td>" +
                "</tr>";
        }

        function summaryRow(metric, before, after) {
            return "<tr><td>" + metric + "</td><td>" + before + "</td><td class=\"dc-cell changed\">" + after + "</td></tr>";
        }

        var nameMapHtml =
            "<div class=\"dc-name-map\">" +
            "<div class=\"dc-name-map-group\"><h4>GLUCOSE</h4><ul>" +
            "<li>Blood Sugar</li><li>Fasting Glucose</li><li>Glucose</li></ul></div>" +
            "<div class=\"dc-name-map-group\"><h4>CHOLESTEROL</h4><ul>" +
            "<li>Serum Cholesterol</li><li>Total Chol</li><li>Cholesterol</li></ul></div>" +
            "<div class=\"dc-name-map-group\"><h4>HBA1C</h4><ul>" +
            "<li>HbA1c</li><li>Hemoglobin A1c</li><li>Glycated Hemoglobin</li></ul></div>" +
            "</div>";

        document.getElementById("dc-insights").innerHTML =
            "<div class=\"dc-false-signal\">" +
            "<p class=\"dc-insight-kicker\">FALSE SIGNAL REMOVED</p>" +
            "<div class=\"dc-false-signal-grid\">" +
            "<div class=\"dc-false-signal-block\">" +
            "<span class=\"dc-false-signal-label\">" + (en ? "Standardized, unfiltered" : "Standaryzowane, niefiltrowane") + "</span>" +
            "<strong>Hospital B: " + fmtNum(b.before, 2) + " mmol/L</strong>" +
            "</div>" +
            "<div class=\"dc-false-signal-arrow\">→</div>" +
            "<div class=\"dc-false-signal-block highlight\">" +
            "<span class=\"dc-false-signal-label\">" + (en ? "Analysis-ready" : "Gotowe do analizy") + "</span>" +
            "<strong>Hospital B: " + fmtNum(b.after, 2) + " mmol/L</strong>" +
            "</div>" +
            "</div>" +
            "<p class=\"dc-false-signal-compare\">" + (en ? "After cleaning — A " : "Po czyszczeniu — A ") +
            fmtNum(a.after, 2) + " | B " + fmtNum(b.after, 2) + " | C " + fmtNum(c.after, 2) + " mmol/L</p>" +
            "<p class=\"dc-false-signal-note\">" + (en
                ? "Without data-quality controls, a handful of implausible records would have produced a misleading cross-hospital comparison."
                : "Bez kontroli jakości danych kilka mało prawdopodobnych rekordów dałoby mylące porównanie między szpitalami.") +
            "</p></div>" +
            "<div class=\"dc-insight-lead\">" +
            "<p class=\"dc-insight-kicker\">" + (en ? "Business problem" : "Problem biznesowy") + "</p>" +
            "<p>" + (en
                ? "<strong>Before validation:</strong> Hospital_B looked like an operational outlier at <strong>" + fmtNum(b.before, 2) + " mmol/L</strong> mean glucose — after SI standardisation but still including implausible values."
                : "<strong>Przed walidacją:</strong> Hospital_B wyglądał na outlier operacyjny ze średnią glukozy <strong>" + fmtNum(b.before, 2) + " mmol/L</strong> — po standaryzacji SI, ale z wartościami mało prawdopodobnymi.") +
            "</p>" +
            "<p>" + (en
                ? "<strong>After validation:</strong> excluding seven implausible records brings all three hospitals to comparable means — <strong>" + fmtNum(a.after, 2) + " / " + fmtNum(b.after, 2) + " / " + fmtNum(c.after, 2) + " mmol/L</strong> — not a false crisis."
                : "<strong>Po walidacji:</strong> wykluczenie siedmiu mało prawdopodobnych rekordów sprowadza trzy szpitale do porównywalnych średnich — <strong>" + fmtNum(a.after, 2) + " / " + fmtNum(b.after, 2) + " / " + fmtNum(c.after, 2) + " mmol/L</strong> — bez fałszywego kryzysu.") +
            "</p>" +
            "</div>" +
            "<div class=\"dc-table-wrap dc-insight-table-wrap\">" +
            renderExecutiveSummaryTable() +
            "</div>" +
            renderPipelineFunnel(pipe) +
            "<div class=\"dc-lineage dc-lineage-insight\">" +
            "<div class=\"dc-lineage-step\"><span class=\"label\">RAW</span><strong>1 500</strong></div>" +
            "<div class=\"dc-lineage-arrow\">→</div>" +
            "<div class=\"dc-lineage-step\"><span class=\"label\">STANDARDIZED</span><strong>1 500</strong></div>" +
            "<div class=\"dc-lineage-arrow\">→</div>" +
            "<div class=\"dc-lineage-step highlight\"><span class=\"label\">ANALYSIS</span><strong>" + analysis.rows.toLocaleString("pl-PL") + "</strong><br><span class=\"dc-lineage-meta\">" + pipe.retainedPct + "%</span></div>" +
            "</div>" +
            "<div class=\"dc-insight-section\">" +
            "<h3 style=\"margin:0 0 0.35rem;font-size:0.9rem\">" + (en ? "9 variants → 3 standardized analytes" : "9 wariantów → 3 ustandaryzowane anality") + "</h3>" +
            nameMapHtml +
            "</div>" +
            "<div class=\"dc-table-wrap dc-insight-table-wrap\">" +
            "<h3 style=\"margin:0 0 0.75rem;font-size:0.9rem\">" + (en ? "Mean glucose by hospital (mmol/L, SI)" : "Średnia glukoza wg szpitala (mmol/L, SI)") + "</h3>" +
            "<table class=\"dc-table\">" +
            "<thead><tr>" +
            "<th>hospital</th>" +
            "<th>" + (en ? "Standardized, unfiltered" : "Standaryzowane, niefiltrowane") + "</th>" +
            "<th>" + (en ? "Analysis-ready" : "Gotowe do analizy") + "</th>" +
            "</tr></thead><tbody>" +
            hospitalRow(a) + hospitalRow(b) + hospitalRow(c) +
            "</tbody></table>" +
            "</div>" +
            "<div class=\"dc-insight-grid\">" +
            "<article class=\"dc-insight-card\">" +
            "<p class=\"dc-insight-stat\">" + pipe.excludedInvalid + " → 0 <span>· " + pipe.excludedImplausible + " → 0</span></p>" +
            "<h3>" + (en ? "Excluded from analysis, not deleted" : "Wykluczone z analizy, nie usunięte") + "</h3>" +
            "<p>" + (en
                ? "101 missing/invalid and 7 implausible records remain in lab_results_standardized.csv with quality_flag — excluded only from lab_results_analysis.csv."
                : "101 braków/invalid i 7 mało prawdopodobnych pozostaje w lab_results_standardized.csv z quality_flag — wykluczone tylko z lab_results_analysis.csv.") +
            "</p>" +
            "</article>" +
            "<article class=\"dc-insight-card\">" +
            "<p class=\"dc-insight-stat\">" + raw.names + " → " + analysis.names + "</p>" +
            "<h3>" + (en ? "Labels, not tests" : "Etykiety, nie badania") + "</h3>" +
            "<p>" + (en
                ? "Nine names collapse into three analytes. Without a dictionary, glucose would be counted as three separate tests."
                : "Dziewięć nazw sprowadza się do trzech anality. Bez słownika glukoza liczyłaby się jako trzy osobne badania.") +
            "</p>" +
            "</article>" +
            "<article class=\"dc-insight-card\">" +
            "<p class=\"dc-insight-stat\">500 / 1860</p>" +
            "<h3>" + (en ? "500 / 1860 mmol/L — values requiring validation" : "500 / 1860 mmol/L — wartości wymagające walidacji") + "</h3>" +
            "<p>" + (en
                ? "Values of 500 and 1860 mmol/L glucose were flagged as extremely implausible. The pipeline does not delete them automatically: they receive a quality_flag first, and only the analytical dataset excludes them. Detection ≠ deletion."
                : "Wartości 500 i 1860 mmol/L glukozy zostały oznaczone jako skrajnie mało prawdopodobne. Pipeline ich nie usuwa automatycznie: najpierw otrzymują quality_flag, a dopiero zestaw analityczny je wyklucza. Detection ≠ deletion.") +
            "</p>" +
            "<p>" + (en
                ? "After filtering, seven extreme 50+ mmol/L observations disappear — they had strongly distorted the means; nearly all remaining mass sits below 10 mmol/L."
                : "Po filtrowaniu znika siedem ekstremalnych obserwacji 50+ mmol/L, które wcześniej silnie zniekształcały średnie; niemal cała masa pozostaje poniżej 10 mmol/L.") +
            "</p>" +
            "</article>" +
            "</div>" +
            renderPortfolioSummary(pipe);
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

        var isViz = !!meta.visualize;
        var isInsights = !!meta.insights;
        document.getElementById("dc-viz").hidden = !isViz;
        document.getElementById("dc-insights").hidden = !isInsights;
        document.getElementById("dc-data-view").hidden = isViz || isInsights;
        document.getElementById("dc-code-wrap").hidden = isInsights;

        if (isViz) {
            renderViz();
        } else if (isInsights) {
            renderInsights();
        } else {
            renderTable(process(step));
        }
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
