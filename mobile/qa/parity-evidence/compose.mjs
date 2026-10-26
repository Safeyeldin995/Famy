import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("../../../node_modules/@playwright/test");
const root = path.dirname(fileURLToPath(import.meta.url));
const pairs = {
  onboarding: ["onboarding", "onboarding/slide-1"],
  "onboarding-2": ["onboarding-2", "onboarding/slide-2"],
  "onboarding-3": ["onboarding-3", "onboarding/slide-3"],
  ...Object.fromEntries(
    [
      "home",
      "search",
      "category-babysitting",
      "category-tutoring",
      "provider",
      "bookings",
      "booking-detail",
      "notifications",
      "profile",
      "addresses",
      "family-members",
      "family-member-new",
      "favorites",
      "promo-codes",
      "help",
    ].map((name) => [name, [name, `phase1-web/${name}`]]),
  ),
  "booking-step-1": ["booking-step-1", "phase2a-web/hourly-1-service"],
  messages: ["messages", "chat-web/messages-list"],
  chat: ["chat", "chat-web/chat-open"],
  dashboard: ["dashboard", "provider-web/pro-dashboard"],
  jobs: ["jobs", "provider-web/pro-jobs"],
  schedule: ["schedule", "schedule-test/pro-schedule"],
  earnings: ["earnings", "provider-web/pro-earnings"],
  "pro-profile": ["pro-profile", "provider-web/pro-profile"],
  "pro-documents": ["pro-documents", "provider2-web/documents"],
  "pro-notifications": ["pro-notifications", "provider-web/pro-notifications"],
};
await fs.mkdir(path.join(root, "comparisons"), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 780, height: 872 }, deviceScaleFactor: 1 });
const report = [];
try {
  for (const [screen, [web, native]] of Object.entries(pairs)) {
    if (process.argv[2] && process.argv[2] !== screen) continue;
    try {
      const left = await fs.readFile(path.join(root, `web/${web}.png`));
      const right = await fs.readFile(path.join(root, `native/${native}.png`));
      await page.setContent(
        `<style>body{margin:0;background:white;font:14px sans-serif}.labels{display:flex;height:28px}.labels span{width:390px;text-align:center;line-height:28px}main{display:flex}img{width:390px;height:844px}</style><div class="labels"><span>Web · Arabic · 390 × 844</span><span>Native web export · Arabic · 390 × 844</span></div><main><img src="data:image/png;base64,${left.toString("base64")}"><img src="data:image/png;base64,${right.toString("base64")}"></main>`,
      );
      await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
      await page.screenshot({ path: path.join(root, `comparisons/${screen}.png`) });
      report.push({ screen, web, native, composed: true });
    } catch (error) {
      report.push({ screen, composed: false, error: error.message });
    }
  }
  await fs.writeFile(path.join(root, "comparisons.json"), JSON.stringify(report, null, 2));
  console.log(
    `Composed ${report.filter((row) => row.composed).length}/${report.length} actual screenshot pairs. Not a parity PASS.`,
  );
} finally {
  await browser.close();
}
