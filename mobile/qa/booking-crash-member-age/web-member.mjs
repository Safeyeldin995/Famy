import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ar-EG",
    timezoneId: "Africa/Cairo",
  });
  await context.addCookies([{ name: "famio_lang", value: "ar", url: "http://127.0.0.1:4321" }]);
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4321/preview/family-members?memberId=new");
  await page.getByRole("button", { name: "السنين", exact: true }).click();
  await page.getByRole("option", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "الشهور", exact: true }).click();
  await page.getByRole("option", { name: "8", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "الشهور", exact: true }).scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: fileURLToPath(new URL("screenshots/member-form-web.png", import.meta.url)),
  });
  console.log("PASS: Arabic web age form captured at 390x844 using preview fixtures.");
} finally {
  await browser.close();
}
