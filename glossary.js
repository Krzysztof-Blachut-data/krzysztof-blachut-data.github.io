(function (global) {
    var GLOSSARY = {
        sentinel: {
            pl: "Umowny kod (tu −999) wpisywany zamiast braku wyniku. To nie jest prawdziwa wartość laboratoryjna — gdyby liczyć go jak liczbę, zniekształciłby średnie.",
            en: "A placeholder code (here −999) stored instead of a missing result. It is not a real lab value — treating it as a number would distort averages."
        },
        sentinel_price: {
            pl: "Umowny kod (tu −100) wpisywany zamiast brakującej lub błędnej ceny. To nie jest prawdziwa cena produktu.",
            en: "A placeholder code (here −100) stored instead of a missing or invalid price. It is not a real product price."
        },
        missing_invalid: {
            pl: "Wynik niedostępny do analizy: pusta komórka, „not collected”, strażnik −999 albo tekst nienumeryczny (np. N/A). Razem 101 rekordów.",
            en: "A result that cannot be analysed: blank cell, “not collected”, sentinel −999, or non-numeric text (e.g. N/A). 101 records in total."
        },
        implausible: {
            pl: "Wartość liczbowa, ale skrajnie mało prawdopodobna (np. 500 mmol/L glukozy). Najpierw ją oznaczam, a z analizy wykluczam później.",
            en: "A numeric value that is extremely unlikely (e.g. 500 mmol/L glucose). The pipeline flags it first; only the analysis set excludes it."
        },
        non_numeric: {
            pl: "Tekst w kolumnie, która powinna być liczbą — np. N/A. Standaryzuję do NaN, rekordu nie usuwam.",
            en: "Text in a column that should be numeric — e.g. N/A. Standardised to NaN; the row is not deleted."
        },
        empty: {
            pl: "Pusta komórka: wynik w ogóle nie został zapisany.",
            en: "An empty cell: no result was recorded at all."
        },
        not_collected: {
            pl: "Jawny komunikat systemu źródłowego, że badania nie pobrano. To też brak, tylko zapisany jako tekst.",
            en: "An explicit source-system message that the test was not collected. Also missing, just stored as text."
        },
        nan: {
            pl: "Oznaczenie braku po czyszczeniu. Oznaczenie wartości jako brakującej nie usuwa całego rekordu.",
            en: "Not a Number — the standardised missing-value representation after cleaning. NaN ≠ deleting the row."
        },
        range_mismatch: {
            pl: "Zakres referencyjny nie pasuje do jednostki wyniku — np. 70–99 przy mmol/L albo 3.9–5.5 przy mg/dL.",
            en: "The reference range does not match the result unit — e.g. 70–99 with mmol/L, or 3.9–5.5 with mg/dL."
        },
        canonical: {
            pl: "Jedna uzgodniona nazwa badania po przypisaniu wariantów (np. Blood Sugar, Fasting Glucose → Glucose).",
            en: "One agreed analyte name after mapping variants (e.g. Blood Sugar, Fasting Glucose → Glucose)."
        },
        quality_flag: {
            pl: "Oznaczenie jakości rekordu. Samo oznaczenie nie usuwa wiersza z pełnego pliku.",
            en: "A record-level quality marker (valid, missing, implausible_value). Detection ≠ deletion: the flag does not remove the row from the audit set."
        },
        analysis_ready: {
            pl: "Zbiór przeznaczony do analizy: tylko rekordy oznaczone jako poprawne. Dane źródłowe i ujednolicone zostają osobno.",
            en: "The analysis set: only records with quality_flag = valid. Raw and standardised data are kept separately for audit."
        },
        duplicate: {
            pl: "Ten sam customer_id w więcej niż jednym wierszu CRM — zwykle inna pisownia imienia. Ziarno analityczne liczy unikalnych klientów, nie wiersze.",
            en: "The same customer_id in more than one CRM row — often a spelling variant. The analytical grain counts unique customers, not rows."
        },
        anonymous: {
            pl: "Zdarzenie clickstream bez customer_id. Zachowuję je, ale osobno — join jako zidentyfikowane zawyżyłby konwersję.",
            en: "A clickstream event with no customer_id. Kept, but separately — joining it as identified would overstate conversion."
        },
        grain: {
            pl: "Poziom, na którym liczymy KPI. Tu: unikalny klient, nie wiersz CRM. 50 000 wierszy ≠ 50 000 klientów.",
            en: "The level at which KPIs are counted. Here: unique customer, not CRM row. 50,000 rows ≠ 50,000 customers."
        }
    };

    function escapeAttr(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;");
    }

    function currentLang() {
        return document.documentElement.getAttribute("data-lang") === "en" ? "en" : "pl";
    }

    function term(key, text) {
        var entry = GLOSSARY[key];
        if (!entry || !text) return text || "";
        var tip = entry[currentLang()] || entry.pl;
        return "<span class=\"dc-term\" tabindex=\"0\" data-tip=\"" + escapeAttr(tip) + "\">" + text + "</span>";
    }

    global.DQ_GLOSSARY = GLOSSARY;
    global.dqTerm = term;
})(window);
