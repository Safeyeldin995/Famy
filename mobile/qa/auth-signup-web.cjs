/* Local signup flow harness with mocked /api/mobile/otp/* endpoints (mock OTP provider).
 * Run: node qa/auth-signup-web.cjs <export-directory> <artifact-directory>
 */
const { chromium, expect } = require("../../node_modules/@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { waitForLaunchGateGone } = require("./waitLaunchGate.cjs");

const exportDir = path.resolve(process.argv[2]);
const artifacts = path.resolve(process.argv[3]);
fs.mkdirSync(artifacts, { recursive: true });

const INTENTS_HEADER = "X-Famy-Auth-Intents";
const pending = { phone: "+201000000001", purpose: "signup", code: "123456" };
let storedIntents = { otpPending: null, setPassword: null };

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Famy-Auth-Intents");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function json(res, status, body) {
  cors(res);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readRequestIntents(req) {
  const raw = req.headers[INTENTS_HEADER.toLowerCase()];
  if (!raw || typeof raw !== "string") return;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      storedIntents = {
        otpPending: parsed.otpPending ?? null,
        setPassword: parsed.setPassword ?? null,
      };
    }
  } catch {
    // ignore malformed header
  }
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  readRequestIntents(req);
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/api/mobile/otp/send" && req.method === "POST") {
    storedIntents = {
      otpPending: "mock-signed-otp-intent-token",
      setPassword: null,
    };
    return json(res, 200, {
      ok: true,
      retryAfter: 30,
      delivery: "server",
      intents: storedIntents,
    });
  }
  if (url.pathname === "/api/mobile/otp/context" && req.method === "GET") {
    if (!storedIntents.otpPending) {
      return json(res, 404, { ok: false, error: "intent_missing", intents: storedIntents });
    }
    return json(res, 200, {
      ok: true,
      maskedPhone: "+20 *** *** 0001",
      purpose: "signup",
      role: "customer",
      otpExpiresIn: 300,
      resendAvailableIn: 30,
      delivery: "server",
      intents: storedIntents,
    });
  }
  if (url.pathname === "/api/mobile/otp/verify" && req.method === "POST") {
    storedIntents = { otpPending: null, setPassword: "mock-set-password-intent" };
    return json(res, 200, {
      ok: true,
      access_token: "mock-access",
      refresh_token: "mock-refresh",
      userId: "00000000-0000-4000-8000-000000000001",
      isNewUser: true,
      intents: storedIntents,
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
  await waitForLaunchGateGone(page);
  await page.addInitScript((origin) => {
    window.__MOCK_WEB_ORIGIN__ = origin;
  }, mockOrigin);

  const send = await page.evaluate(
    async ({ origin, headerName }) => {
      const res = await fetch(`${origin}/api/mobile/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "+201000000001", purpose: "signup", role: "customer" }),
      });
      const body = await res.json();
      return { status: res.status, intents: body.intents };
    },
    { origin: mockOrigin, headerName: INTENTS_HEADER },
  );
  expect(send.status).toBe(200);
  expect(send.intents?.otpPending).toBeTruthy();

  const ctx = await page.evaluate(
    async ({ origin, headerName, intents }) => {
      const res = await fetch(`${origin}/api/mobile/otp/context`, {
        headers: {
          [headerName]: JSON.stringify(intents),
        },
      });
      const body = await res.json();
      return body.ok;
    },
    {
      origin: mockOrigin,
      headerName: INTENTS_HEADER,
      intents: send.intents,
    },
  );
  expect(ctx).toBe(true);

  fs.writeFileSync(path.join(artifacts, "auth-signup-checks.json"), JSON.stringify({ send, ctx }, null, 2));
  await browser.close();
  server.close();
  console.log("PASS: auth-signup-web mock OTP API smoke.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
