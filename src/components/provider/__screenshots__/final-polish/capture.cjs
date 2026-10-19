const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "ar-EG",
      timezoneId: "Africa/Cairo",
    });
    await context.addCookies([{ name: "famio_lang", value: "ar", url: "http://127.0.0.1:5187" }]);
    const dir = "src/components/provider/__screenshots__/final-polish/after";
    fs.mkdirSync(dir, { recursive: true });
    const report = [];
    for (const [name, suffix] of [
      ["pending", "?pending=1"],
      ["changes", "?pending=changes"],
      ["profile", "/profile"],
      ["preferences", "/notification-preferences"],
      ["booking", "/booking/booking-pro-pending-1"],
      ["earnings", "/earnings"],
    ]) {
      const page = await context.newPage();
      const errors = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("http://127.0.0.1:5187/preview/pro" + suffix);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1500);
      await page.screenshot({ path: dir + "/" + name + ".png", fullPage: true, caret: "initial" });
      let geometry;
      if (name === "booking") {
        assert.equal(
          await page.getByText("إعادة الجدولة: لا يوجد طلب إعادة جدولة مفتوح.").count(),
          0,
        );
        const details = page
          .locator("details")
          .filter({ has: page.getByText("تفاصيل الدفع", { exact: true }) });
        await details.locator("summary").click();
        const support = page.getByRole("button", {
          name: "تواصل مع الدعم بخصوص هذه المهمة",
          exact: true,
        });
        await support.scrollIntoViewIfNeeded();
        geometry = await page.evaluate(() => {
          const dock = document.querySelector('[data-testid="booking-action-dock"]');
          const support = [...document.querySelectorAll("button")].find((x) =>
            x.textContent.includes("تواصل مع الدعم بخصوص هذه المهمة"),
          );
          const details = [...document.querySelectorAll("details")].find((x) =>
            x.textContent.includes("تفاصيل الدفع"),
          );
          return {
            dockTop: dock.getBoundingClientRect().top,
            dockBottom: dock.getBoundingClientRect().bottom,
            navTop: document.querySelector("nav.pro-surface").getBoundingClientRect().top,
            supportTop: support.getBoundingClientRect().top,
            supportBottom: support.getBoundingClientRect().bottom,
            paymentTop: details.getBoundingClientRect().top,
            paymentBottom: details.getBoundingClientRect().bottom,
          };
        });
        assert(geometry.supportTop >= 0 && geometry.supportBottom <= geometry.dockTop);
        assert(geometry.paymentTop >= 0 && geometry.paymentBottom <= geometry.dockTop);
        assert(geometry.dockBottom <= geometry.navTop);
        await page.screenshot({ path: dir + "/booking-payment-support.png", caret: "initial" });
      }
      if (name === "profile")
        assert((await page.getByText("القاهرة", { exact: true }).count()) > 0);
      if (name === "earnings") {
        assert.equal(
          await page.getByText("المبالغ دي قيمة الحجوزات قبل عمولة فامي", { exact: true }).count(),
          1,
        );
        assert.equal(await page.getByText("قيمة الحجز", { exact: true }).count(), 1);
      }
      report.push({ name, errors, ...(geometry && { geometry }) });
      await page.close();
    }
    fs.writeFileSync("pro-final-after.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    assert(
      report.every((r) => r.errors.length === 0),
      "Browser errors must be zero",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
