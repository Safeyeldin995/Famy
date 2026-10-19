import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const phase = process.argv[2] ?? "after";
if (!["before", "after"].includes(phase)) throw new Error("Expected before or after");
const base = "http://127.0.0.1:4322";
const out = `docs/customer-final-polish/${phase}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: "ar-EG",
  timezoneId: "Africa/Cairo",
});
await context.addCookies([{ name: "famio_lang", value: "ar", url: base }]);
const report = [];
try {
  for (const route of [
    "login",
    "otp",
    "forgot",
    "favorites",
    "promo-codes",
    "help",
    "onboarding",
    "search",
    "category/babysitting",
    "category/tutoring",
  ]) {
    const page = await context.newPage();
    const errors = [];
    const warnings = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
      if (message.type() === "warning") warnings.push(message.text());
    });
    await page.goto(base + "/preview/" + route);
    await page.locator("h1").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    const metrics = await page.evaluate(() => {
      // Audit the rendered customer PhoneFrame, excluding the separate design-preview toolbar.
      const app = document.querySelector("h1")?.closest(".min-h-dvh");
      if (!app) throw new Error("Customer screen missing");
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none";
      };
      const info = (el) => ({
        text: (el.getAttribute("aria-label") || el.textContent).trim().slice(0, 70),
        height: el.getBoundingClientRect().height,
        width: el.getBoundingClientRect().width,
        size: getComputedStyle(el).fontSize,
      });
      return {
        lang: document.documentElement.lang,
        overflow: document.documentElement.scrollWidth > innerWidth,
        smallText: [...app.querySelectorAll("*")]
          .filter(
            (el) =>
              visible(el) &&
              [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) &&
              parseFloat(getComputedStyle(el).fontSize) < 12,
          )
          .map(info),
        smallTargets: [...app.querySelectorAll("button,a,input,select,[role=button]")]
          .filter(
            (el) =>
              visible(el) &&
              !el.closest("[aria-hidden=true]") &&
              (el.getBoundingClientRect().height < 44 || el.getBoundingClientRect().width < 44),
          )
          .map(info),
        arabicDigits: app.innerText.match(/[٠-٩۰-۹]/g) ?? [],
        nativeSelects: app.querySelectorAll("select").length,
      };
    });
    const name = route.replaceAll("/", "-");
    await page.screenshot({
      path: `${out}/${name}.jpg`,
      fullPage: true,
      caret: "initial",
      type: "jpeg",
      quality: 82,
    });
    report.push({ route, ...metrics, errors, warnings });
    console.log(JSON.stringify(report.at(-1)));
    await page.close();
  }
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  if (
    phase === "after" &&
    report.some(
      (r) =>
        r.errors.length ||
        r.warnings.some((w) => /hydrat/i.test(w)) ||
        r.overflow ||
        r.smallText.length ||
        r.smallTargets.length ||
        r.arabicDigits.length ||
        r.nativeSelects,
    )
  )
    process.exitCode = 1;
} finally {
  await browser.close();
}
