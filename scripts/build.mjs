import { readFile, writeFile, mkdir, readdir, cp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { transform } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.join(root, "dist");
const pages = ["index", "card", "report", "timeline", "settings", "auth-complete", "about", "privacy", "preview"];
// Preview also includes interactive regression checks; production card includes accessible card-name autocomplete.
// Settings includes bounded save waits. Card/preview include dependencies, planning and the FTE calendar.
const budgets = { index: 34000, card: 76000, report: 43000, settings: 22500, "auth-complete": 2000, timeline: 54000, preview: 88000 };
const manifest = { pages: {}, assets: {} };

// Only this script's output directory is replaced. Sources remain runnable.
await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "assets"), { recursive: true });
await cp(path.join(root, "img"), path.join(out, "img"), { recursive: true });
await writeFile(path.join(out, ".nojekyll"), "");

async function asset(name, extension, source) {
  const { code } = await transform(source, {
    loader: extension === "css" ? "css" : "js",
    minify: true,
    target: "es2020",
    legalComments: "none",
    charset: "utf8"
  });
  const bytes = Buffer.byteLength(code);
  if (extension === "js" && bytes > budgets[name]) {
    throw new Error(`${name}: ${bytes} bytes exceeds the ${budgets[name]} byte JS budget`);
  }
  const hash = createHash("sha256").update(code).digest("hex").slice(0, 12);
  const file = `assets/${name}.${hash}.${extension}`;
  await writeFile(path.join(out, file), code);
  manifest.assets[file] = {
    bytes,
    gzipBytes: gzipSync(code, { level: 9 }).length,
    brotliBytes: brotliCompressSync(code).length
  };
  return file;
}

const css = await asset("app", "css", await readFile(path.join(root, "css/app.css"), "utf8"));
for (const name of pages) {
  let html = await readFile(path.join(root, `${name}.html`), "utf8");
  const scripts = [...html.matchAll(/<script(?: defer)? src="(js\/[^"?]+)(?:\?[^"]*)?"><\/script>/g)];
  let js = null;
  let sourceBytes = 0;
  if (scripts.length) {
    const sources = await Promise.all(scripts.map(match => readFile(path.join(root, match[1]), "utf8")));
    sourceBytes = sources.reduce((sum, source) => sum + Buffer.byteLength(source), 0);
    // Explicit separators preserve independent IIFEs; order follows the source page.
    js = await asset(name, "js", sources.join("\n;\n"));
    for (const match of scripts) html = html.replace(match[0], "");
    html = html.replace("</head>", `  <script defer src="${js}"></script>\n</head>`);
  }
  html = html.replace('href="css/app.css"', `href="${css}"`);
  html = html.replace(/^\s*\n/gm, "").replace(/<!--[\s\S]*?-->/g, "");
  await writeFile(path.join(out, `${name}.html`), html);
  manifest.pages[`${name}.html`] = {
    js, css: html.includes(css) ? css : null,
    sourceScripts: scripts.length, sourceJsBytes: sourceBytes,
    productionScripts: js ? 1 : 0
  };
}

// Validate generated relative resources before publishing (also under /REPO/).
for (const name of await readdir(out)) {
  if (!name.endsWith(".html")) continue;
  const html = await readFile(path.join(out, name), "utf8");
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|tel:|#)/.test(match[1])) continue;
    await readFile(path.join(out, match[1].split("?")[0]));
  }
}
await writeFile(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
for (const [page, info] of Object.entries(manifest.pages)) {
  if (!info.js) continue;
  const sizes = manifest.assets[info.js];
  console.log(`${page}: ${info.sourceScripts} → 1 local JS requests; ${info.sourceJsBytes} → ${sizes.bytes} bytes (${sizes.gzipBytes} gzip)`);
}
