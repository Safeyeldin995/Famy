// Local preview only; do not send requests to production or other hosts.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("../../../../node_modules/@playwright/test");
const here = path.dirname(fileURLToPath(import.meta.url));
const origin = process.env.PARITY_WEB_ORIGIN || "http://127.0.0.1:5175";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("Local preview required");
const routes = {
  dashboard: "pro",
  jobs: "pro/bookings",
  booking: "pro/booking/booking-pro-pending-1",
  "booking-confirmed": "pro/booking/booking-pro-confirmed-1",
  "booking-completed": "pro/booking/booking-pro-completed-1",
  schedule: "pro/availability",
  earnings: "pro/earnings",
  messages: "messages",
  chat: "chat/conv-1",
  profile: "pro/profile",
  "profile-edit": "pro/profile",
  documents: "pro/documents",
  "setup-home": "pro?pending=1",
  "setup-personal": "pro/setup/personal",
  "setup-about": "pro/setup/about",
  "setup-hours": "pro/setup/hours",
  "setup-photo": "pro/setup/photo",
  "setup-babysitting": "pro/setup/babysitting",
  "setup-reference": "pro/setup/reference",
  "setup-subjects": "pro/setup/subjects",
  notifications: "pro/notifications",
  "notification-preferences": "pro/notification-preferences",
};
await fs.mkdir(path.join(here, "web"), { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: "ar-EG",
});
await context.addCookies([{ name: "famio_lang", value: "ar", url: origin }]);
await context.route("**/*", (route) => {
  const url = new URL(route.request().url());
  if (url.origin === origin) return route.continue();
  return route.abort();
});
const page = await context.newPage();
const results = [];
for (const [screen, route] of Object.entries(routes)) {
  if (process.argv[2] && !process.argv[2].split(",").includes(screen)) continue;
  const errors = [];
  const onError = (error) => errors.push(error.message);
  page.on("pageerror", onError);
  try {
    await page.goto(`${origin}/preview/${route}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.addStyleTag({
      content:
        'a[href="/preview"] { visibility:hidden !important; } div.brand-hero.shrink-0.px-4.py-2 {display:none!important}',
    });
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.fonts.ready);
    const text = (await page.locator("body").innerText()).trim();
    const ok =
      text.length > 30 &&
      !text.includes("الصفحة غير موجودة") &&
      !text.includes("Missing Supabase") &&
      !text.includes("Something went wrong") &&
      errors.length === 0;
    if (ok) await page.screenshot({ path: path.join(here, "web", `${screen}.png`) });
    results.push({ screen, route, captured: ok, errors, text: text.slice(0, 120) });
  } catch (error) {
    results.push({ screen, route, captured: false, error: String(error) });
  }
  page.off("pageerror", onError);
}
await fs.writeFile(path.join(here, "web-capture.json"), JSON.stringify(results, null, 2));
await browser.close();
if (results.some((item) => !item.captured)) process.exitCode = 1;
console.log(
  `${results.filter((item) => item.captured).length}/${results.length} provider web screens captured`,
);
