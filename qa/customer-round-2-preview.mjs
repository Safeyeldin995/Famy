import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
const base = "http://127.0.0.1:4320";
const out = "docs/customer-round-2/screenshots";
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: "ar-EG",
  timezoneId: "Africa/Cairo",
});
await context.addCookies([{ name: "famio_lang", value: "ar", url: base }]);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
async function capture(name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const metrics = await page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const app =
      document.querySelector(".booking-screen") ??
      document.querySelector("h1")?.closest("main") ??
      document.body;
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      smallText: [...app.querySelectorAll("*")]
        .filter(
          (el) =>
            visible(el) &&
            [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) &&
            parseFloat(getComputedStyle(el).fontSize) < 12,
        )
        .map((el) => ({ text: el.textContent.slice(0, 60), size: getComputedStyle(el).fontSize })),
      smallTargets: [...app.querySelectorAll("button,a,input,select")]
        .filter(
          (el) =>
            visible(el) &&
            !el.closest("[aria-hidden=true]") &&
            el.getBoundingClientRect().height < 44,
        )
        .map((el) => ({
          text: el.textContent.slice(0, 60),
          height: el.getBoundingClientRect().height,
        })),
    };
  });
  await page.screenshot({
    path: out + "/" + name + ".jpg",
    fullPage: name !== "birthday-sheet",
    animations: "disabled",
    type: "jpeg",
    quality: 82,
  });
  console.log(name, JSON.stringify(metrics));
  if (metrics.overflow) throw new Error("Page overflow: " + name);
}
async function open(path) {
  await page.goto(base + path);
  await page.locator("h1").waitFor();
}
try {
  for (const [name, path] of [
    ["category-babysitting", "/preview/category/babysitting"],
    ["category-tutoring", "/preview/category/tutoring"],
    ["bookings", "/preview/bookings"],
    ["notifications", "/preview/notifications"],
    ["profile", "/preview/profile"],
    ["family-members", "/preview/family-members"],
    ["family-member-new", "/preview/family-members?memberId=new"],
    ["family-member-edit", "/preview/family-members?memberId=fm-1"],
    ["addresses", "/preview/addresses"],
    ["address-new", "/preview/addresses/new"],
    ["address-edit", "/preview/addresses/addr-1"],
    ["notification-preferences", "/preview/notification-preferences"],
  ]) {
    await open(path);
    await capture(name);
  }
  await open("/preview/family-members?memberId=fm-1");
  await page.getByRole("button", { name: "السنة", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await capture("birthday-sheet");
  await open("/preview/book/p1");
  await capture("booking-1-service");
  await page.getByRole("button", { name: /^التالي ·/ }).click();
  await page.locator(".booking-time:not(:disabled)").first().waitFor();
  await page.locator(".booking-time:not(:disabled)").first().click();
  await capture("booking-2-when");
  await page.getByRole("button", { name: /^التالي ·/ }).click();
  await page.getByRole("button", { name: "يوسف", exact: true }).click();
  await capture("booking-3-where-who");
  await page.getByRole("button", { name: /^التالي ·/ }).click();
  await page.getByRole("heading", { name: "راجع وأكد" }).waitFor();
  await capture("booking-4-review");
  console.log("REVIEW_TEXT", await page.locator(".booking-screen").innerText());
  await open("/preview/book/p1?serviceId=booking-tutoring");
  await page.getByRole("button", { name: "يوسف", exact: true }).click();
  await page.getByRole("button", { name: /رياضيات ·/ }).click();
  await page.getByRole("button", { name: "الحصة (60 دقيقة)", exact: true }).waitFor();
  await capture("booking-tutoring");
  console.log("BROWSER_ERRORS", JSON.stringify(errors));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
