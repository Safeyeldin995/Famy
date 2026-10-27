import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("../../../../node_modules/@playwright/test");
const here = path.dirname(fileURLToPath(import.meta.url));
const pairs = {
  dashboard: "native/pro-dashboard",
  jobs: "native/pro-jobs",
  booking: "native/pro-booking-accept",
  "booking-confirmed": "native/pro-booking-start",
  "booking-completed": "native/pro-booking-completed",
  schedule: "native/pro-schedule",
  earnings: "native/pro-earnings",
  messages: "native/pro-messages",
  chat: "native/pro-chat-thread",
  profile: "native/pro-profile",
  "profile-edit": "native2/profile-edit",
  documents: "native2/documents",
  "setup-home": "native2/setup-home",
  "setup-personal": "native2/setup-personal",
  "setup-about": "native2/setup-about",
  "setup-hours": "native2/setup-hours",
  "setup-photo": "native2/setup-photo",
  "setup-babysitting": "native2/setup-babysitting",
  "setup-reference": "native2/setup-reference",
  "setup-subjects": "native2/setup-subjects",
  notifications: "native/pro-notifications",
  "notification-preferences": "native2/notification-prefs",
};
await fs.mkdir(path.join(here, "pairs"), { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 780, height: 872 }, deviceScaleFactor: 1 });
const results = [];
for (const [screen, native] of Object.entries(pairs)) {
  try {
    const web = await fs.readFile(path.join(here, "web", `${screen}.png`));
    const app = await fs.readFile(path.join(here, `${native}.png`));
    await page.setContent(
      `<style>body{margin:0;background:#fff;font:14px sans-serif}.labels{display:flex;height:28px}.labels span{width:390px;text-align:center;line-height:28px}main{display:flex}img{width:390px;height:844px}</style><div class="labels"><span>Web preview · Arabic · 390×844</span><span>Expo web export · Arabic · 390×844</span></div><main><img src="data:image/png;base64,${web.toString("base64")}"><img src="data:image/png;base64,${app.toString("base64")}"></main>`,
    );
    await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
    await page.screenshot({ path: path.join(here, "pairs", `${screen}.png`) });
    results.push({ screen, composed: true });
  } catch (error) {
    results.push({ screen, composed: false, error: String(error) });
  }
}
await fs.writeFile(path.join(here, "pairs.json"), JSON.stringify(results, null, 2));
await browser.close();
console.log(`${results.filter((item) => item.composed).length}/${results.length} pairs composed`);
if (results.some((item) => !item.composed)) process.exitCode = 1;
