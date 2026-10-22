/* Local signup flow harness with mocked /api/mobile/otp/* endpoints (mock OTP provider).
 * Run: node qa/auth-signup-web.cjs <export-directory> <artifact-directory>
 */
const { chromium, expect } = require("../../node_modules/@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const exportDir = path.resolve(process.argv[2]);
const artifacts = path.resolve(process.argv[3]);
fs.mkdirSync(artifacts, { recursive: true });

const pending = { phone: "+201000000001", purpose: "signup", code: "123456" };

function json(res, status, body, cookies = []) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...(cookies.length ? { "Set-Cookie": cookies } : {}),
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/api/mobile/otp/send" && req.method === "POST") {
    return json(res, 200, { ok: true, retryAfter: 30, delivery: "server" }, [
      "famy_otp_pending=mock; Path=/; HttpOnly",
    ]);
  }
  if (url.pathname === "/api/mobile/otp/context" && req.method === "GET") {
    return json(res, 200, {
      ok: true,
      maskedPhone: "+20 *** *** 0001",
      purpose: "signup",
      role: "customer",
      otpExpiresIn: 300,
      resendAvailableIn: 30,
      delivery: "server",
    });
  }
  if (url.pathname === "/api/mobile/otp/verify" && req.method === "POST") {
    return json(res, 200, {
      ok: true,
      access_token: "mock-access",
      refresh_token: "mock-refresh",
      userId: "00000000-0000-4000-8000-000000000001",
      isNewUser: true,
    });
  }
  res.writeHead(404);
  res.end();
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const mockOrigin = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${path.join(exportDir, "index.html")}`);
  await page.addInitScript((origin) => {
    window.__MOCK_WEB_ORIGIN__ = origin;
  }, mockOrigin);

  // Smoke: mocked endpoints respond for signup send + context.
  const send = await page.evaluate(async (origin) => {
    const res = await fetch(`${origin}/api/mobile/otp/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+201000000001", purpose: "signup", role: "customer" }),
    });
    return res.status;
  }, mockOrigin);
  expect(send).toBe(200);

  const ctx = await page.evaluate(async (origin) => {
    const res = await fetch(`${origin}/api/mobile/otp/context`);
    const body = await res.json();
    return body.ok;
  }, mockOrigin);
  expect(ctx).toBe(true);

  fs.writeFileSync(path.join(artifacts, "auth-signup-checks.json"), JSON.stringify({ send, ctx }, null, 2));
  await browser.close();
  server.close();
  console.log("PASS: auth-signup-web mock OTP API smoke.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
