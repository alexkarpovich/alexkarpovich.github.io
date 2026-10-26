import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const input = process.argv[2];
assert.ok(input, "Usage: npm run check:security -- https://YOUR-HOST/index.html");
const connector = new URL(input);
assert.equal(connector.protocol, "https:", "Use the public HTTPS connector URL");
assert.ok(!connector.username && !connector.password && !connector.search && !connector.hash,
  "Do not include credentials, query parameters or fragments");
const expected = [...(await readFile(new URL("../_headers", import.meta.url), "utf8"))
  .matchAll(/^  ([\w-]+): (.+)$/gm)].map(([, name, value]) => [name.toLowerCase(), value]);

function directives(value) {
  return new Map(value.split(";").filter(part => part.trim()).map(part => {
    const [name, ...tokens] = part.trim().split(/\s+/);
    return [name, tokens.sort().join(" ")];
  }));
}

// Check the actual deployed responses, not just HTML meta tags or local config.
for (const page of ["index.html", "card.html", "report.html", "settings.html", "auth-complete.html", "about.html", "privacy.html", "preview.html"]) {
  const url = new URL(page, connector);
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000) });
  try {
    assert.equal(response.status, 200, `${url}: expected HTTP 200`);
    const final = new URL(response.url);
    assert.equal(final.protocol, "https:", `${url}: HTTPS redirect required`);
    assert.equal(final.origin, connector.origin, `${url}: unexpected origin after redirect`);
    assert.match(response.headers.get("content-type") || "", /^text\/html\b/i, `${url}: expected HTML`);
    for (const [name, value] of expected) {
      const actual = response.headers.get(name);
      assert.ok(actual, `${url}: missing ${name}`);
      if (name === "content-security-policy") {
        // Multiple CSPs intersect and may unexpectedly block Trello or the SDK.
        assert.ok(!actual.includes(","), `${url}: multiple CSP policies require manual review`);
        assert.deepEqual(directives(actual), directives(value), `${url}: unexpected CSP`);
      } else {
        assert.equal(actual, value, `${url}: unexpected ${name}`);
      }
    }
    assert.ok(!response.headers.has("x-frame-options"), `${url}: X-Frame-Options may block the Trello iframe; use CSP frame-ancestors`);
    assert.ok([null, "unsafe-none", "same-origin-allow-popups"].includes(response.headers.get("cross-origin-opener-policy")),
      `${url}: COOP may break the authorization popup`);
    console.log(`Security headers OK: ${url} → ${final.pathname}`);
  } finally {
    await response.body?.cancel();
  }
}
