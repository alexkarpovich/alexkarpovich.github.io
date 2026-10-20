const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function source(file) {
  return fs.readFileSync(path.join(__dirname, "../js", file), "utf8");
}

function browserRuntime() {
  const context = {
    module: { exports: {} }, URL,
    window: { location: { href: "https://example.com/power-up/settings.html?context=private#context" } }
  };
  vm.runInNewContext(source("runtime.js"), context);
  return context.module.exports;
}

test("authorize opens synchronously from a click and uses the SDK returnUrl option", async () => {
  const runtime = browserRuntime();
  let opened = false;
  let saved = false;
  const api = {
    authorize(options) {
      opened = true;
      assert.equal(options.scope, "read");
      assert.equal(options.expiration, "never");
      assert.equal(options.returnUrl, "https://example.com/power-up/auth-complete.html");
      assert.equal(options.return_url, undefined);
      return Promise.resolve().then(() => { saved = true; });
    },
    isAuthorized: () => saved
  };
  const pending = runtime.authorizeReadAccess({ getRestApi: () => api });
  assert.equal(opened, true, "window.open must run in the click call stack");
  await pending;
  assert.equal(saved, true);
});

test("authorize supports promised REST clients and propagates denial or failed persistence", async () => {
  const runtime = browserRuntime();
  await runtime.authorizeReadAccess({
    getRestApi: () => Promise.resolve({ authorize: () => Promise.resolve("token"), isAuthorized: () => true })
  });
  await assert.rejects(runtime.authorizeReadAccess({
    getRestApi: () => ({ authorize: () => Promise.reject(new Error("denied")) })
  }), /denied/);
  await assert.rejects(runtime.authorizeReadAccess({
    getRestApi: () => ({ authorize: () => Promise.resolve("token"), isAuthorized: () => false })
  }), /not completed/);
  await assert.rejects(runtime.authorizeReadAccess({
    getRestApi: () => { throw new Error("not configured"); }
  }), /not configured/);
});

function callback(hash, { opener = true, blockedStorage = false } = {}) {
  const messages = [];
  const stored = new Map();
  const status = {};
  let cleanUrl;
  let closeScheduled = false;
  const window = {
    location: { hash, origin: "https://example.com", pathname: "/power-up/auth-complete.html", search: "" },
    history: { replaceState: (_, __, value) => { cleanUrl = value; } },
    opener: opener ? { postMessage: (token, origin) => { messages.push({ token, origin }); } } : null,
    localStorage: {
      setItem: (key, value) => {
        if (blockedStorage) throw new Error("blocked");
        stored.set(key, value);
      },
      removeItem: key => {
        if (blockedStorage) throw new Error("blocked");
        stored.delete(key);
      }
    },
    setTimeout: () => { closeScheduled = true; }
  };
  vm.runInNewContext(source("auth-complete.js"), {
    window, URLSearchParams, document: { getElementById: () => status }
  });
  return { messages, stored, status, cleanUrl, closeScheduled };
}

test("standalone callback forwards token without iframe context or browser storage", () => {
  const result = callback("#token=opaque%2Btoken%3D&other=value", { blockedStorage: true });
  assert.deepEqual(result.messages, [{ token: "opaque+token=", origin: "https://example.com" }]);
  assert.equal(result.cleanUrl, "/power-up/auth-complete.html");
  assert.equal(result.stored.size, 0);
  assert.equal(result.closeScheduled, true);
  assert.match(result.status.textContent, /granted/);
});

test("callback forwards cancellation and does not invent success without a token", () => {
  assert.deepEqual(callback("#token=").messages, [{ token: "", origin: "https://example.com" }]);
  const result = callback("");
  assert.equal(result.messages.length, 0);
  assert.equal(result.closeScheduled, false);
  assert.match(result.status.textContent, /No authorization result/);
});

test("callback supports lost opener and explains blocked storage without claiming success", () => {
  const fallback = callback("#token=opaque", { opener: false });
  assert.equal(fallback.stored.get("trello_token"), "opaque");
  const blocked = callback("#token=opaque", { opener: false, blockedStorage: true });
  assert.equal(blocked.closeScheduled, false);
  assert.match(blocked.status.textContent, /Could not return authorization/);
});

test("callback HTML runs an external script compatible with its CSP", () => {
  const html = fs.readFileSync(path.join(__dirname, "../auth-complete.html"), "utf8");
  assert.match(html, /script-src 'self'/);
  assert.match(html, /<script src="js\/auth-complete\.js(?:\?[^"]*)?"><\/script>/);
  assert.doesNotMatch(html, /<script\s*>/);
});
