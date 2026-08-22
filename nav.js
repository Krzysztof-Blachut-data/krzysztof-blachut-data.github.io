(function () {
            var toggle = document.getElementById("nav-toggle");
            var panel = document.getElementById("nav-links");
            if (!toggle || !panel) return;

            function close() {
                panel.classList.remove("is-open");
                toggle.setAttribute("aria-expanded", "false");
            }

            toggle.addEventListener("click", function () {
                var open = panel.classList.toggle("is-open");
                toggle.setAttribute("aria-expanded", open ? "true" : "false");
            });
            panel.querySelectorAll("a").forEach(function (link) {
                link.addEventListener("click", close);
            });
            document.addEventListener("keydown", function (e) {
                if (e.key === "Escape") close();
            });
        })();
