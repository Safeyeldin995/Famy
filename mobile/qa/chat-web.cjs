/* Local-only UI fixtures for customer chat. Run from mobile:
 * node qa/chat-web.cjs <export-directory> <artifact-directory>
 */
const { chromium, expect } = require("../../node_modules/@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");

const exportDir = path.resolve(process.argv[2]);
const artifacts = path.resolve(process.argv[3]);
fs.mkdirSync(artifacts, { recursive: true });
const config = require("../app.json").expo.extra;
const apiOrigin = new URL(config.supabaseUrl).origin;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const uid = id(1);
const pid = id(2);
const bid = id(3);
const cid = id(4);
const now = new Date().toISOString();

let conversations = [
  {
    id: cid,
    booking_id: bid,
    customer_id: uid,
    provider_user_id: pid,
    updated_at: now,
  },
];
let messages = [
  {
    id: id(10),
    conversation_id: cid,
    sender_id: pid,
    sender_role: "provider",
    message_type: "text",
    system_key: null,
    body: "رسالة اختبار محلية",
    created_at: now,
  },
];
let reads = [];
let mode = "list";
const user = {
  id: uid,
  aud: "authenticated",
  role: "authenticated",
  created_at: now,
  app_metadata: {},
  user_metadata: {},
};
const payload = Buffer.from(
  JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 86400, role: "authenticated" }),
).toString("base64url");
const session = {
  access_token: `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")}.${payload}.local-fixture-only`,
  refresh_token: "local-fixture-only",
  token_type: "bearer",
  expires_at: Math.floor(Date.now() / 1000) + 86400,
  expires_in: 86400,
  user,
};
const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".json": "application/json",
};
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  let file = path.resolve(exportDir, `.${pathname}`);
  if (!file.startsWith(exportDir + path.sep) && file !== exportDir) {
    res.writeHead(403);
    return res.end();
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
    file = path.join(exportDir, "index.html");
  res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});
const screenshots = [];
const errors = [];
let browser;

async function run() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ar-EG",
  });
  await context.addInitScript(
    ({ key, session }) => {
      localStorage.setItem("famy.lang", "ar");
      localStorage.setItem(key, JSON.stringify(session));
    },
    { key: `sb-${new URL(apiOrigin).hostname.split(".")[0]}-auth-token`, session },
  );
  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === base) return route.continue();
    if (url.origin !== apiOrigin) {
      errors.push(`Unexpected external request: ${url.pathname}`);
      return route.abort();
    }
    const table = url.pathname.split("/").at(-1);
    const method = req.method();
    const body = req.postDataJSON();
    if (url.pathname.includes("/auth/"))
      return route.fulfill({ json: url.pathname.endsWith("/user") ? user : session });
    if (url.pathname.includes("/realtime/")) return route.fulfill({ status: 200, json: {} });
    if (mode === "error" && method === "GET" && table === "conversations")
      return route.fulfill({ status: 503, json: { message: "Isolated test failure" } });
    if (!["GET", "HEAD"].includes(method) && !url.pathname.includes("/rpc/")) {
      if (table === "messages" && method === "POST") {
        messages.push({
          id: id(20 + messages.length),
          conversation_id: body.conversation_id,
          sender_id: uid,
          sender_role: "customer",
          message_type: "text",
          system_key: null,
          body: body.body,
          created_at: new Date().toISOString(),
        });
      }
      if (table === "booking_message_reads" && method === "POST") {
        reads = [{ booking_id: bid, user_id: uid, last_read_at: new Date().toISOString() }];
      }
      return route.fulfill({ json: messages.at(-1) ?? {} });
    }
    let data;
    if (url.pathname.includes("/rpc/")) {
      if (table === "booking_party_profiles")
        data = [
          {
            booking_id: bid,
            other_user_id: pid,
            other_name: "مقدمة خدمة - اختبار محلي",
            other_avatar_url: null,
          },
        ];
      else data = [];
    } else {
      const tables = {
        profiles: [{ id: uid, full_name: "حساب اختبار محلي" }],
        user_roles: [{ role: "customer" }],
        conversations: mode === "empty" ? [] : conversations,
        messages: mode === "empty" ? [] : messages,
        booking_message_reads: reads,
      };
      data = tables[table] ?? [];
      const convFilter = url.searchParams.get("conversation_id");
      if (convFilter?.startsWith("eq."))
        data = data.filter((row) => row.conversation_id === convFilter.slice(3));
      const inFilter = url.searchParams.get("conversation_id");
      if (inFilter?.startsWith("in.("))
        data = data.filter((row) => inFilter.includes(row.conversation_id));
      if (url.searchParams.get("order")?.includes("created_at"))
        data = [...data].sort((a, b) => a.created_at.localeCompare(b.created_at));
      if (url.searchParams.get("order")?.includes("updated_at.desc"))
        data = [...data].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    }
    const count = Array.isArray(data) ? data.length : data ? 1 : 0;
    if (req.headers().accept?.includes("vnd.pgrst.object")) data = Array.isArray(data) ? data[0] || null : data;
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-range": `0-${Math.max(0, count - 1)}/${count}`,
        "access-control-expose-headers": "content-range",
      },
      body: method === "HEAD" ? "" : JSON.stringify(data),
    });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    // Realtime WebSockets can't be intercepted by page.route; a failed socket
    // to the (blocked) live host is expected in sandboxed runs and not a UI error.
    if (msg.type() === "error" && mode !== "error" && !/WebSocket connection/.test(msg.text()))
      errors.push(msg.text());
  });
  const ts = require("../../node_modules/typescript");
  const mod = { exports: {} };
  new Function(
    "exports",
    "module",
    ts.transpile(fs.readFileSync(path.resolve(__dirname, "../../src/lib/i18n/locales/ar.ts"), "utf8"), {
      module: ts.ModuleKind.CommonJS,
    }),
  )(mod.exports, mod);
  const ar = mod.exports.default;

  async function visit(route) {
    await page.goto(base + route);
    await page.evaluate(() => document.fonts.ready);
  }
  async function shot(name) {
    const file = path.join(artifacts, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    screenshots.push({ screen: name, path: file, viewport: "390x844", language: "ar" });
  }

  mode = "list";
  await visit("/messages");
  await expect(page.getByTestId("conversation-list")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("conversation-unread")).toBeVisible();
  await shot("messages-list");

  mode = "empty";
  await visit("/messages");
  await expect(page.getByText(ar.messages.emptyTitle, { exact: false })).toBeVisible();
  await shot("messages-empty");

  mode = "list";
  await visit(`/chat/${cid}`);
  await expect(page.getByTestId("chat-thread")).toBeVisible({ timeout: 20000 });
  await shot("chat-open");

  await page.getByTestId("chat-input").fill("رد اختبار محلي");
  await page.getByTestId("chat-send").click();
  await expect(page.getByText("رد اختبار محلي", { exact: true })).toBeVisible();
  await shot("chat-sent");

  messages.push({
    id: id(99),
    conversation_id: cid,
    sender_id: pid,
    sender_role: "provider",
    message_type: "text",
    system_key: null,
    body: "رسالة واردة محاكاة",
    created_at: new Date(Date.now() + 1000).toISOString(),
  });
  await page.reload();
  await expect(page.getByText("رسالة واردة محاكاة", { exact: true })).toBeVisible();
  await shot("chat-incoming");

  mode = "error";
  const errorPage = await context.newPage();
  errorPage.on("pageerror", (e) => errors.push(e.message));
  await errorPage.goto(base + "/messages");
  await expect(errorPage.getByText(ar.common.somethingWentWrong, { exact: false })).toBeVisible({
    timeout: 20000,
  });
  const errorFile = path.join(artifacts, "messages-error.png");
  await errorPage.screenshot({ path: errorFile, fullPage: false });
  screenshots.push({ screen: "messages-error", path: errorFile, viewport: "390x844", language: "ar" });

  assert.equal(errors.length, 0, errors.join("\n"));
  fs.writeFileSync(path.join(artifacts, "screenshots.json"), JSON.stringify(screenshots, null, 2));
  fs.writeFileSync(
    path.join(artifacts, "verification.json"),
    JSON.stringify({ passed: true, screenshots: screenshots.length }, null, 2),
  );
  console.log(`PASS: ${screenshots.length} Arabic chat screenshots (390x844).`);
}

run()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    server.close();
  });
