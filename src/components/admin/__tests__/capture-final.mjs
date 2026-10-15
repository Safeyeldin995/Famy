import { chromium } from "playwright";
import assert from "node:assert/strict";
const origin = "http://127.0.0.1:4176";
const routes = [
  "",
  "operations",
  "monitoring",
  "providers",
  "provider/p-pending",
  "customers",
  "customer/preview-user-00000000-0000-0000-0000-000000000001",
  "bookings",
  "cases",
  "payments",
  "payment-methods",
  "cancellation-reasons",
  "services",
  "zones",
  "promo-codes",
  "campaigns",
  "audit-log",
  "settings",
];
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 800 },
    });
    await context.addCookies([{ name: "famio_lang", value: "ar", url: origin }]);
    const page = await context.newPage();
    const issues = [],
      api = [];
    page.on("pageerror", (e) => issues.push(e.message));
    page.on("console", (m) => {
      if (/hydration|hydrated|didn't match|server rendered/i.test(m.text())) issues.push(m.text());
    });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      // Read-only public presentation assets; never allow a remote API or auth endpoint.
      if (
        route.request().method() === "GET" &&
        /^(fonts.googleapis.com|fonts.gstatic.com|[abc].tile.openstreetmap.org)$/.test(url.hostname)
      )
        return route.continue();
      if (url.origin !== origin && !["data:", "blob:"].includes(url.protocol)) {
        api.push({ origin: url.origin, method: route.request().method() });
        return route.abort();
      }
      return route.continue();
    });
    for (const route of routes) {
      const initial = issues.length;
      await page.goto(origin + "/preview/admin" + (route ? "/" + route : ""), {
        waitUntil: "networkidle",
      });
      await page.locator('[data-admin-preview-ready="true"]').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const result = await page.evaluate(() => ({
        height: document.documentElement.scrollHeight,
        overflow: document.documentElement.scrollWidth > innerWidth,
        text: document.body.innerText,
        tabs: [...document.querySelectorAll("[data-admin-mobile-tabs] a")].map(
          (a) => a.getBoundingClientRect().height,
        ),
        activeVisible: (() => {
          const nav = document.querySelector("[data-admin-mobile-tabs]");
          const active = nav?.querySelectorAll('[aria-current="page"]');
          const a = nav?.querySelector('[data-admin-active="true"]');
          if (!a || active?.length !== 1 || active[0] !== a) return false;
          const x = a.getBoundingClientRect(),
            n = nav.getBoundingClientRect();
          return x.left >= n.left && x.right <= n.right;
        })(),
      }));
      assert.equal(result.overflow, false, "overflow: " + route);
      if (width === 390) {
        assert(
          result.tabs.every((h) => h >= 44),
          "tab targets",
        );
        assert(result.activeVisible, "active tab: " + route);
      }
      assert(
        !/adminFinal\.|\b(FAILED|SUBMITTED|Admin User)\b/.test(result.text),
        "raw labels: " + route,
      );
      assert.deepEqual(issues.slice(initial), [], "hydration/runtime: " + route);
      const name = route.startsWith("customer/")
        ? "customer-detail"
        : route.replaceAll("/", "-") || "home";
      await page.screenshot({
        path: "docs/admin-audit/final-" + name + "-" + width + ".png",
        fullPage: true,
      });
      console.log(
        JSON.stringify({ route: route || "home", width, height: result.height, errors: 0 }),
      );
    }
    assert.deepEqual(api, [], "no remote resources or unseeded queries");
    await context.close();
  }
} finally {
  await browser.close();
}
