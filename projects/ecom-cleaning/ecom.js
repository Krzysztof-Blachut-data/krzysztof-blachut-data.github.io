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
            bodyPl: "50 000 wierszy, ale tylko 48 200 unikalnych ID — 1 800 duplikatów (ten sam klient, inna pisownia). Imiona jak mARIA i KKeevvin, spacje w nazwisku, 1 040 pustych e-maili. Deduplikacja po customer_id + Title Case.",
            bodyEn: "50,000 rows but only 48,200 unique IDs — 1,800 duplicates (same customer, different spelling). Names like mARIA and KKeevvin, padded surnames, 1,040 blank emails. Dedupe on customer_id + Title Case.",
            table: "crm",
            code: "crm[\"first_name\"] = crm[\"first_name\"].str.trim().str.replace(r\"(.)\\1+\", r\"\\1\", regex=True).str.title()\ncrm[\"last_name\"] = crm[\"last_name\"].str.strip().str.title()\ncrm[\"email\"] = crm[\"email\"].replace(\"\", np.nan)\ncrm = crm.drop_duplicates(\"customer_id\", keep=\"first\")"
        },
        {
            titlePl: "Katalog: kategorie i ceny",
            titleEn: "Catalog: categories and prices",
            bodyPl: "47 etykiet kategorii na 8 działów (clo, 3l3ctronics, hom3). Ceny jako tekst: „1,200”, strażnik −100, braki. Po mapie zostaje 8 kategorii i liczba.",
            bodyEn: "47 category labels for 8 departments (clo, 3l3ctronics, hom3). Prices as text: “1,200”, sentinel −100, blanks. After mapping: 8 categories and a numeric price.",
            table: "catalog",
            code: "cat_map = {\"clo\":\"clothing\",\"3l3ctronics\":\"electronics\",\"hom3\":\"home\",\"kitch3n\":\"kitchen\"}\ncatalog[\"category\"] = catalog[\"category\"].str.strip().str.lower().replace(cat_map)\ncatalog[\"price\"] = pd.to_numeric(catalog[\"price\"].str.replace(\",\",\"\"), errors=\"coerce\")\ncatalog.loc[catalog[\"price\"] <= 0, \"price\"] = np.nan"
        },
        {
            titlePl: "Zamówienia: słowniki, kwoty, daty",
            titleEn: "Orders: dictionaries, amounts, dates",
            bodyPl: "10 statusów → success / refunded / failed. 11 metod płatności → card, wallet, upi, cash (CRAD, c@rd, wall-et). Quantity bywa „five”, −3 albo puste. Daty: 2024/31/01, braki, ISO z godziną.",
            bodyEn: "10 statuses → success / refunded / failed. 11 payment methods → card, wallet, upi, cash (CRAD, c@rd, wall-et). Quantity is sometimes “five”, −3 or blank. Dates: 2024/31/01, blanks, ISO with time.",
            table: "orders",
            code: "status_map = {\"suc\":\"success\",\"success\":\"success\",\"ref\":\"refunded\",\"refunded\":\"refunded\",\"fail\":\"failed\"}\npay_map = {\"crad\":\"card\",\"c@rd\":\"card\",\"cd\":\"card\",\"wall-et\":\"wallet\"}\norders[\"status\"] = orders[\"status\"].str.strip().str.lower().replace(status_map)\norders[\"payment_method\"] = orders[\"payment_method\"].str.strip().str.lower().replace(pay_map)\norders[\"order_amount\"] = pd.to_numeric(orders[\"order_amount\"], errors=\"coerce\")\norders.loc[orders[\"order_amount\"] <= 0, \"order_amount\"] = np.nan"
        },
        {
            titlePl: "Tickety: odwrócone etykiety i niemożliwe godziny",
            titleEn: "Tickets: reversed labels and impossible hours",
            bodyPl: "35 typów zgłoszeń i 18 sentymentów. tnemyap to payment wspak, dnufer to refund, n3gativ3 to leetspeak. Timestamp 2025-12-12T28:77:10 nie istnieje — idzie na brak.",
            bodyEn: "35 issue types and 18 sentiments. tnemyap is payment reversed, dnufer is refund, n3gativ3 is leetspeak. Timestamp 2025-12-12T28:77:10 does not exist — it becomes missing.",
            table: "tickets",
            code: "rev = {\"tnemyap\":\"payment\",\"dnufer\":\"refund\"}\ntickets[\"issue_type\"] = tickets[\"issue_type\"].str.strip().str.lower().replace(rev)\ntickets[\"sentiment\"] = tickets[\"sentiment\"].str.strip().str.lower().str.replace(\"3\",\"e\").replace({\"neg\":\"negative\",\"pos\":\"positive\",\"neu\":\"neutral\"})\ntickets[\"ticket_created\"] = pd.to_datetime(tickets[\"ticket_created\"], errors=\"coerce\")"
        },
        {
            titlePl: "Clickstream: 30% zdarzeń bez klienta",
            titleEn: "Clickstream: 30% of events have no customer",
            bodyPl: "150 553 z 500 000 eventów nie ma customer_id — w tym loginy i add_to_cart. Część URL pusta, część timestampów to 2024/31/01 25:61:00. Anonimowe zostawiam, ale osobno: inaczej konwersja jest zaniżona.",
            bodyEn: "150,553 of 500,000 events have no customer_id — including logins and add_to_cart. Some URLs are blank; some timestamps are 2024/31/01 25:61:00. Anonymous events stay, but separately: otherwise conversion is understated.",
            table: "clickstream",
            code: "click[\"customer_id\"] = click[\"customer_id\"].replace(\"\", np.nan)\nclick[\"identified\"] = click[\"customer_id\"].notna()\nclick[\"timestamp\"] = pd.to_datetime(click[\"timestamp\"], errors=\"coerce\")\nfunnel = click.groupby([\"identified\",\"event_type\"]).size()"
        },
        {
            titlePl: "Zestaw gotowy do joinów",
            titleEn: "Join-ready dataset",
            bodyPl: "Po słownikach i deduplikacji tabele schodzą się po customer_id i product_id (w tym secie brak sierot). CRM: 50 000 → 48 200 unikalnych klientów (1 800 duplikatów wykluczonych ze ziarna analitycznego, nie usuniętych z audytu). GMV i lejek liczę na wspólnych kluczach.",
            bodyEn: "After dictionaries and dedupe the tables meet on customer_id and product_id (no orphans in this set). CRM: 50,000 → 48,200 unique customers (1,800 duplicates excluded from the analytical grain, not deleted from audit). GMV and funnel KPIs use shared keys.",
            table: "joined",
            cleanStory: true,
            code: "crm.to_csv(\"crm_standardized.csv\", index=False)  # 50,000 rows — audit trail\n\ncrm_analysis = crm.drop_duplicates(\"customer_id\", keep=\"first\")  # 48,200\n\nfact = orders.merge(crm_analysis, on=\"customer_id\", how=\"left\")\nfact = fact.merge(catalog[[\"product_id\",\"category\",\"price\"]], on=\"product_id\", how=\"left\")\nfact = fact.loc[fact[\"order_amount\"].notna() & fact[\"status\"].eq(\"success\")]"
        },
        {
            titlePl: "Analiza — GMV i mikro płatności",
            titleEn: "Analysis — GMV and payment mix",
            bodyPl: "Po ujednoliceniu pięciu plików: ile GMV generują kategorie? Jaki jest miks płatności na udanych zamówieniach? Poniżej wyniki na join-ready secie — nie na surowych 11 metodach płatności ani 47 kategoriach.",
            bodyEn: "After harmonising five files: how much GMV does each category drive? What is the payment mix on successful orders? Below: results on the join-ready set — not on raw 11 payment methods or 47 categories.",
            visualize: true,
            code: "raw_payment_count = orders[\"payment_method\"].nunique()  # 11\nanalysis = fact.loc[fact[\"status\"].eq(\"success\")]\nclean_payment_count = analysis[\"payment_method\"].nunique()  # 4\n\nanalysis.groupby(\"category\")[\"order_amount\"].sum().sort_values(ascending=False)\nanalysis.groupby(\"payment_method\")[\"order_id\"].count()"
        },
        {
            titlePl: "Wnioski z oczyszczonych danych",
            titleEn: "What the cleaned data actually says",
            bodyPl: "To nie jest jeden brudny plik — pięć systemów musi najpierw współdzielić klucze i słowniki. Inaczej KPI sklepu liczą się na duchach: zdublowanych klientach, 11 metodach płatności i lejku bez 30% eventów.",
            bodyEn: "This is not one dirty file — five systems must share keys and dictionaries first. Otherwise shop KPIs are counted on ghosts: duplicated customers, 11 payment methods and a funnel missing 30% of events.",
            insights: true,
            code: "print(\"Unique customers:\", crm[\"customer_id\"].nunique())  # 48,200 not 50,000\nprint(\"Payment methods:\", fact[\"payment_method\"].nunique())  # 4 not 11\nprint(\"Anonymous events:\", click.loc[~click[\"identified\"]].shape[0])  # 150,553 flagged, retained"
        }
    ];

    var step = 0;

    function lang() {
        return document.documentElement.getAttribute("data-lang") === "en" ? "en" : "pl";
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
            { source: "Catalog", id: "PROD-0003", field: "category / price", value: "3l3ctronics / −100", issue: en ? "leetspeak + sentinel" : "leetspeak + strażnik", flags: { value: "outlier" } },
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
                [fmtInt(T.crmDups), en ? "CRM duplicate rows" : "duplikaty CRM"]
            ],
            [
                [fmtInt(T.crm), en ? "CRM rows" : "wiersze CRM"],
                [fmtInt(T.crmUnique), en ? "unique customers" : "unikalni klienci"],
                [fmtInt(T.crmDups), en ? "duplicates dropped" : "duplikaty do usunięcia"],
                [fmtInt(T.emailMissing), en ? "missing emails" : "braki e-mail"]
            ],
            [
                [fmtInt(T.catalog), en ? "products" : "produkty"],
                [String(T.categoriesRaw), en ? "raw categories" : "kategorie surowe"],
                [String(T.categoriesClean), en ? "canonical categories" : "kategorie kanoniczne"],
                ["−100", en ? "price sentinel" : "strażnik ceny"]
            ],
            [
                [fmtInt(T.orders), en ? "orders" : "zamówienia"],
                [T.statusRaw + " → " + T.statusClean, en ? "statuses" : "statusy"],
                [T.paymentRaw + " → " + T.paymentClean, en ? "payment methods" : "metody płatności"],
                [fmtInt(T.orderDateBad), en ? "bad / missing dates" : "złe / puste daty"]
            ],
            [
                [fmtInt(T.tickets), en ? "tickets" : "tickety"],
                [T.issueRaw + " → " + T.issueClean, en ? "issue types" : "typy zgłoszeń"],
                [T.sentimentRaw + " → " + T.sentimentClean, en ? "sentiments" : "sentymenty"],
                ["T28:77", en ? "impossible hour" : "niemożliwa godzina"]
            ],
            [
                [fmtInt(T.click), en ? "events" : "zdarzenia"],
                [fmtInt(T.clickAnon), en ? "anonymous" : "anonimowe"],
                ["30%", en ? "share without customer" : "udział bez klienta"],
                ["25:61", en ? "invalid clock" : "zły zegar"]
            ],
            [
                [fmtInt(T.crm) + " → " + fmtInt(T.crmUnique), en ? "unique customers" : "unikalni klienci"],
                [fmtInt(T.crmDups) + " → 0", en ? "CRM dupes in grain" : "dupl. CRM w ziarnie"],
                [fmtInt(T.clickAnon), en ? "anonymous flagged" : "anonimowe oznaczone"],
                [fmtInt(T.orders), en ? "orders joinable" : "zamówienia do joinów"]
            ]
        ];
        return specs[Math.min(n, specs.length - 1)];
    }

    function applyMetrics(n) {
        var spec = metricSpec(n);
        ["ecom-m-a", "ecom-m-b", "ecom-m-c", "ecom-m-d"].forEach(function (id, i) {
            document.getElementById(id).textContent = spec[i][0];
            document.getElementById(id + "-label").textContent = spec[i][1];
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
            (en ? "CRM duplicate rows" : "zdublowanych wierszy CRM") + "</div>" +
            "<div class=\"dc-funnel-step\"><strong>" + fmtInt(pipe.crmUnique) + "</strong><span>" +
            (en ? "unique customers for joins" : "unikalnych klientów do joinów") + "</span></div>" +
            "<div class=\"dc-funnel-arrow\">↓ " + fmtInt(pipe.clickAnon) + " " +
            (en ? "anonymous events flagged (retained)" : "anonimowych eventów oznaczonych (zachowanych)") + "</div>" +
            "<div class=\"dc-funnel-step highlight\"><strong>" + fmtInt(pipe.analysisRows) + "</strong><span>" +
            (en ? "rows in join-ready grain" : "wierszy w ziarnie gotowym do joinów") + "</span></div>" +
            "</div>";
    }

    function renderExecutiveSummaryTable() {
        var en = lang() === "en";
        function row(label, rawVal, cleanVal) {
            return "<tr><td>" + label + "</td><td>" + fmtInt(rawVal) + "</td>" +
                "<td class=\"dc-cell changed\">" + (typeof cleanVal === "number" ? fmtInt(cleanVal) : cleanVal) + "</td></tr>";
        }
        return "<h3>" + (en ? "Pipeline executive summary" : "Podsumowanie pipeline'u") + "</h3>" +
            "<p class=\"dc-progress-note\">" + (en
                ? "Raw exports vs join-ready grain — duplicates and anonymous events are flagged, not silently dropped."
                : "Surowe eksporty vs ziarno gotowe do joinów — duplikaty i anonimowe eventy są oznaczone, nie usuwane po cichu.") +
            "</p>" +
            "<table class=\"dc-table dc-progress-table dc-executive-table\">" +
            "<thead><tr><th>" + (en ? "Problem" : "Problem") + "</th><th>Raw</th><th>" + (en ? "Analysis" : "Analiza") + "</th></tr></thead><tbody>" +
            row(en ? "CRM duplicate rows" : "Duplikaty CRM", T.crmDups, 0) +
            row(en ? "Category labels" : "Etykiety kategorii", T.categoriesRaw, T.categoriesClean) +
            row(en ? "Payment methods" : "Metody płatności", T.paymentRaw, T.paymentClean) +
            row(en ? "Order statuses" : "Statusy zamówień", T.statusRaw, T.statusClean) +
            row(en ? "Issue types" : "Typy zgłoszeń", T.issueRaw, T.issueClean) +
            row(en ? "Sentiment labels" : "Etykiety sentymentu", T.sentimentRaw, T.sentimentClean) +
            row(en ? "Anonymous click events" : "Anonimowe eventy clickstream", T.clickAnon, T.clickAnon + " " + (en ? "(flagged)" : "(ozn.)")) +
            row(en ? "Unique customers" : "Unikalni klienci", T.crm, T.crmUnique) +
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
                ? "Result: five linked tables with shared customer_id and product_id, canonical dictionaries and a split clickstream funnel (identified vs anonymous)."
                : "Rezultat: pięć powiązanych tabel ze wspólnym customer_id i product_id, kanonicznymi słownikami i rozdzielonym lejkiem clickstream (zidentyfikowani vs anonimowi).") +
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
                ? "A payment-mix dashboard on raw files would show <strong>11 methods</strong> that are really <strong>4</strong> (card, wallet, UPI, cash). Customer count would read <strong>50,000 instead of 48,200</strong>. Conversion would ignore <strong>150,553</strong> anonymous events."
                : "Dashboard miksu płatności na surowych plikach pokazałby <strong>11 metod</strong>, które są w praktyce <strong>4</strong> (card, wallet, UPI, cash). Liczba klientów wyniosłaby <strong>50 000 zamiast 48 200</strong>. Konwersja pominęłaby <strong>150 553</strong> anonimowych eventów.") +
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
            "<h3>" + (en ? "Anonymous events — flagged, retained" : "Anonimowe eventy — oznaczone, zachowane") + "</h3>" +
            "<p>" + (en ? "Login and add_to_cart arrive without customer_id. Dropping them understates demand; joining them as identified overstates conversion. Detection ≠ deletion." : "Login i add_to_cart przychodzą bez customer_id. Odrzucenie zaniża popyt; join jako zidentyfikowani zawyża konwersję. Detection ≠ deletion.") + "</p></article>" +
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
