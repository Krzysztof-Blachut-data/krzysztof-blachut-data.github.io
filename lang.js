(function () {
    var KEY = "lang";
    var html = document.documentElement;

    function currentLang() {
        return html.getAttribute("data-lang") === "en" ? "en" : "pl";
    }

    function setLang(lang) {
        var l = lang === "en" ? "en" : "pl";
        html.lang = l;
        html.setAttribute("data-lang", l);
        localStorage.setItem(KEY, l);

        var title = html.getAttribute("data-title-" + l);
        if (title) document.title = title;

        var desc = html.getAttribute("data-desc-" + l);
        var meta = document.querySelector('meta[name="description"]');
        if (desc && meta) meta.setAttribute("content", desc);

        document.querySelectorAll("[data-set-lang]").forEach(function (btn) {
            var active = btn.getAttribute("data-set-lang") === l;
            btn.classList.toggle("active", active);
            btn.setAttribute("aria-pressed", String(active));
        });
    }

    setLang(currentLang());

    document.querySelectorAll("[data-set-lang]").forEach(function (btn) {
        btn.addEventListener("click", function () {
            setLang(btn.getAttribute("data-set-lang"));
        });
    });
})();
