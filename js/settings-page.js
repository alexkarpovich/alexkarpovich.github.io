(function () {
  const app = document.getElementById("app");
  if (window.parent === window || !window.TrelloPowerUp) {
    app.textContent = "Open settings from the Power-Up menu on the board.";
    return;
  }
  const t = window.TrelloPowerUp.iframe();
  window.TimeTheme.bind(t);
  const h = window.TimeDom.h;
  let ready = false;

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
      : "No API key. Logging and reports work. For reliable checklist reads, set appKey in js/config.js."),
    error,
    button
  ]);
  app.appendChild(form);

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const next = window.TimeDuration.normalizeSettings({
      hoursPerDay: hours.value,
      daysPerWeek: days.value,
      weekStartsOn: week.value
    });
    button.disabled = true;
    t.set("board", "shared", "settings", next).then(function () {
      return t.closePopup();
    }).catch(function (err) {
      button.disabled = false;
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
      t.sizeTo("#app");
    });
  });
})();
