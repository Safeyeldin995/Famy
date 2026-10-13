import { chromium } from "playwright";
import assert from "node:assert/strict";
const origin = "http://127.0.0.1:4175";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 800 },
    });
    await context.addCookies([{ name: "famio_lang", value: "ar", url: origin }]);
    const page = await context.newPage();
    const errors = [];
    const writes = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // Inert local Supabase endpoint only. Unexpected queries are evidence of missing seeds.
    await page.route("http://127.0.0.1:65432/**", async (route) => {
      writes.push({ method: route.request().method(), url: route.request().url() });
      await route.abort();
    });
    for (const route of [
      "services",
      "zones",
      "promo-codes",
      "payment-methods",
      "cancellation-reasons",
      "settings",
      "audit-log",
      "monitoring",
    ]) {
      await page.goto(origin + "/preview/admin/" + route, { waitUntil: "networkidle" });
      await page.locator('[data-admin-preview-ready="true"]').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const data = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        text: document.body.innerText,
      }));
      assert(data.scroll <= data.width, "overflow " + route + " " + width);
      assert(!data.text.includes("adminCatalog."), "untranslated catalog key " + route);
      assert(
        !/\b(INSERT|UPDATE|DELETE|pending_review|CAPTURED|CONFIRMED)\b/.test(data.text),
        "raw status " + route,
      );
      await page.screenshot({
        path: `docs/admin-audit/patch-3-${route}-${width}.png`,
        fullPage: true,
      });
      if (route === "services") {
        await page.getByRole("button", { name: "المواد والمناهج", exact: true }).click();
        await page.locator('input[value="رياضيات"]').waitFor();
        await page.getByRole("button", { name: "الخدمات", exact: true }).click();
        await page.getByRole("button", { name: "تعديل", exact: true }).first().click();
        await page.getByRole("dialog").waitFor();
        await page.getByRole("button", { name: "حفظ", exact: true }).click();
        await page
          .getByText("السعر والمدة الجديدة هتطبق على الحجوزات الجديدة. الحجوزات الحالية مش هتتغير.")
          .waitFor();
        assert.equal(writes.length, 0, "no service write before confirmation");
        await page.getByRole("button", { name: "إلغاء", exact: true }).click();
      }
      if (route === "settings") {
        assert.equal(
          await page.getByText("التغيير ده محتاج قرار من صاحب الشركة", { exact: true }).count(),
          1,
        );
      }
      console.log(JSON.stringify({ route, width, height: data.height, overflow: false }));
    }
    assert.deepEqual(writes, [], "no unseeded API requests or remote writes");
    assert.deepEqual(errors, [], "no page errors");
    await context.close();
  }
} finally {
  await browser.close();
}
