// Generates dist/client/index.html so the built web app can be served as a
// static shell inside the Capacitor WebView (Capacitor's webDir needs an
// index.html; the TanStack Start build only emits hashed assets).
//
// The TanStack Start client hydrates the *whole document*, so the shell mirrors
// the SSR document shape: head (meta + stylesheet) and an empty body with the
// entry module script. No #root div is needed — the client renders the full
// html/head/body tree.
//
// Run after `vite build` (see package.json "build:mobile").
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = join(SCRIPT_DIR, "..", "dist", "client");
const ASSETS_DIR = join(CLIENT_DIR, "assets");

const files = await readdir(ASSETS_DIR);
const css = files.find((f) => f.endsWith(".css"));
const js = files.filter((f) => f.endsWith(".js") && f.startsWith("index-"));

// The entry module is the largest index-*.js chunk (the router + app shell);
// route chunks load lazily from the same /assets dir.
const sizes = await Promise.all(
  js.map(async (f) => (await readFile(join(ASSETS_DIR, f))).byteLength),
);
const entry = js[sizes.indexOf(Math.max(...sizes))];

if (!entry || !css) {
  throw new Error("Build output missing: expected dist/client/assets/index-*.js and app-*.css");
}

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0B0B0F" />
    <title>HashHustle - Gamified Bitcoin Mining & Stacking</title>
    <link rel="stylesheet" href="/assets/${css}" />
  </head>
  <body>
    <noscript>HashHustle needs JavaScript enabled to mine sats.</noscript>
    <script type="module" src="/assets/${entry}"></script>
  </body>
</html>
`;

await writeFile(join(CLIENT_DIR, "index.html"), html);
console.log(`[gen-cap-html] wrote dist/client/index.html (entry=${entry}, css=${css})`);
