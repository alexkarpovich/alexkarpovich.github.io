(function () {
  const app = document.getElementById("app");
  if (window.parent === window || !window.TrelloPowerUp) {
    app.textContent = "Open this from Trello when enabling the Power-Up.";
    return;
  }
  const t = window.TimeRuntime.createIframe(window.TIMETRACK_CONFIG, window.TrelloPowerUp);
  if (!t) {
    app.textContent = "Could not connect to Trello. Reload the board.";
    return;
  }
  window.TimeTheme.bind(t);
  const h = window.TimeDom.h;
  const error = h("div", { class: "error", role: "alert" });
  const allow = h("button", { type: "button", class: "button mod-primary" }, "Allow read access");
  const skip = h("button", { type: "button", class: "button-link" }, "Not now");

  app.appendChild(h("div", { class: "settings" }, [
    h("p", null, "Once per account: allow read-only access so Time tracking can load checklist links and child cards for epic remaining time. Logging time does not need this permission."),
    error,
    allow,
    h("p", null, skip)
  ]));

  skip.addEventListener("click", function () {
    t.closePopup().catch(function () {});
  });

  allow.addEventListener("click", function () {
    allow.disabled = true;
    skip.disabled = true;
    error.textContent = "";
    window.TimeRuntime.authorizeReadAccess(t).then(function () {
      return t.closePopup();
    }).catch(function (err) {
      error.textContent = err.message || "Could not authorize.";
      allow.disabled = false;
      skip.disabled = false;
    });
  });

  t.render(function () {
    return window.TimeRuntime.isReadAuthorized(t).then(function (ok) {
      if (ok) return t.closePopup();
      return t.sizeTo("#app");
    });
  });
})();
