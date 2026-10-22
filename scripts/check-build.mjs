import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import vm from "node:vm";

const out = new URL("../dist/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", out), "utf8"));
for (const [file, sizes] of Object.entries(manifest.assets)) {
  const code = await readFile(new URL(file, out), "utf8");
  assert.equal(Buffer.byteLength(code), sizes.bytes);
  assert.ok(file.includes(createHash("sha256").update(code).digest("hex").slice(0, 12)));
  if (file.endsWith(".js")) new vm.Script(code, { filename: file });
}

const connectorHtml = await readFile(new URL("index.html", out), "utf8");
assert.doesNotMatch(connectorHtml, /rel="stylesheet"/, "the invisible connector must not wait for styles");
for (const page of ["index", "card", "report", "settings"]) {
  const html = await readFile(new URL(`${page}.html`, out), "utf8");
  assert.equal([...html.matchAll(/<script /g)].length, 2, "one SDK and one application script");
  assert.doesNotMatch(html, /power-up\.css|js\/|auth-callback/);
  assert.match(html, /script defer src="assets\//);
}

// Execute the actual minified connector in a browser-shaped context. This catches
// accidental CommonJS transforms or broken concatenation that source tests miss.
let capabilities;
let options;
const window = {
  parent: {},
  location: { href: "https://example.com/project/index.html" },
  TrelloPowerUp: { initialize(value, opts) { capabilities = value; options = opts; } }
};
vm.runInNewContext(await readFile(new URL(manifest.pages["index.html"].js, out), "utf8"), {
  window, self: window, URL, console
});
assert.deepEqual(Object.keys(capabilities).sort(), [
  "authorization-status", "board-buttons", "card-back-section", "card-badges",
  "card-buttons", "card-detail-badges", "on-enable", "show-authorization", "show-settings"
]);
assert.ok(options.appKey);
assert.equal(capabilities["card-buttons"]()[0].icon, "https://example.com/project/img/icon.svg");
let minutes = 30;
const client = {
  getContext: () => ({ board: "board", card: "card" }),
  get: async scope => scope === "board" ? null : { e: [["entry", 20261020, minutes, 0]], who: [["me", "Me"]] }
};
assert.equal((await capabilities["card-badges"](client))[0].text, "30m");
minutes = 60;
assert.equal((await capabilities["card-badges"](client))[0].text, "1h", "completed results must not be cached");

// Exercise the persistent-cache path in the shipped, minified connector too.
const epicCard = { id: "built-epic", name: "Epic", checklists: [
  { id: "tasks", pos: 10, checkItems: [{ idCard: "built-task" }] },
  { id: "dependencies", pos: 20, checkItems: [{ idCard: "unavailable-dependency" }] }
] };
const taskCard = { id: "built-task", name: "Task", checklists: [] };
const shared = new Map([
  [epicCard.id, { time: { lc: [taskCard.id], lim: 120, e: [] } }],
  [taskCard.id, { time: { e: [["entry", 20261020, 30, 0]] } }]
]);
let scans = 0;
const cacheClient = {
  getContext: () => ({ board: "built-board", card: epicCard.id, permissions: { board: "write" } }),
  card: async () => epicCard,
  cards: async () => { scans++; return [epicCard, taskCard]; },
  get: async (scope, visibility, key, fallback) => {
    if (scope === "board") return fallback;
    const data = shared.get(scope === "card" ? epicCard.id : scope) || {};
    return structuredClone(key ? data[key] === undefined ? fallback : data[key] : data);
  },
  set: async (id, visibility, values) => { shared.set(id, { ...shared.get(id), ...values }); },
  remove: async (id, visibility, key) => { delete shared.get(id)[key]; }
};
await window.TimeRollupCache.loadCardChildren(cacheClient, epicCard, "", { shared: shared.get(epicCard.id) });
const beforeCachedBadge = scans;
assert.equal((await capabilities["card-badges"](cacheClient))[0].text, "1h 30m left");
assert.equal(scans, beforeCachedBadge, "a cached epic badge must not scan the board");
shared.get(epicCard.id).time.lc = ["unavailable-dependency"];
assert.equal((await capabilities["card-badges"](cacheClient))[0].text, "limit 2h", "changing owned links must reject the previous cache and keep missing dependencies unknown");

console.log("Production checks passed: resource hashes, budgets, script order, connector registration, fresh logs and persisted epic totals.");
