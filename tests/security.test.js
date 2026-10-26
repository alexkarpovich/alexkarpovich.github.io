const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const fs = require("node:fs");

const root = path.join(__dirname, "..");
const headers = Object.fromEntries([...fs.readFileSync(path.join(root, "_headers"), "utf8")
  .matchAll(/^  ([\w-]+): (.+)$/gm)].map(([, name, value]) => [name.toLowerCase(), value]));

function check(options = {}) {
  // Run the deployed-response checker with controlled responses, without network.
  const code = `
    const options = ${JSON.stringify(options)};
    process.argv[2] = "https://example.com/power-up/index.html";
    let requests = 0;
    globalThis.fetch = async url => {
      requests++;
      const headers = new Headers(${JSON.stringify(headers)});
      headers.set("content-type", "text/html; charset=utf-8");
      if (options.remove) headers.delete(options.remove);
      for (const [key, value] of Object.entries(options.set || {})) headers.set(key, value);
      return {
        status: options.status || 200, headers,
        url: options.redirect || url.href.replace(/\\.html$/, ""),
        body: { cancel: async () => {} }
      };
    };
    await import(${JSON.stringify(pathToFileURL(path.join(root, "scripts/check-security.mjs")).href)});
    if (requests !== 8) throw new Error("Check every deployed page");
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", code], { encoding: "utf8" });
}

test("deployed header checker accepts all eight pages with extensionless redirects", () => {
  const result = check();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.match(/Security headers OK:/g).length, 8);
});

test("deployed header checker rejects missing headers, weakened CSP and incompatible hosting", () => {
  for (const options of [
    { remove: "content-security-policy" },
    { remove: "strict-transport-security" },
    { set: { "strict-transport-security": "max-age=0" } },
    { set: { "content-security-policy": "default-src *; script-src 'unsafe-inline'" } },
    { set: { "content-security-policy": headers["content-security-policy"] + ", default-src 'none'" } },
    { set: { "x-frame-options": "SAMEORIGIN" } },
    { set: { "cross-origin-opener-policy": "same-origin" } },
    { set: { "content-type": "application/json" } },
    { redirect: "http://example.com/index.html" },
    { redirect: "https://another-host.example/index.html" },
    { status: 404 }
  ]) {
    const result = check(options);
    assert.notEqual(result.status, 0, JSON.stringify(options));
    assert.match(result.stderr, /AssertionError/, result.stderr);
  }
});
