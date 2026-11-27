#!/usr/bin/env node
/**
 * Serves the production build (`vite build`, Nitro Vercel output) on loopback,
 * the way Vercel does: files from .vercel/output/static first, every other
 * request to the server function. Used by the e2e-local CI job so the suite
 * runs against what ships, not the dev server.
 *
 * Usage: node qa/local-ci/serve-build.mjs --port 8099
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalCiEnv } from "./env.mjs";

loadLocalCiEnv();
// Server-only values for the app's server functions. The service role key is
// the local stack's development key; it never reaches the browser bundle.
process.env.SUPABASE_SERVICE_ROLE_KEY ??= process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY;
process.env.AUTH_INTENT_SECRET ??= "local-ci-auth-intent-secret-not-used-in-any-deployment";
process.env.NODE_ENV ??= "production";
process.env.TZ ??= "UTC";

const portArg = process.argv.indexOf("--port");
const port = Number(portArg === -1 ? 8099 : process.argv[portArg + 1]);
const outDir = path.resolve(process.cwd(), ".vercel/output");
const staticDir = path.join(outDir, "static");
const handlerPath = path.join(outDir, "functions/__server.func/index.mjs");

if (!fs.existsSync(handlerPath)) {
  console.error("[serve-build] .vercel/output is missing. Run `npm run build` first.");
  process.exit(1);
}

const { default: handler } = await import(pathToFileURL(handlerPath).href);

const TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

function staticFileFor(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const resolved = path.resolve(staticDir, `.${decoded}`);
  if (!resolved.startsWith(staticDir + path.sep)) return null;
  try {
    const stat = fs.statSync(resolved);
    return stat.isFile() ? resolved : null;
  } catch {
    return null;
  }
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url ?? "/").split("?")[0];
  const file = req.method === "GET" || req.method === "HEAD" ? staticFileFor(urlPath) : null;
  if (file) {
    res.statusCode = 200;
    res.setHeader("content-type", TYPES[path.extname(file)] ?? "application/octet-stream");
    if (urlPath.startsWith("/assets/")) {
      res.setHeader("cache-control", "public, max-age=31536000, immutable");
    }
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
    return;
  }
  req.headers["x-forwarded-for"] ??= "127.0.0.1";
  // The Vercel launcher defines socket.remoteAddress once per request; Vercel
  // never reuses a socket, so neither do we.
  res.setHeader("connection", "close");
  Promise.resolve()
    .then(() => handler(req, res))
    .catch((error) => {
      console.error("[serve-build] handler error", error);
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[serve-build] http://127.0.0.1:${port}`);
});
