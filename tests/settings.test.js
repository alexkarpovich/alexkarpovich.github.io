const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const duration = require("../js/duration");
const tick = () => new Promise(resolve => setImmediate(resolve));

// Small event/DOM adapter: run the production DOM helper and settings controller
// against a fake Trello client, without browser or network dependencies.
function harness({ raw = {}, writable = true, get, set, closePopup } = {}) {
  let document;
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; this.value = ""; this.disabled = false; }
    setAttribute(key, value) {
      this.attrs[key] = value;
      if (["disabled", "hidden", "required"].includes(key)) this[key] = true;
      else this[key] = value;
    }
    appendChild(child) { this.children.push(child); return child; }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
    get firstChild() { return this.children[0]; }
    set textContent(text) { this.children = []; this.text = text; }
    get textContent() { return (this.text || "") + this.children.map(child => child.textContent).join(""); }
    addEventListener(type, callback) { (this.events[type] ||= []).push(callback); }
    fire(type) { if (!this.disabled) (this.events[type] || []).forEach(fn => fn({ preventDefault() {} })); }
    focus() { document.activeElement = this; }
    reportValidity() { return true; }
  }
  const app = new Element("div");
  document = { getElementById: () => app, createElement: tag => new Element(tag), createTextNode: text => ({ textContent: String(text) }) };
  let render;
  let saved;
  let fail = false;
  let closed = false;
  let writes = 0;
  const timers = new Map();
  const client = {
    getContext: () => ({ permissions: { board: writable ? "write" : "read" } }),
    get: get || (async () => raw),
    set: async (scope, visibility, key, value) => {
      writes++;
      assert.deepEqual([scope, visibility, key], ["board", "shared", "settings"]);
      if (fail) throw new Error("Save failed");
      if (set) await set(value);
      saved = value;
    },
    render: callback => { render = callback; },
    sizeTo: async () => {}, closePopup: closePopup || (async () => { closed = true; })
  };
  const window = {
    parent: {}, TrelloPowerUp: {}, TIMETRACK_CONFIG: {},
    TimeRuntime: { createIframe: () => client }, TimeTheme: { bind() {} }, TimeDuration: duration
  };
  const context = vm.createContext({ window, self: window, document, console,
    setTimeout: (callback, delay) => { timers.set(callback, delay); return callback; },
    clearTimeout: callback => timers.delete(callback)
  });
  for (const file of ["dom.js", "settings-page.js"]) vm.runInContext(fs.readFileSync(require.resolve("../js/" + file), "utf8"), context);
  function all(node = app) { return [node, ...(node.children || []).flatMap(child => all(child))]; }
  const find = predicate => all().find(predicate);
  return {
    render: () => render(), saved: () => saved, closed: () => closed, fail: value => { fail = value; },
    writes: () => writes, timerCount: () => timers.size,
    expire: () => { for (const [callback, delay] of timers) { assert.equal(delay, 15000); timers.delete(callback); callback(); } },
    byId: id => find(node => node.id === id),
    label: label => find(node => node.attrs?.["aria-label"] === label),
    day: day => find(node => node.className?.split(" ").includes("settings-day") && node.textContent === String(day)),
    form: () => find(node => node.tag === "form"),
    saveButton: () => find(node => node.type === "submit"),
    status: () => find(node => node.className === "status").textContent,
    error: () => find(node => node.attrs?.role === "alert").textContent
  };
}

test("settings save several dates across months and preserve legacy exclusions", async () => {
  const h = harness({ raw: { excludedDates: ["2020-01-01"] } });
  assert.equal(h.saveButton().disabled, true, "cannot overwrite settings before they load");
  await h.render();
  assert.equal(h.byId("month-days").value, "20");
  const now = new Date();
  const first = duration.formatYmd(new Date(now.getFullYear(), now.getMonth(), 5));
  const second = duration.formatYmd(new Date(now.getFullYear(), now.getMonth() + 1, 7));
  h.day(5).fire("click");
  h.day(6).fire("click");
  h.day(6).fire("click");
  h.label("Next month").fire("click");
  h.day(7).fire("click");
  h.label("Previous month").fire("click");
  assert.equal(h.day(5).attrs["aria-pressed"], "true");
  assert.equal(h.day(6).attrs["aria-pressed"], "false");
  h.byId("hours").value = "6";
  h.byId("days").value = "4";
  h.byId("month-days").value = "22";
  h.byId("week").value = "0";
  h.byId("week").fire("change");
  await h.render(); // Trello refresh must not discard unsaved edits.
  h.form().fire("submit");
  await tick();
  assert.deepEqual(h.saved(), { hoursPerDay: 6, daysPerWeek: 4, daysPerMonth: 22, weekStartsOn: 0, excludedDates: ["2020-01-01", first, second].sort() });
  assert.equal(h.closed(), true);
});

test("failed saves retain edits and allow retry", async () => {
  const h = harness();
  await h.render();
  h.day(12).fire("click");
  h.byId("month-days").value = "21";
  h.fail(true);
  h.form().fire("submit");
  assert.equal(h.saveButton().disabled, true);
  await tick();
  assert.equal(h.error(), "Save failed");
  assert.equal(h.day(12).attrs["aria-pressed"], "true");
  assert.equal(h.byId("month-days").value, "21");
  assert.equal(h.saveButton().disabled, false);
  h.fail(false);
  h.form().fire("submit");
  await tick();
  assert.equal(h.saved().daysPerMonth, 21);
  assert.equal(h.saved().excludedDates.length, 1);
});

test("read-only boards and failed reads cannot overwrite settings", async () => {
  for (const options of [{ writable: false }, { get: async () => { throw new Error("Load failed"); } }]) {
    const h = harness(options);
    await h.render();
    assert.equal(h.byId("hours").disabled, true);
    assert.equal(h.byId("month-days").disabled, true);
    assert.equal(h.day(10).disabled, true);
    h.form().fire("submit");
    await tick();
    assert.equal(h.saved(), undefined);
    assert.ok(h.error());
  }
});

test("saved dates can be removed directly from the selection list", async () => {
  const h = harness({ raw: { excludedDates: ["2020-01-01", "2020-01-02"] } });
  await h.render();
  h.label("Remove 2020-01-01").fire("click");
  h.form().fire("submit");
  await tick();
  assert.deepEqual(h.saved().excludedDates, ["2020-01-02"]);
});

test("successful saves unlock even if closing the popup does nothing, hangs or fails", async () => {
  for (const closePopup of [() => undefined, () => new Promise(() => {}), () => Promise.reject(new Error("No popup")), () => { throw new Error("No popup"); }]) {
    const h = harness({ closePopup });
    await h.render();
    h.day(12).fire("click");
    h.form().fire("submit");
    await tick();
    assert.equal(h.saved().excludedDates.length, 1);
    assert.equal(h.saveButton().disabled, false);
    assert.equal(h.saveButton().textContent, "Save settings");
    assert.equal(h.byId("hours").disabled, false);
    assert.equal(h.day(12).disabled, false);
    assert.equal(h.status(), "Settings saved.");
    assert.equal(h.error(), "");
    assert.equal(h.timerCount(), 0);
    h.day(13).fire("click");
    assert.equal(h.status(), "", "changed dates must not still be labelled saved");
  }
});

test("missing write replies time out without losing dates or claiming success", async () => {
  let resolveWrite;
  const h = harness({ set: () => new Promise(resolve => { resolveWrite = resolve; }) });
  await h.render();
  h.day(12).fire("click");
  h.form().fire("submit");
  h.form().fire("submit");
  await tick();
  assert.equal(h.writes(), 1, "ignore duplicate submissions while awaiting Trello");
  assert.equal(h.saveButton().disabled, true);
  h.expire();
  await tick();
  assert.equal(h.saveButton().disabled, false);
  assert.equal(h.saveButton().textContent, "Save settings");
  assert.equal(h.day(12).attrs["aria-pressed"], "true");
  assert.match(h.error(), /did not confirm saving/);
  assert.equal(h.status(), "");
  assert.equal(h.closed(), false);
  assert.equal(h.timerCount(), 0);
  h.day(13).fire("click");
  resolveWrite();
  await tick();
  assert.equal(h.closed(), false, "a late reply must not close a form with new edits");
  assert.equal(h.status(), "", "a late reply must not label new edits saved");
  assert.equal(h.day(13).attrs["aria-pressed"], "true");
});
