(function () {
    if (!document.getElementById("ecom-table")) return;

    var PREVIEW = window.ECOM_PREVIEW || {};
    var T = (window.ECOM_STATS && window.ECOM_STATS.totals) || {};

    var CAT_MAP = {
        clothing: "clothing", clo: "clothing", "clothing-": "clothing",
        electronics: "electronics", ele: "electronics", "3l3ctronics": "electronics", electronics_: "electronics",
        kitchen: "kitchen", kit: "kitchen", kitch3n: "kitchen",
        beauty: "beauty", bea: "beauty", b3auty: "beauty",
        automotive: "automotive", automotiv3: "automotive",
        toys: "toys", sports: "sports",
        home: "home", hom: "home", hom3: "home", home_: "home"
    };

    var STEPS = [
        {
            titlePl: "Pięć brudnych eksportów, jeden sklep",
            titleEn: "Five dirty exports, one shop",
            bodyPl: "CRM, katalog, zamówienia, tickety i clickstream nie zgadzają się w słownikach, datach i tożsamości. Poniżej wycinek problemów z każdej tabeli. KPI na pełnym secie: 880 500 wierszy.",
            bodyEn: "CRM, catalog, orders, tickets and clickstream disagree on dictionaries, dates and identity. Below is a slice of issues from each table. KPIs are from the full set: 880,500 rows.",
            table: "landscape",
            code: "crm = pd.read_csv(\"crm_50000_customers_dirty_v3.csv\")\norders = pd.read_csv(\"orders_300k_dirty.csv\")\ncatalog = pd.read_csv(\"product_catalog_dirty_30pct.csv\")\ntickets = pd.read_csv(\"support_tickets_30000_dirty.csv\")\nclick = pd.read_csv(\"clickstream_500k_events.csv\")\nprint(len(crm), crm[\"customer_id\"].nunique(), orders[\"status\"].nunique())"
        },
        {
            titlePl: "Tożsamość w CRM",
            titleEn: "CRM identity",
            bodyPl: "50 000 wierszy, ale tylko 48 200 unikalnych ID. To 1 800 duplikatów (ten sam klient, inna pisownia). Imiona jak mARIA i KKeevvin, spacje w nazwisku, 1 040 pustych e-maili. Deduplikacja po customer_id i Title Case.",
            bodyEn: "50,000 rows but only 48,200 unique IDs. That is 1,800 duplicates (same customer, different spelling). Names like mARIA and KKeevvin, padded surnames, 1,040 blank emails. Dedupe on customer_id and Title Case.",
            table: "crm",
            code: "crm[\"first_name\"] = crm[\"first_name\"].str.trim().str.replace(r\"(.)\\1+\", r\"\\1\", regex=True).str.title()\ncrm[\"last_name\"] = crm[\"last_name\"].str.strip().str.title()\ncrm[\"email\"] = crm[\"email\"].replace(\"\", np.nan)\ncrm = crm.drop_duplicates(\"customer_id\", keep=\"first\")"
        },
        {
            titlePl: "Katalog: kategorie i ceny",
            titleEn: "Catalog: categories and prices",
            bodyPl: "46 zapisów kategorii na 8 działów (clo, 3l3ctronics, hom3, clothing_) plus 30 pustych. Zamiast słownika literówek używam reguł: wielkość liter, interpunkcja, leetspeak, unikalny prefiks. Każda reguła jest zliczana, więc widać, jak naprawiono każdy wiersz. Ceny jako tekst „1,200”, strażnik −100 i zera → 71 cen nie do użycia.",
            bodyEn: "46 category spellings for 8 departments (clo, 3l3ctronics, hom3, clothing_) plus 30 blanks. Instead of a table of misspellings I use ordered rules: casing, punctuation, leetspeak, unique prefix. Every rule is counted, so it is visible how each row was resolved. Prices as text “1,200”, sentinel −100 and zeros → 71 unusable prices.",
            table: "catalog",
            code: "# ordered rules, not a lookup table of every misspelling\nnorm = Normaliser(CATEGORIES)   # clothing, kitchen, beauty, automotive, toys, sports, home, electronics\ncatalog[\"category\"] = catalog[\"category\"].map(norm)\nprint(norm.report())  # {'exact': 362, 'case_or_padding': 46, 'leet': 23, 'punctuation': 17, 'prefix': 22, 'missing': 30}\nassert norm.rules[\"unresolved\"] == 0  # nothing was silently dropped\n\nprice = pd.to_numeric(catalog[\"price\"].str.replace(\",\", \"\"), errors=\"coerce\")\ncatalog[\"price\"] = price.mask(price.isin(PRICE_SENTINELS) | (price <= 0))"
        },
        {
            titlePl: "Zamówienia: słowniki, kwoty, daty",
            titleEn: "Orders: dictionaries, amounts, dates",
            bodyPl: "10 statusów → success / refunded / failed. 11 metod płatności → card, wallet, upi, cash (CRAD, c@rd, wall-et). Najważniejsza decyzja dotyczy dat: 54 074 nie parsuje się jako ISO, ale 36 160 z nich to poprawne daty w innym układzie — 2024/31/01 to rok/dzień/miesiąc, 31-12-2023 to dzień-miesiąc-rok. Uznanie ich za zepsute wyrzuciłoby 12% zamówień. Naprawdę brakuje 17 914.",
            bodyEn: "10 statuses → success / refunded / failed. 11 payment methods → card, wallet, upi, cash (CRAD, c@rd, wall-et). The key decision is about dates: 54,074 fail ISO parsing, but 36,160 of those are valid dates in another layout — 2024/31/01 is year/day/month, 31-12-2023 is day-month-year. Treating them as corrupt would discard 12% of the order book. Only 17,914 are genuinely absent.",
            table: "orders",
            code: "orders[\"status\"] = orders[\"status\"].map(Normaliser(STATUSES))         # 10 -> 3\norders[\"payment_method\"] = orders[\"payment_method\"].map(Normaliser(PAYMENTS))  # 11 -> 4\n\n# ISO first, then the layouts this export actually uses\nparsed = pd.to_datetime(text, format=\"ISO8601\", errors=\"coerce\")   # 245,926\nfor fmt in (\"%Y/%d/%m\", \"%d-%m-%Y\"):\n    todo = parsed.isna() & text.notna()\n    parsed.loc[todo] = pd.to_datetime(text[todo], format=fmt, errors=\"coerce\")\n# rescued 36,160 — 18,110 as %Y/%d/%m and 18,050 as %d-%m-%Y\n\n# a row is analysable only if amount, quantity, date and status all survived\norders[\"is_analysable\"] = (amount.notna() & qty.notna() & parsed.notna() & status.notna())\n# 186,928 analysable, 113,072 quarantined — quarantined, not deleted"
        },
        {
            titlePl: "Tickety: odwrócone etykiety i niemożliwe godziny",
            titleEn: "Tickets: reversed labels and impossible hours",
            bodyPl: "35 typów zgłoszeń i 18 sentymentów. tnemyap to payment wspak, dnufer to refund, n3gativ3 to leetspeak — reguła odwrócenia i leetspeak łapią je bez wypisywania każdego wariantu. Timestamp 2025-12-12T28:77:10 nie istnieje i nie da się go naprawić, więc zostaje brakiem. 2 677 zgłoszeń ma czas zamknięcia przed otwarciem, a 2 905 ma podaną długość obsługi sprzeczną ze znacznikami — ufam znacznikom i oznaczam konflikt.",
            bodyEn: "35 issue types and 18 sentiments. tnemyap is payment reversed, dnufer is refund, n3gativ3 is leetspeak — the reversal and leet rules catch these without listing every variant. Timestamp 2025-12-12T28:77:10 does not exist and cannot be repaired, so it stays missing. 2,677 tickets are resolved before they were created, and 2,905 state a duration that contradicts their timestamps — I trust the timestamps and flag the conflict.",
            table: "tickets",
            code: "tickets[\"issue_type\"] = tickets[\"issue_type\"].map(Normaliser(ISSUES))      # 35 -> 4\ntickets[\"sentiment\"] = tickets[\"sentiment\"].map(Normaliser(SENTIMENTS))     # 18 -> 3\n\n# a reversed timeline cannot be repaired: either timestamp may be the wrong one\nreversed_pair = tickets[\"ticket_resolved\"] < tickets[\"ticket_created\"]\ntickets.loc[reversed_pair, \"timeline_flag\"] = \"resolved_before_created\"  # 2,677\n\n# where the stated duration disagrees with the timestamps, recompute from timestamps\nmeasured = (tickets[\"ticket_resolved\"] - tickets[\"ticket_created\"]).dt.total_seconds() / 3600\ntickets[\"resolution_hours\"] = measured.where(measured >= 0, stated)"
        },
        {
            titlePl: "Clickstream: dwa klucze, które nie są kluczami",
            titleEn: "Clickstream: two keys that are not keys",
            bodyPl: "150 553 z 500 000 zdarzeń nie ma customer_id. Zanim policzyłem lejek, sprawdziłem klucze — i oba zawiodły. Wszystkie 8 000 session_id obejmują wielu klientów naraz, więc grupowanie po sesji jest bezsensowne (lejek wychodził 100%). device_id ma 498 949 wartości na 500 000 zdarzeń i żadna nie występuje w CRM, więc anonimowych zdarzeń nie da się przypisać przez urządzenie. Zostaje customer_id — konwersję liczę na klienta i podaję zakres: 349 447 zdarzeń rozpoznanych, 150 553 nie.",
            bodyEn: "150,553 of 500,000 events have no customer_id. Before computing a funnel I tested the keys — and both failed. All 8,000 session_ids span several customers, so grouping by session is meaningless (the funnel came out at 100%). device_id has 498,949 values across 500,000 events and none appear in CRM, so anonymous events cannot be attributed by device. That leaves customer_id — conversion is measured per customer, with the scope stated: 349,447 events identified, 150,553 not.",
            table: "clickstream",
            code: "# never group by a column before checking it behaves like a key\nper_session = click.dropna(subset=[\"customer_id\"]).groupby(\"session_id\")[\"customer_id\"].nunique()\nassert (per_session > 1).sum() == 0, \"session_id spans several customers\"\n# AssertionError: 8000 of 8000 -> no session-level funnel is permissible\n\ncrm_devices = set(crm[\"device_id(s)\"].str.split(\";\").explode().str.strip())  # 51,854\nassert click[\"device_id\"].isin(crm_devices).any(), \"device_id does not join to CRM\"\n# AssertionError: 0 of 498,949 match -> anonymous events stay unattributable\n\n# so aggregate on the one key that holds up\nvisitors = click.dropna(subset=[\"customer_id\"]).groupby(\"customer_id\").agg(\n    carted=(\"event_type\", lambda s: int((s == \"add_to_cart\").any())))"
        },
        {
            titlePl: "Zestaw gotowy do joinów",
            titleEn: "Join-ready dataset",
            bodyPl: "Po słownikach i deduplikacji tabele schodzą się po customer_id i product_id — zamówienia, tickety i rozpoznane zdarzenia mają zero sierot względem CRM. To sprawdzam, nie zakładam. CRM: 50 000 → 48 200 unikalnych klientów (1 800 duplikatów wykluczonych ze ziarna analitycznego, nie usuniętych z audytu). Przychód liczę tylko na 137 804 udanych zamówieniach z 186 928 analizowalnych.",
            bodyEn: "After dictionaries and dedupe the tables meet on customer_id and product_id — orders, tickets and identified events all have zero orphans against CRM. That is verified, not assumed. CRM: 50,000 → 48,200 unique customers (1,800 duplicates excluded from the analytical grain, not deleted from audit). Revenue uses only the 137,804 successful orders out of 186,928 analysable ones.",
            table: "joined",
            cleanStory: true,
            code: "crm.to_csv(\"crm_standardized.csv\", index=False)  # 50,000 rows — audit trail\n\ncrm_analysis = crm.drop_duplicates(\"customer_id\", keep=\"first\")  # 48,200\n\nfact = orders.merge(crm_analysis, on=\"customer_id\", how=\"left\")\nfact = fact.merge(catalog[[\"product_id\",\"category\",\"price\"]], on=\"product_id\", how=\"left\")\nfact = fact.loc[fact[\"order_amount\"].notna() & fact[\"status\"].eq(\"success\")]"
        },
        {
            titlePl: "Analiza GMV i miksu płatności",
            titleEn: "GMV and payment-mix analysis",
            bodyPl: "Po ujednoliceniu pięciu plików: jak rozkłada się sprzedaż po kategoriach i jaki jest miks płatności na udanych zamówieniach? Wyniki na secie gotowym do joinów — nie na surowych 11 metodach płatności ani 46 zapisach kategorii. Uwaga: kwoty w tych plikach są wygenerowane i bez waluty, więc struktura jest miarodajna, a same poziomy nie.",
            bodyEn: "After harmonising five files: how does revenue split by category, and what is the payment mix on successful orders? Results on the join-ready set — not on the raw 11 payment methods or 46 category spellings. Note: the amounts in these files are generated and carry no currency, so the structure is meaningful but the levels are not.",
            visualize: true,
            code: "raw_payment_count = orders[\"payment_method\"].nunique()  # 11\nanalysis = fact.loc[fact[\"status\"].eq(\"success\")]\nclean_payment_count = analysis[\"payment_method\"].nunique()  # 4\n\nanalysis.groupby(\"category\")[\"order_amount\"].sum().sort_values(ascending=False)\nanalysis.groupby(\"payment_method\")[\"order_id\"].count()"
        },
        {
            titlePl: "Wnioski z oczyszczonych danych",
            titleEn: "What the cleaned data actually says",
            bodyPl: "To nie jest jeden brudny plik. Pięć systemów musi najpierw współdzielić klucze i słowniki. Inaczej KPI sklepu liczą się na zdublowanych klientach, 11 metodach płatności i lejku bez 30% zdarzeń. Najcenniejszy wynik jest negatywny: dwie kolumny wyglądające na klucze nimi nie są, więc lejka po sesjach nie policzyłem. Wolę nie podawać liczby, która wygląda dobrze i nic nie znaczy.",
            bodyEn: "This is not one dirty file. Five systems have to share keys and dictionaries first. Otherwise shop KPIs are counted on duplicated customers, 11 payment methods and a funnel missing 30% of events. The most valuable result is a negative one: two columns that look like keys are not keys, so I did not compute the session funnel. I would rather not publish a number that looks good and means nothing.",
            insights: true,
            code: "print(\"Unique customers:\", crm[\"customer_id\"].nunique())        # 48,200 not 50,000\nprint(\"Payment methods:\", fact[\"payment_method\"].nunique())     # 4 not 11\nprint(\"Dates rescued:\", stats[\"date_rescued\"])                  # 36,160 kept, not dropped\nprint(\"Unattributable events:\", click[\"customer_id\"].isna().sum())  # 150,553, reported as such\nprint(\"session_id usable as a key:\", (per_session > 1).sum() == 0)  # False"
        }
    ];

    var step = 0;

    function lang() {
        return document.documentElement.getAttribute("data-lang") === "en" ? "en" : "pl";
    }

    function term(key, text) {
        return window.dqTerm ? window.dqTerm(key, text) : text;
    }

    function fmtInt(n) {
        return Number(n).toLocaleString(lang() === "en" ? "en-US" : "pl-PL");
    }

    function cellClass(flag) {
        if (flag === "invalid") return "dc-cell invalid";
        if (flag === "outlier") return "dc-cell outlier";
        if (flag === "changed") return "dc-cell changed";
        if (flag === "noisy") return "dc-cell noisy";
        if (flag === "mismatch") return "dc-cell mismatch";
        return "";
    }

    function cleanName(s) {
        var t = String(s == null ? "" : s).trim();
        t = t.replace(/(.)\1+/g, "$1");
        if (!t) return t;
        return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    }

    function canonCat(c) {
        if (c == null || String(c).trim() === "") return "—";
        var k = String(c).trim().toLowerCase();
        return CAT_MAP[k] || k;
    }

    function canonPrice(p) {
        if (p == null || String(p).trim() === "") return NaN;
        var n = Number(String(p).replace(/,/g, ""));
        if (!Number.isFinite(n) || n <= 0) return NaN;
        return n;
    }

    function canonStatus(s) {
        var x = String(s == null ? "" : s).trim().toLowerCase();
        if (x === "suc" || x === "success") return "success";
        if (x === "ref" || x.indexOf("refund") === 0) return "refunded";
        if (x.indexOf("fail") !== -1) return "failed";
        return x;
    }

    function canonPay(s) {
        var x = String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, "");
        x = x.replace("wall-et", "wallet").replace("c@rd", "card").replace("crad", "card");
        if (x === "cd") return "card";
        return x;
    }

    function canonQty(q) {
        var s = String(q == null ? "" : q).trim().toLowerCase();
        if (s === "five") return 5;
        var n = Number(s);
        if (!Number.isFinite(n) || n <= 0) return NaN;
        return n;
    }

    function canonIssue(s) {
        var x = String(s == null ? "" : s).trim().toLowerCase().replace(/[_x]+$/, "");
        x = x.replace(/3/g, "e");
        if (x === "tnemyap" || x.indexOf("pay") === 0) return "payment";
        if (x === "dnufer" || x.indexOf("refund") === 0) return "refund";
        if (x.indexOf("delay") === 0) return "delay";
        if (x.indexOf("pro") === 0) return "product";
        return x;
    }

    function canonSent(s) {
        var x = String(s == null ? "" : s).trim().toLowerCase().replace(/3/g, "e");
        if (x.indexOf("neg") === 0) return "negative";
        if (x.indexOf("pos") === 0) return "positive";
        if (x.indexOf("neu") === 0) return "neutral";
        return x;
    }

    function isBadDate(s) {
        var v = String(s == null ? "" : s).trim();
        if (!v) return true;
        if (/\/31\//.test(v)) return true;
        if (/T2[4-9]:/.test(v) || /T[3-9]\d:/.test(v)) return true;
        if (/ 2[4-9]:/.test(v) || / [3-9]\d:/.test(v)) return true;
        return false;
    }

    function canonDate(s) {
        var v = String(s == null ? "" : s).trim();
        if (isBadDate(v)) return "—";
        var m = v.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})/);
        if (m) return m[1] + "-" + m[2] + "-" + m[3];
        return v.slice(0, 10);
    }

    function copy(row) {
        var out = {};
        Object.keys(row).forEach(function (k) { out[k] = row[k]; });
        out.flags = {};
        return out;
    }

    function processCrm(level) {
        var seen = {};
        return (PREVIEW.crm || []).map(function (src) {
            var row = copy(src);
            if (level === 0) {
                if (/[a-z]/.test(src.first_name) && /[A-Z]/.test(src.first_name) || /(.)\1{1,}/.test(src.first_name)) {
                    row.flags.first_name = "noisy";
                }
                if (/^\s/.test(src.last_name) || src.last_name !== src.last_name.trim()) row.flags.last_name = "noisy";
                if (!src.email) row.flags.email = "invalid";
                if (seen[src.customer_id]) row.flags.customer_id = "mismatch";
                seen[src.customer_id] = true;
            }
            if (level >= 1) {
                var fn = cleanName(src.first_name);
                var ln = cleanName(src.last_name);
                if (fn !== src.first_name) row.flags.first_name = "changed";
                if (ln !== String(src.last_name).trim() && ln !== src.last_name) row.flags.last_name = "changed";
                row.first_name = fn;
                row.last_name = ln;
                if (!src.email) {
                    row.email = "—";
                    row.flags.email = "invalid";
                }
                if (seen[src.customer_id]) {
                    row.drop = true;
                    row.flags.customer_id = "changed";
                }
                seen[src.customer_id] = true;
            }
            return row;
        });
    }

    function processCatalog(level) {
        return (PREVIEW.catalog || []).map(function (src) {
            var row = copy(src);
            if (level === 0) {
                if (src.category && canonCat(src.category) !== src.category) row.flags.category = "mismatch";
                if (!src.category) row.flags.category = "invalid";
                if (String(src.price).indexOf(",") !== -1) row.flags.price = "noisy";
                if (Number(src.price) <= 0) row.flags.price = "outlier";
            }
            if (level >= 2) {
                var cat = canonCat(src.category);
                var price = canonPrice(src.price);
                if (cat !== src.category) row.flags.category = "changed";
                row.category = cat;
                if (!Number.isFinite(price)) {
                    row.price = "—";
                    row.flags.price = "invalid";
                } else if (String(src.price) !== String(price)) {
                    row.price = price.toFixed(2);
                    row.flags.price = "changed";
                }
            }
            return row;
        });
    }

    function processOrders(level) {
        return (PREVIEW.orders || []).map(function (src) {
            var row = copy(src);
            if (level === 0) {
                if (canonPay(src.payment_method) !== String(src.payment_method).trim().toLowerCase()) row.flags.payment_method = "mismatch";
                if (canonStatus(src.status) !== String(src.status).trim().toLowerCase()) row.flags.status = "mismatch";
                if (isBadDate(src.order_date) || !src.order_date) row.flags.order_date = "invalid";
                var amt = Number(src.order_amount);
                if (!Number.isFinite(amt) || amt <= 0) row.flags.order_amount = "outlier";
                if (!Number.isFinite(canonQty(src.quantity))) row.flags.quantity = "invalid";
            }
            if (level >= 3) {
                var st = canonStatus(src.status);
                var pay = canonPay(src.payment_method);
                var qty = canonQty(src.quantity);
                var amt2 = Number(src.order_amount);
                var dt = canonDate(src.order_date);
                if (st !== String(src.status).trim()) row.flags.status = "changed";
                if (pay !== String(src.payment_method).trim()) row.flags.payment_method = "changed";
                row.status = st;
                row.payment_method = pay;
                if (!Number.isFinite(qty)) {
                    row.quantity = "—";
                    row.flags.quantity = "invalid";
                } else {
                    if (String(src.quantity).trim() !== String(qty)) row.flags.quantity = "changed";
                    row.quantity = String(qty);
                }
                if (!Number.isFinite(amt2) || amt2 <= 0) {
                    row.order_amount = "—";
                    row.flags.order_amount = "invalid";
                }
                if (dt === "—") row.flags.order_date = "invalid";
                else if (dt !== src.order_date) row.flags.order_date = "changed";
                row.order_date = dt;
            }
            return row;
        });
    }

    function processTickets(level) {
        return (PREVIEW.tickets || []).map(function (src) {
            var row = copy(src);
            if (level === 0) {
                if (canonIssue(src.issue_type) !== String(src.issue_type).trim().toLowerCase()) row.flags.issue_type = "mismatch";
                if (canonSent(src.sentiment) !== String(src.sentiment).trim().toLowerCase()) row.flags.sentiment = "noisy";
                if (isBadDate(src.ticket_created) || !src.ticket_created) row.flags.ticket_created = "invalid";
            }
            if (level >= 4) {
                var iss = canonIssue(src.issue_type);
                var sen = canonSent(src.sentiment);
                var created = canonDate(src.ticket_created);
                if (iss !== src.issue_type) row.flags.issue_type = "changed";
                if (sen !== src.sentiment) row.flags.sentiment = "changed";
                row.issue_type = iss;
                row.sentiment = sen;
                row.ticket_created = created;
                if (created === "—") row.flags.ticket_created = "invalid";
                else if (created !== src.ticket_created) row.flags.ticket_created = "changed";
            }
            return row;
        });
    }

    function processClick(level) {
        return (PREVIEW.clickstream || []).map(function (src) {
            var row = copy(src);
            if (level === 0) {
                if (!src.customer_id) row.flags.customer_id = "invalid";
                if (!src.page_url) row.flags.page_url = "invalid";
                if (isBadDate(src.timestamp)) row.flags.timestamp = "outlier";
            }
            if (level >= 5) {
                if (!src.customer_id) {
                    row.customer_id = "anonymous";
                    row.flags.customer_id = "changed";
                }
                if (!src.page_url) {
                    row.page_url = "—";
                    row.flags.page_url = "invalid";
                }
                var ts = canonDate(src.timestamp);
                row.timestamp = ts;
                if (ts === "—") row.flags.timestamp = "invalid";
                else if (ts !== src.timestamp) row.flags.timestamp = "changed";
            }
            return row;
        });
    }

    function landscapeRows() {
        var en = lang() === "en";
        return [
            { source: "CRM", id: "0d244537", field: "first_name", value: "mARIA", issue: en ? "mixed case" : "mieszana wielkość liter", flags: { value: "noisy" } },
            { source: "CRM", id: "00682ed4", field: "customer_id", value: "×2 rows", issue: en ? "duplicate ID" : "zdublowane ID", flags: { value: "mismatch" } },
            { source: "Catalog", id: "PROD-0003", field: "category / price", value: "3l3ctronics / −100", issue: (en ? "leetspeak + " : "leetspeak + ") + term("sentinel_price", en ? "sentinel" : "strażnik"), flags: { value: "outlier" } },
            { source: "Orders", id: "06b5aa88", field: "payment_method", value: "wall-et", issue: en ? "typo vs wallet" : "literówka vs wallet", flags: { value: "mismatch" } },
            { source: "Orders", id: "5b10b856", field: "order_date", value: "2024/31/01", issue: en ? "impossible date" : "niemożliwa data", flags: { value: "invalid" } },
            { source: "Orders", id: "b05c45b2", field: "quantity", value: "−3", issue: en ? "negative quantity" : "ujemna ilość", flags: { value: "outlier" } },
            { source: "Tickets", id: "8a3b7124", field: "issue_type", value: "tnemyap", issue: en ? "payment reversed" : "payment wspak", flags: { value: "mismatch" } },
            { source: "Tickets", id: "bc2183e9", field: "ticket_created", value: "T28:77:10", issue: en ? "impossible time" : "niemożliwa godzina", flags: { value: "invalid" } },
            { source: "Click", id: "aa56e7fb", field: "customer_id", value: "", issue: en ? "login without customer" : "login bez klienta", flags: { value: "invalid" } },
            { source: "Click", id: "c0f6a7b0", field: "timestamp", value: "25:61:00", issue: en ? "invalid clock" : "zły zegar", flags: { value: "outlier" } }
        ];
    }

    function joinedRows() {
        var orders = processOrders(6).filter(function (r) { return r.order_amount !== "—"; });
        return orders.slice(0, 8).map(function (r) {
            return {
                order_id: r.order_id,
                customer_id: r.customer_id,
                product_id: r.product_id,
                status: r.status,
                payment_method: r.payment_method,
                order_amount: r.order_amount,
                order_date: r.order_date,
                flags: r.flags
            };
        });
    }

    function headersFor(table) {
        if (table === "landscape") return ["source", "id", "field", "value", "issue"];
        if (table === "crm") return ["customer_id", "first_name", "last_name", "email", "phone", "source"];
        if (table === "catalog") return ["product_id", "product_name", "category", "price"];
        if (table === "orders") return ["order_id", "product_id", "order_amount", "order_date", "payment_method", "status", "quantity"];
        if (table === "tickets") return ["ticket_id", "issue_type", "ticket_created", "sentiment", "resolution_time_hours"];
        if (table === "clickstream") return ["event_id", "customer_id", "event_type", "page_url", "timestamp"];
        if (table === "joined") return ["order_id", "customer_id", "product_id", "status", "payment_method", "order_amount", "order_date"];
        return [];
    }

    function rowsFor(table, level) {
        if (table === "landscape") return landscapeRows();
        if (table === "crm") return processCrm(level).filter(function (r) { return !r.drop; });
        if (table === "catalog") return processCatalog(level);
        if (table === "orders") return processOrders(level);
        if (table === "tickets") return processTickets(level);
        if (table === "clickstream") return processClick(level);
        if (table === "joined") return joinedRows();
        return [];
    }

    function renderTable(table, level) {
        var cols = headersFor(table);
        var rows = rowsFor(table, level);
        var html = "<thead><tr>" + cols.map(function (c) { return "<th>" + c + "</th>"; }).join("") + "</tr></thead><tbody>";
        rows.forEach(function (r) {
            html += "<tr>";
            cols.forEach(function (c) {
                var val = r[c] == null || r[c] === "" ? "" : r[c];
                html += "<td class=\"" + cellClass(r.flags && r.flags[c]) + "\">" + val + "</td>";
            });
            html += "</tr>";
        });
        html += "</tbody>";
        document.getElementById("ecom-table").innerHTML = html;
        var en = lang() === "en";
        document.getElementById("ecom-caption").textContent = en
            ? "Preview of " + table + " — KPIs below are from the full files, not this slice"
            : "Podgląd: " + table + " — KPI poniżej są z pełnych plików, nie z tego wycinka";
    }

    function metricSpec(n) {
        var en = lang() === "en";
        var specs = [
            [
                [fmtInt(T.rows), en ? "rows in 5 tables" : "wiersze w 5 tabelach"],
                [String(T.tables), en ? "source files" : "pliki źródłowe"],
                [String(T.categoriesRaw), en ? "category labels" : "etykiety kategorii"],
                [fmtInt(T.crmDups), en ? "CRM duplicate rows" : "duplikaty CRM", "duplicate"]
            ],
            [
                [fmtInt(T.crm), en ? "CRM rows" : "wiersze CRM"],
                [fmtInt(T.crmUnique), en ? "unique customers" : "unikalni klienci"],
                [fmtInt(T.crmDups), en ? "duplicates dropped" : "duplikaty do usunięcia", "duplicate"],
                [fmtInt(T.emailMissing), en ? "missing emails" : "braki e-mail"]
            ],
            [
                [fmtInt(T.catalog), en ? "products" : "produkty"],
                [String(T.categoriesRaw), en ? "raw categories" : "kategorie surowe"],
                [String(T.categoriesClean), en ? "canonical categories" : "kategorie kanoniczne", "canonical"],
                ["−100", en ? "price sentinel" : "strażnik ceny", "sentinel_price"]
            ],
            [
                [fmtInt(T.orders), en ? "orders" : "zamówienia"],
                [T.statusRaw + " → " + T.statusClean, en ? "statuses" : "statusy"],
                [T.paymentRaw + " → " + T.paymentClean, en ? "payment methods" : "metody płatności"],
                [fmtInt(T.orderDateRescued), en ? "dates recovered" : "daty odzyskane"]
            ],
            [
                [fmtInt(T.tickets), en ? "tickets" : "tickety"],
                [T.issueRaw + " → " + T.issueClean, en ? "issue types" : "typy zgłoszeń"],
                [T.sentimentRaw + " → " + T.sentimentClean, en ? "sentiments" : "sentymenty"],
                ["T28:77", en ? "impossible hour" : "niemożliwa godzina"]
            ],
            [
                [fmtInt(T.click), en ? "events" : "zdarzenia"],
                [fmtInt(T.clickAnon), en ? "unattributable" : "nieprzypisywalne", "anonymous"],
                ["8 000 → 0", en ? "usable session keys" : "użyteczne klucze sesji"],
                ["0", en ? "device ids matching CRM" : "device_id zgodnych z CRM"]
            ],
            [
                [fmtInt(T.crm) + " → " + fmtInt(T.crmUnique), en ? "unique customers" : "unikalni klienci"],
                [fmtInt(T.crmDups) + " → 0", en ? "CRM dupes in grain" : "dupl. CRM w ziarnie", "grain"],
                ["0", en ? "orphan keys" : "klucze-sieroty"],
                [fmtInt(T.ordersAnalysable), en ? "orders analysable" : "zamówienia analizowalne"]
            ]
        ];
        return specs[Math.min(n, specs.length - 1)];
    }

    function applyMetrics(n) {
        var spec = metricSpec(n);
        ["ecom-m-a", "ecom-m-b", "ecom-m-c", "ecom-m-d"].forEach(function (id, i) {
            document.getElementById(id).textContent = spec[i][0];
            document.getElementById(id + "-label").innerHTML = spec[i][2] ? term(spec[i][2], spec[i][1]) : spec[i][1];
        });
        renderMetricsSummary(n);
    }

    function computePipelineCounts() {
        var retainedPct = T.crm
            ? ((T.crmUnique / T.crm) * 100).toLocaleString(lang() === "en" ? "en-US" : "pl-PL", {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1
            })
            : "0";
        return {
            rawRows: T.rows,
            crmRows: T.crm,
            crmUnique: T.crmUnique,
            crmDups: T.crmDups,
            clickAnon: T.clickAnon,
            retainedPct: retainedPct,
            analysisRows: T.rows - T.crmDups
        };
    }

    function renderPipelineFunnel(pipe) {
        var en = lang() === "en";
        return "<div class=\"dc-pipeline-funnel\">" +
            "<div class=\"dc-funnel-step\"><strong>" + fmtInt(pipe.rawRows) + "</strong><span>" +
            (en ? "rows across 5 source files" : "wierszy w 5 plikach źródłowych") + "</span></div>" +
            "<div class=\"dc-funnel-arrow\">↓ " + fmtInt(pipe.crmDups) + " " +
            term("duplicate", en ? "CRM duplicate rows" : "zdublowanych wierszy CRM") + "</div>" +
            "<div class=\"dc-funnel-step\"><strong>" + fmtInt(pipe.crmUnique) + "</strong><span>" +
            (en ? "unique customers for joins" : "unikalnych klientów do joinów") + "</span></div>" +
            "<div class=\"dc-funnel-arrow\">↓ " + fmtInt(pipe.clickAnon) + " " +
            term("anonymous", en ? "anonymous events flagged (retained)" : "anonimowych eventów oznaczonych (zachowanych)") + "</div>" +
            "<div class=\"dc-funnel-step highlight\"><strong>" + fmtInt(pipe.analysisRows) + "</strong><span>" +
            term("grain", en ? "rows in join-ready grain" : "wierszy w ziarnie gotowym do joinów") + "</span></div>" +
            "</div>";
    }

    function renderExecutiveSummaryTable() {
        var en = lang() === "en";
        function row(label, rawVal, cleanVal, tipKey) {
            var name = tipKey ? term(tipKey, label) : label;
            return "<tr><td>" + name + "</td><td>" + fmtInt(rawVal) + "</td>" +
                "<td class=\"dc-cell changed\">" + (typeof cleanVal === "number" ? fmtInt(cleanVal) : cleanVal) + "</td></tr>";
        }
        return "<h3>" + (en ? "Pipeline executive summary" : "Podsumowanie pipeline'u") + "</h3>" +
            "<p class=\"dc-progress-note\">" + (en
                ? "Raw exports vs join-ready grain — duplicates and anonymous events are flagged, not silently dropped."
                : "Surowe eksporty vs ziarno gotowe do joinów — duplikaty i anonimowe eventy są oznaczone, nie usuwane po cichu.") +
            "</p>" +
            "<table class=\"dc-table dc-progress-table dc-executive-table\">" +
            "<thead><tr><th>" + (en ? "Problem" : "Problem") + "</th><th>Raw</th><th>" + (en ? "Analysis" : "Analiza") + "</th></tr></thead><tbody>" +
            row(en ? "CRM duplicate rows" : "Duplikaty CRM", T.crmDups, 0, "duplicate") +
            row(en ? "Category labels" : "Etykiety kategorii", T.categoriesRaw, T.categoriesClean, "canonical") +
            row(en ? "Payment methods" : "Metody płatności", T.paymentRaw, T.paymentClean) +
            row(en ? "Order statuses" : "Statusy zamówień", T.statusRaw, T.statusClean) +
            row(en ? "Issue types" : "Typy zgłoszeń", T.issueRaw, T.issueClean) +
            row(en ? "Sentiment labels" : "Etykiety sentymentu", T.sentimentRaw, T.sentimentClean) +
            row(en ? "Anonymous click events" : "Anonimowe eventy clickstream", T.clickAnon, T.clickAnon + " " + (en ? "(flagged)" : "(ozn.)"), "anonymous") +
            row(en ? "Unresolved labels" : "Etykiety nierozwiązane", T.categoriesRaw + T.paymentRaw + T.statusRaw + T.issueRaw + T.sentimentRaw, 0, "canonical") +
            row(en ? "Order dates unusable" : "Daty zamówień nie do użycia", T.orderDateBad + T.orderDateRescued, T.orderDateBad) +
            row(en ? "Unique customers" : "Unikalni klienci", T.crm, T.crmUnique, "grain") +
            row(en ? "Rows in dataset" : "Rekordy w secie", T.rows, T.rows - T.crmDups) +
            "</tbody></table>";
    }

    function renderPortfolioSummary(pipe) {
        var en = lang() === "en";
        function card(stat, label) {
            return "<div class=\"dc-portfolio-kpi\"><strong>" + stat + "</strong><span>" + label + "</span></div>";
        }
        return "<div class=\"dc-portfolio-summary\">" +
            "<h3>" + (en ? "Project outcome" : "Wynik projektu") + "</h3>" +
            "<div class=\"dc-portfolio-kpi-grid\">" +
            card(fmtInt(pipe.rawRows), en ? "SOURCE ROWS (5 FILES)" : "WIERSZY ŹRÓDŁOWYCH (5 PLIKÓW)") +
            card(fmtInt(pipe.crmDups), en ? "CRM DUPLICATES EXCLUDED FROM GRAIN" : "DUPL. CRM WYKLUCZONE ZE ZIANA") +
            card(pipe.retainedPct + "%", en ? "UNIQUE CUSTOMERS RETAINED" : "UNIK. KLIENTÓW ZACHOWANYCH") +
            card(T.categoriesRaw + " → " + T.categoriesClean, en ? "CATEGORY LABELS STANDARDIZED" : "ETYKIET KATEGORII USTAND.") +
            card(T.paymentRaw + " → " + T.paymentClean, en ? "PAYMENT METHODS STANDARDIZED" : "METOD PŁATNOŚCI USTAND.") +
            card(T.statusRaw + " → " + T.statusClean, en ? "ORDER STATUSES STANDARDIZED" : "STATUSÓW ZAMÓWIEŃ USTAND.") +
            card(fmtInt(pipe.clickAnon), en ? "ANONYMOUS EVENTS FLAGGED" : "ANONIMOWYCH EVENTÓW OZNACZONYCH") +
            "</div>" +
            "<p class=\"dc-portfolio-result\">" + (en
                ? "Result: five tables linked on a customer_id verified to have zero orphans, canonical dictionaries with no unresolved values, 36,160 dates recovered rather than dropped — and two rejected join keys that rule out a session-level funnel."
                : "Rezultat: pięć tabel powiązanych po customer_id sprawdzonym na zero sierot, kanoniczne słowniki bez wartości nierozwiązanych, 36 160 dat odzyskanych zamiast wyrzuconych — oraz dwa odrzucone klucze złączeń, które wykluczają lejek po sesjach.") +
            "</p></div>";
    }

    function renderMetricsSummary(n) {
        var el = document.getElementById("ecom-metrics-summary");
        if (!el) return;
        var en = lang() === "en";
        if (n === 6) {
            var pipe = computePipelineCounts();
            el.hidden = false;
            el.innerHTML =
                renderPipelineFunnel(pipe) +
                "<div class=\"dc-lineage\">" +
                "<div class=\"dc-lineage-step\"><span class=\"label\">RAW</span><strong>" + fmtInt(T.rows) + "</strong><br>" +
                (en ? "5 source exports" : "5 eksportów źródłowych") + "</div>" +
                "<div class=\"dc-lineage-arrow\">→</div>" +
                "<div class=\"dc-lineage-step\"><span class=\"label\">STANDARDIZED</span><strong>" + fmtInt(T.rows) + "</strong><br>" +
                (en ? "dictionaries · flags · audit trail" : "słowniki · flagi · ślad audytowy") + "</div>" +
                "<div class=\"dc-lineage-arrow\">→</div>" +
                "<div class=\"dc-lineage-step highlight\"><span class=\"label\">JOIN-READY</span><strong>" + fmtInt(pipe.crmUnique) + "</strong><br>" +
                (en ? "unique customers · " + pipe.retainedPct + "% retained" : "unikalni klienci · " + pipe.retainedPct + "% zachowanych") + "</div>" +
                "</div>" +
                "<p class=\"dc-metrics-total\">" +
                (en
                    ? "<strong>" + fmtInt(T.crm) + " → " + fmtInt(T.crmUnique) + "</strong> unique customers · " + fmtInt(T.crmDups) + " CRM duplicates excluded from analytical grain (not deleted from audit export)"
                    : "<strong>" + fmtInt(T.crm) + " → " + fmtInt(T.crmUnique) + "</strong> unikalnych klientów · " + fmtInt(T.crmDups) + " duplikatów CRM wykluczonych ze ziarna analitycznego (nie usuniętych z eksportu audytowego)") +
                "</p>";
            return;
        }
        el.hidden = true;
        el.innerHTML = "";
    }

    function catalogLookup() {
        var map = {};
        (PREVIEW.catalog || []).forEach(function (p) {
            map[p.product_id] = canonCat(p.category);
        });
        return map;
    }

    function computeAnalysisPreview() {
        var cats = catalogLookup();
        var gmv = {};
        var payments = {};
        processOrders(6).forEach(function (r) {
            if (r.status !== "success" || r.order_amount === "—") return;
            var amt = Number(r.order_amount);
            if (!Number.isFinite(amt)) return;
            var cat = cats[r.product_id] || "other";
            gmv[cat] = (gmv[cat] || 0) + amt;
            var pay = r.payment_method || "other";
            payments[pay] = (payments[pay] || 0) + 1;
        });
        return { gmv: gmv, payments: payments };
    }

    function barRow(label, value, max, color) {
        var pct = max > 0 ? Math.max(3, (value / max) * 100) : 0;
        return "<div class=\"dc-bar-row\">" +
            "<span class=\"dc-bar-label\">" + label + "</span>" +
            "<div class=\"dc-bar-track\"><div class=\"dc-bar-fill\" style=\"width:" + pct + "%;background:" + color + "\"></div></div>" +
            "<span class=\"dc-bar-value\">" + fmtInt(value) + "</span>" +
            "</div>";
    }

    function comparePair(label, before, after, max) {
        var bPct = max > 0 ? Math.max(4, (before / max) * 100) : 0;
        var aPct = max > 0 ? Math.max(4, (after / max) * 100) : 0;
        return "<div class=\"dc-compare-row\">" +
            "<span class=\"dc-bar-label\">" + label + "</span>" +
            "<div class=\"dc-compare-cell\"><div class=\"dc-bar-track\"><div class=\"dc-bar-fill\" style=\"width:" + bPct + "%;background:#fbbf24\"></div></div><span class=\"dc-bar-value\">" + before + "</span></div>" +
            "<div class=\"dc-compare-cell\"><div class=\"dc-bar-track\"><div class=\"dc-bar-fill\" style=\"width:" + aPct + "%;background:#86efac\"></div></div><span class=\"dc-bar-value\">" + after + "</span></div>" +
            "</div>";
    }

    function renderViz() {
        var en = lang() === "en";
        var pipe = computePipelineCounts();
        var preview = computeAnalysisPreview();
        var maxRows = T.click;

        var funnel = barRow("Clickstream", T.click, maxRows, "#7dd3fc") +
            barRow(en ? "Orders" : "Zamówienia", T.orders, maxRows, "#94a3b8") +
            barRow("CRM", T.crm, maxRows, "#c4b5fd") +
            barRow(en ? "Tickets" : "Tickety", T.tickets, maxRows, "#fbbf24") +
            barRow(en ? "Catalog" : "Katalog", T.catalog, maxRows, "#86efac");

        var labels = "<div class=\"dc-compare-head\"><span class=\"dc-bar-label\"></span><span>" +
            (en ? "Raw labels" : "Etykiety surowe") + "</span><span>" +
            (en ? "Canonical" : "Kanoniczne") + "</span></div>" +
            comparePair(en ? "Categories" : "Kategorie", T.categoriesRaw, T.categoriesClean, T.categoriesRaw) +
            comparePair(en ? "Statuses" : "Statusy", T.statusRaw, T.statusClean, T.statusRaw) +
            comparePair(en ? "Payments" : "Płatności", T.paymentRaw, T.paymentClean, T.paymentRaw) +
            comparePair(en ? "Issue types" : "Typy zgłoszeń", T.issueRaw, T.issueClean, T.issueRaw) +
            comparePair(en ? "Sentiment" : "Sentyment", T.sentimentRaw, T.sentimentClean, T.sentimentRaw);

        var identMax = T.click;
        var ident = barRow(en ? "Identified events" : "Zdarzenia z klientem", T.click - T.clickAnon, identMax, "#86efac") +
            barRow(en ? "Anonymous events" : "Zdarzenia anonimowe", T.clickAnon, identMax, "#fbbf24");

        var gmvKeys = Object.keys(preview.gmv);
        var maxGmv = Math.max.apply(null, gmvKeys.map(function (k) { return preview.gmv[k]; }).concat([1]));
        var gmvHtml = gmvKeys.sort(function (a, b) { return preview.gmv[b] - preview.gmv[a]; }).map(function (k) {
            return barRow(k, Math.round(preview.gmv[k]), maxGmv, "#38bdf8");
        }).join("");

        var payKeys = Object.keys(preview.payments);
        var maxPay = Math.max.apply(null, payKeys.map(function (k) { return preview.payments[k]; }).concat([1]));
        var payHtml = payKeys.sort(function (a, b) { return preview.payments[b] - preview.payments[a]; }).map(function (k) {
            return barRow(k, preview.payments[k], maxPay, "#c084fc");
        }).join("");

        document.getElementById("ecom-viz").innerHTML =
            "<div class=\"dc-viz-lead\">" +
            "<p class=\"dc-insight-kicker\">" + (en ? "Analysis question" : "Pytanie analityczne") + "</p>" +
            "<p><strong>" + (en ? "Which categories drive GMV and what is the payment mix?" : "Które kategorie generują GMV i jaki jest miks płatności?") + "</strong> — " +
            (en ? "on join-ready data with " + T.paymentClean + " payment methods, not " + T.paymentRaw + "."
                : "na danych gotowych do joinów z " + T.paymentClean + " metodami płatności, nie " + T.paymentRaw + ".") +
            "</p></div>" +
            "<div class=\"dc-viz-grid\">" +
            "<div class=\"dc-chart dc-chart-wide\">" +
            "<h3>" + (en ? "GMV by category (preview slice)" : "GMV wg kategorii (wycinek podglądu)") + "</h3>" +
            "<p class=\"dc-chart-note\">" + (en ? "Full-file KPIs: 300,000 orders on canonical categories." : "KPI z pełnych plików: 300 000 zamówień na kanonicznych kategoriach.") + "</p>" +
            gmvHtml +
            "</div>" +
            "<div class=\"dc-chart\">" +
            "<h3>" + (en ? "Successful orders by payment (preview)" : "Udane zamówienia wg płatności (podgląd)") + "</h3>" +
            payHtml +
            "</div>" +
            "<div class=\"dc-chart\"><h3>" + (en ? "Volume by source" : "Wolumen wg źródła") + "</h3>" + funnel + "</div>" +
            "<div class=\"dc-chart\"><h3>" + (en ? "Dictionaries: raw vs canonical" : "Słowniki: surowe vs kanoniczne") + "</h3>" + labels + "</div>" +
            "<div class=\"dc-chart\"><h3>" + (en ? "Clickstream identity" : "Tożsamość w clickstream") + "</h3>" + ident +
            "<p class=\"dc-chart-note\">" + (en ? "30% of events cannot join to CRM. Funnel KPIs must split identified vs anonymous." : "30% zdarzeń nie złączy się z CRM. KPI lejka trzeba liczyć osobno: zidentyfikowani vs anonimowi.") + "</p></div>" +
            "</div>";
    }

    function renderInsights() {
        var en = lang() === "en";
        var pipe = computePipelineCounts();
        document.getElementById("ecom-insights").innerHTML =
            "<div class=\"dc-false-signal\">" +
            "<p class=\"dc-insight-kicker\">FALSE SIGNAL REMOVED</p>" +
            "<div class=\"dc-false-signal-grid\">" +
            "<div class=\"dc-false-signal-block\">" +
            "<span class=\"dc-false-signal-label\">" + (en ? "Raw exports" : "Surowe eksporty") + "</span>" +
            "<strong>" + (en ? "11 payment methods" : "11 metod płatności") + "</strong>" +
            "<span class=\"dc-false-signal-label\">" + fmtInt(T.crm) + " " + (en ? "CRM rows" : "wierszy CRM") + "</span>" +
            "</div>" +
            "<div class=\"dc-false-signal-arrow\">→</div>" +
            "<div class=\"dc-false-signal-block highlight\">" +
            "<span class=\"dc-false-signal-label\">" + (en ? "Join-ready grain" : "Ziarno gotowe do joinów") + "</span>" +
            "<strong>" + T.paymentClean + " " + (en ? "payment methods" : "metody płatności") + "</strong>" +
            "<span class=\"dc-false-signal-label\">" + fmtInt(T.crmUnique) + " " + (en ? "unique customers" : "unikalnych klientów") + "</span>" +
            "</div>" +
            "</div>" +
            "<p class=\"dc-false-signal-note\">" + (en
                ? "Without dictionary harmonisation and CRM dedupe, a payment-mix dashboard and customer count would report inflated, misleading shop KPIs."
                : "Bez harmonizacji słowników i deduplikacji CRM dashboard miksu płatności i liczba klientów raportowałyby zawyżone, mylące KPI sklepu.") +
            "</p></div>" +
            "<div class=\"dc-insight-lead\">" +
            "<p class=\"dc-insight-kicker\">" + (en ? "Business problem" : "Problem biznesowy") + "</p>" +
            "<p>" + (en
                ? "A payment-mix dashboard on raw files would show <strong>11 methods</strong> that are really <strong>4</strong> (card, wallet, UPI, cash). Customer count would read <strong>50,000 instead of 48,200</strong>. Conversion would ignore <strong>150,553</strong> anonymous events — and a session-level funnel would confidently report <strong>100%</strong> add-to-cart, because <code>session_id</code> is not a session."
                : "Dashboard miksu płatności na surowych plikach pokazałby <strong>11 metod</strong>, które są w praktyce <strong>4</strong> (card, wallet, UPI, cash). Liczba klientów wyniosłaby <strong>50 000 zamiast 48 200</strong>. Konwersja pominęłaby <strong>150 553</strong> anonimowych zdarzeń — a lejek po sesjach pewnym głosem podałby <strong>100%</strong> dodań do koszyka, bo <code>session_id</code> nie jest sesją.") +
            "</p></div>" +
            "<div class=\"dc-table-wrap dc-insight-table-wrap\">" +
            renderExecutiveSummaryTable() +
            "</div>" +
            renderPipelineFunnel(pipe) +
            "<div class=\"dc-lineage dc-lineage-insight\">" +
            "<div class=\"dc-lineage-step\"><span class=\"label\">RAW</span><strong>" + fmtInt(T.rows) + "</strong></div>" +
            "<div class=\"dc-lineage-arrow\">→</div>" +
            "<div class=\"dc-lineage-step\"><span class=\"label\">STANDARDIZED</span><strong>" + fmtInt(T.rows) + "</strong></div>" +
            "<div class=\"dc-lineage-arrow\">→</div>" +
            "<div class=\"dc-lineage-step highlight\"><span class=\"label\">JOIN-READY</span><strong>" + fmtInt(pipe.crmUnique) + "</strong><br><span class=\"dc-lineage-meta\">" + pipe.retainedPct + "%</span></div>" +
            "</div>" +
            "<div class=\"dc-insight-grid\">" +
            "<article class=\"dc-insight-card\"><p class=\"dc-insight-stat\">" + fmtInt(T.crmDups) + " → 0</p>" +
            "<h3>" + (en ? "Excluded from grain, not deleted" : "Wykluczone ze ziarna, nie usunięte") + "</h3>" +
            "<p>" + (en ? "Same customer_id, different spelling (Melissa Peck / PECK). Duplicates remain in the audit export — excluded only from unique-customer KPIs." : "To samo customer_id, inna pisownia (Melissa Peck / PECK). Duplikaty zostają w eksporcie audytowym — wykluczone tylko z KPI unikalnych klientów.") + "</p></article>" +
            "<article class=\"dc-insight-card\"><p class=\"dc-insight-stat\">" + T.categoriesRaw + " → " + T.categoriesClean + "</p>" +
            "<h3>" + (en ? "Category soup" : "Zupa kategorii") + "</h3>" +
            "<p>" + (en ? "clo, 3l3ctronics and hom3 are not extra departments. Revenue by category is meaningless until the map is applied." : "clo, 3l3ctronics i hom3 to nie dodatkowe działy. Przychód wg kategorii nie ma sensu, dopóki nie ma mapy.") + "</p></article>" +
            "<article class=\"dc-insight-card\"><p class=\"dc-insight-stat\">" + fmtInt(T.clickAnon) + " <span>· 30%</span></p>" +
            "<h3>" + (en ? "Unattributable, and reported as such" : "Nieprzypisywalne — i tak zaraportowane") + "</h3>" +
            "<p>" + (en ? "Login and add_to_cart arrive without customer_id, and device_id offers no way back: none of its 498,949 values appear in CRM. Dropping the events understates demand, imputing an owner invents data, so they are kept and every conversion figure states its scope." : "Login i add_to_cart przychodzą bez customer_id, a device_id nie daje drogi powrotnej: żadna z 498 949 wartości nie występuje w CRM. Odrzucenie zaniża popyt, dopisanie właściciela to wymyślanie danych — więc zostają, a każda liczba o konwersji podaje swój zakres.") + "</p></article>" +
            "<article class=\"dc-insight-card\"><p class=\"dc-insight-stat\">" + fmtInt(T.orderDateRescued) + "</p>" +
            "<h3>" + (en ? "Dates recovered, not discarded" : "Daty odzyskane, nie wyrzucone") + "</h3>" +
            "<p>" + (en ? "2024/31/01 and 31-12-2023 fail ISO parsing but are perfectly valid in %Y/%d/%m and %d-%m-%Y. Calling them corrupt would have deleted 12% of the order book; only 17,914 dates are genuinely missing." : "2024/31/01 i 31-12-2023 nie parsują się jako ISO, ale są poprawne w układach %Y/%d/%m i %d-%m-%Y. Uznanie ich za zepsute skasowałoby 12% zamówień; naprawdę brakuje tylko 17 914 dat.") + "</p></article>" +
            "<article class=\"dc-insight-card\"><p class=\"dc-insight-stat\">8 000 <span>· 0</span></p>" +
            "<h3>" + (en ? "A key that was not a key" : "Klucz, który nie był kluczem") + "</h3>" +
            "<p>" + (en ? "All 8,000 session_ids span several customers, so the session funnel returned a 100% cart rate — a clean-looking number over a meaningless grouping. Checking the key before grouping is what turned a false insight into a documented limitation." : "Wszystkie 8 000 session_id obejmują wielu klientów, więc lejek po sesjach dawał 100% koszyka — ładną liczbę na bezsensownym grupowaniu. Sprawdzenie klucza przed grupowaniem zamieniło fałszywy wniosek w udokumentowane ograniczenie.") + "</p></article>" +
            "</div>" +
            renderPortfolioSummary(pipe);
    }

    function renderStep() {
        var meta = STEPS[step];
        var en = lang() === "en";
        document.getElementById("ecom-step-title").textContent = en ? meta.titleEn : meta.titlePl;
        document.getElementById("ecom-step-body").textContent = en ? meta.bodyEn : meta.bodyPl;
        document.getElementById("ecom-code").textContent = meta.code || "";
        document.getElementById("ecom-progress").textContent = (step + 1) + " / " + STEPS.length;
        document.getElementById("ecom-code-wrap").hidden = !meta.code;
        document.querySelectorAll("#ecom-walkthrough .dc-step").forEach(function (btn) {
            var n = Number(btn.getAttribute("data-step"));
            btn.classList.toggle("active", n === step);
            btn.classList.toggle("done", n < step);
        });
        document.getElementById("ecom-prev").disabled = step === 0;
        document.getElementById("ecom-next").disabled = step === STEPS.length - 1;

        var isViz = !!meta.visualize;
        var isInsights = !!meta.insights;
        document.getElementById("ecom-viz").hidden = !isViz;
        document.getElementById("ecom-insights").hidden = !isInsights;
        document.getElementById("ecom-data-view").hidden = isViz || isInsights;

        if (isViz) renderViz();
        else if (isInsights) renderInsights();
        else {
            renderTable(meta.table, step);
            applyMetrics(step);
        }
        if (isViz || isInsights) {
            var el = document.getElementById("ecom-metrics-summary");
            if (el) { el.hidden = true; el.innerHTML = ""; }
        }
    }

    function go(n) {
        var previous = step;
        step = Math.max(0, Math.min(STEPS.length - 1, n));
        renderStep();
        if (step === previous) return;
        var target = document.getElementById("ecom-walkthrough");
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    document.getElementById("ecom-prev").addEventListener("click", function () { go(step - 1); });
    document.getElementById("ecom-next").addEventListener("click", function () { go(step + 1); });
    document.querySelectorAll("#ecom-walkthrough .dc-step").forEach(function (btn) {
        btn.addEventListener("click", function () { go(Number(btn.getAttribute("data-step"))); });
    });
    document.querySelectorAll("[data-set-lang]").forEach(function (btn) {
        btn.addEventListener("click", function () { setTimeout(renderStep, 0); });
    });

    renderStep();
})();
