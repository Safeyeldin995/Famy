// Local preview only. Never forwards a browser request to a remote host.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("../../../node_modules/@playwright/test");
const out = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const base = "http://127.0.0.1:5173";
let fontCss = "";
for (const [family, directory, weights] of [
  [
    "Almarai",
    "almarai",
    [
      [400, "400Regular"],
      [700, "700Bold"],
      [800, "800ExtraBold"],
    ],
  ],
  [
    "Manrope",
    "manrope",
    [
      [400, "400Regular"],
      [700, "700Bold"],
      [800, "800ExtraBold"],
    ],
  ],
]) {
  for (const [weight, folder] of weights) {
    const bytes = await fs.readFile(
      path.resolve(
        "mobile/node_modules/@expo-google-fonts",
        directory,
        folder,
        `${family}_${folder}.ttf`,
      ),
    );
    fontCss += `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/ttf;base64,${bytes.toString("base64")}) format('truetype');}`;
  }
}
const screens = {
  onboarding: "onboarding",
  home: "home",
  search: "search",
  "category-babysitting": "category/babysitting",
  "category-tutoring": "category/tutoring",
  provider: "provider/p1",
  "booking-step-1": "book/p1",
  bookings: "bookings",
  "booking-detail": "bookings?bookingId=booking-preview-1",
  messages: "messages",
  chat: "chat/conv-1",
  notifications: "notifications",
  profile: "profile",
  addresses: "addresses",
  "family-members": "family-members",
  "family-member-new": "family-members?memberId=new",
  favorites: "favorites",
  "promo-codes": "promo-codes",
  help: "help",
  "delete-account": "account/delete",
  dashboard: "pro",
  jobs: "pro/bookings",
  schedule: "pro/availability",
  earnings: "pro/earnings",
  "pro-profile": "pro/profile",
  "pro-documents": "pro/documents",
  "pro-setup-home": "pro?pending=1",
  "pro-notifications": "pro/notifications",
  "pro-setup-personal": "pro/setup/personal",
  "pro-setup-subjects": "pro/setup/subjects",
  "pro-setup-hours": "pro/setup/hours",
  "pro-setup-photo": "pro/setup/photo",
  "pro-setup-about": "pro/setup/about",
  "pro-setup-babysitting": "pro/setup/babysitting",
  "pro-setup-reference": "pro/setup/reference",
};
await fs.mkdir(path.join(out, "web"), { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: "ar-EG",
});
await context.addCookies([{ name: "famio_lang", value: "ar", url: base }]);
await context.route("**/*", (route) => {
  const url = new URL(route.request().url());
  if (url.origin === base) return route.continue();
  if (url.hostname === "fonts.googleapis.com")
    return route.fulfill({ contentType: "text/css", body: fontCss });
  return route.abort();
});
const page = await context.newPage();
const results = [];
try {
  for (const [screen, route] of Object.entries(screens)) {
    const errors = [];
    const listener = (error) => errors.push(error.message);
    page.on("pageerror", listener);
    try {
      await page.goto(`${base}/preview/${route}`, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForFunction(() => (document.body.innerText || "").trim().length > 30, {
        timeout: 15000,
      });
      await page.waitForTimeout(1800);
      await page.evaluate(() => document.fonts.ready);
      // Remove only preview navigation chrome, never application elements.
      await page.addStyleTag({
        content:
          'a[href="/preview"] { visibility:hidden !important; } div.brand-hero.shrink-0.px-4.py-2 {display:none!important}',
      });
      await page.screenshot({ path: path.join(out, "web", `${screen}.png`) });
      const text = await page.locator("body").innerText();
      const captured = text.trim().length > 30 && !text.includes("الصفحة غير موجودة");
      results.push({ screen, route, errors, text: text.slice(0, 160), captured });
      if (screen === "onboarding") {
        for (const step of [2, 3]) {
          await page.getByRole("button", { name: "متابعة", exact: true }).click();
          await page.screenshot({ path: path.join(out, "web", `onboarding-${step}.png`) });
        }
      }
      console.log(`Captured web ${screen}`);
    } catch (error) {
      results.push({ screen, route, captured: false, error: error.message });
      console.log(`Capture failed: ${screen}`);
    }
    page.off("pageerror", listener);
  }
} finally {
  await fs.writeFile(path.join(out, "web-capture.json"), JSON.stringify(results, null, 2));
  await browser.close();
}
