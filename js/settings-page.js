(function () {
  const app = document.getElementById("app");
  if (window.parent === window || !window.TrelloPowerUp) {
    app.textContent = "Open settings from the Power-Up menu on the board.";
    return;
  }
  const t = window.TimeRuntime.createIframe(window.TIMETRACK_CONFIG, window.TrelloPowerUp);
  if (!t) {
    app.textContent = "Could not connect to Trello. Reload the board.";
    return;
  }
  window.TimeTheme.bind(t);
  const h = window.TimeDom.h;
  let ready = false;
  let saving = false;
  const canWrite = t.getContext().permissions && t.getContext().permissions.board === "write";

  const hours = h("input", { type: "number", min: "1", max: "24", required: "true", id: "hours" });
  const days = h("input", { type: "number", min: "1", max: "7", required: "true", id: "days" });
  const week = h("select", { id: "week" }, [
    h("option", { value: "1" }, "Monday"),
    h("option", { value: "0" }, "Sunday")
  ]);
  const error = h("div", { class: "error", role: "alert" });
  const button = h("button", { type: "submit", class: "button mod-primary" }, "Save");
  const form = h("form", { class: "settings" }, [
    h("label", null, ["Hours per work day", hours]),
    h("label", null, ["Days per work week", days]),
    h("label", null, ["Week starts on", week]),
    h("p", { class: "hint" }, "1d and 1w in entries and reports use these values. Already saved minutes are not rewritten."),
    h("p", { class: "hint" }, window.TIMETRACK_CONFIG && window.TIMETRACK_CONFIG.appKey
      ? "API key is set: epic checklists can be read directly."
      : "Basic time tracking works without extra authorization."),
    error,
    button
  ]);
  button.disabled = !canWrite;
  if (!canWrite) error.textContent = "This board is read-only.";

  let authSection = null;
  if (window.TIMETRACK_CONFIG && window.TIMETRACK_CONFIG.appKey) {
    const authStatus = h("p", { class: "hint", role: "status" });
    const connect = h("button", {
      type: "button",
      class: "button mod-primary",
      hidden: true
    }, "Allow read access (once)");
    connect.addEventListener("click", function () {
      connect.disabled = true;
      window.TimeRuntime.authorizeReadAccess(t).then(function () {
        return paintAuth();
      }).catch(function (err) {
        authStatus.textContent = err.message || "Could not authorize.";
      }).finally(function () {
        connect.disabled = false;
      });
    });
    const disconnect = h("button", {
      type: "button",
      class: "button-link",
      hidden: true,
      onclick: async function () {
        disconnect.disabled = true;
        try {
          const api = await window.TimeRuntime.restApi(t);
          await window.TimeRuntime.asPromise(api.clearToken());
          await paintAuth();
          authStatus.textContent = "Saved read-access token removed.";
        } catch (err) {
          authStatus.textContent = err.message || "Could not disconnect.";
        } finally { disconnect.disabled = false; }
      }
    }, "Forget saved read access");
    async function paintAuth() {
      const ok = await window.TimeRuntime.isReadAuthorized(t);
      connect.hidden = ok;
      disconnect.hidden = !ok;
      authStatus.textContent = ok
        ? "Read access is connected for this account (checklists and child cards via REST)."
        : "Epic remaining time needs one-time read access to load checklist items Trello hides from Power-Ups.";
    }
    authSection = h("section", { class: "settings" }, [
      h("h2", { style: "font-size:13px;margin:0 0 6px" }, "Epic checklists (once per account)"),
      h("p", { class: "hint" }, "Click Allow inside this panel (not in a new browser tab). Trello may open a small consent window — that is normal and only happens once."),
      connect,
      disconnect,
      authStatus,
      h("p", { class: "hint" }, [
        "To revoke at Trello, open ",
        h("a", { href: "https://trello.com/my/account", target: "_blank", rel: "noopener noreferrer" }, "account settings"),
        " → Applications."
      ])
    ]);
    paintAuth().catch(function () {});
  }

  app.textContent = "";
  if (authSection) app.appendChild(authSection);
  app.appendChild(form);

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!canWrite || saving) return;
    saving = true;
    const next = window.TimeDuration.normalizeSettings({
      hoursPerDay: hours.value,
      daysPerWeek: days.value,
      weekStartsOn: week.value
    });
    button.disabled = true;
    t.set("board", "shared", "settings", next).then(function () {
      return t.closePopup();
    }).catch(function (err) {
      saving = false;
      button.disabled = !canWrite;
      error.textContent = err.message || "Could not save settings.";
    });
  });

  t.render(function () {
    if (ready) return;
    return t.get("board", "shared", "settings", null).then(function (raw) {
      const settings = window.TimeDuration.normalizeSettings(raw);
      hours.value = String(settings.hoursPerDay);
      days.value = String(settings.daysPerWeek);
      week.value = String(settings.weekStartsOn);
      ready = true;
      return t.sizeTo("#app");
    }).catch(function (err) { error.textContent = err.message || "Could not load settings."; });
  });
})();
