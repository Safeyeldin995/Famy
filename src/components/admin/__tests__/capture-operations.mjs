import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const origin = "http://127.0.0.1:4174";
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 800 },
    });
    await context.addCookies([{ name: "famio_lang", value: "ar", url: origin }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const route of ["bookings", "cases", "payments"]) {
      await page.goto(`${origin}/preview/admin/${route}`);
      await page.getByPlaceholder("دور بالاسم أو كود الحجز").waitFor();
      await page.evaluate(() => document.fonts.ready);
      const data = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        text: document.body.innerText,
      }));
      assert(data.scroll <= data.width, `overflow ${route} ${width}`);
      assert(!data.text.includes("adminOps."), "untranslated adminOps key");
      assert(!/\b(CONFIRMED|CAPTURED|pending_review)\b/.test(data.text), "raw status");
      await page.screenshot({
        path: `docs/admin-audit/patch-2-${route}-${width}.png`,
        fullPage: true,
      });
      console.log(JSON.stringify({ route, width, height: data.height, overflow: false }));
      if (route === "bookings") {
        assert.equal(await page.locator("select").count(), 0, "no arbitrary status select");
        await page.getByPlaceholder("دور بالاسم أو كود الحجز").fill("#A1B2C3");
        assert.equal(
          await page.getByRole("button", { name: "إلغاء مع سبب", exact: true }).count(),
          1,
        );
      }
      if (route === "cases") {
        assert(
          data.text.includes("الخدمة ماكملتش زي الاتفاق") &&
            data.text.includes("مقدم الخدمة ماحضرش") &&
            data.text.includes("استفسار عن التحويل"),
          "all three case types",
        );
      }
      if (route === "payments") {
        await page.getByRole("button", { name: "اتأكدت من التحويل", exact: true }).click();
        await page.getByRole("group", { name: "اتأكدت إن المبلغ وصل؟" }).waitFor();
        await page.getByRole("button", { name: "إلغاء", exact: true }).click();
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await browser.close();
}
