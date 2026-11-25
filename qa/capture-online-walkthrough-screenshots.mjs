#!/usr/bin/env node
/**
 * Fixture walkthrough screenshots for PR evidence (Arabic RTL).
 * Requires: PREVIEW_ROUTES_ENABLED=true, dev server on port (default 5199).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const PORT = Number(process.env.SCREENSHOT_PORT || 5199);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.SCREENSHOT_OUT || "/opt/cursor/artifacts/online-web-walkthrough";

const SCENE_LABELS = {
  "student-home": "طالب — الرئيسية /online",
  "student-sign-in": "طالب — تسجيل الدخول",
  "student-tutors": "طالب — قائمة المدربين",
  "student-tutor-profile": "طالب — ملف المدرس + طلب درس",
  "student-lessons-requested": "طالب — دروسي (مطلوب / بانتظار التأكيد)",
  "student-lessons-pay": "طالب — دروسي (مؤكد + ادفع)",
  "student-lessons-join": "طالب — دروسي (مدفوع + ادخل)",
  "student-payment": "طالب — دفع (محفظة + كارت)",
  "student-wallet": "طالب — المحفظة",
  "student-room": "طالب — غرفة الحصة",
  "teacher-requests": "مدرس — طلبات واردة (قبول / رفض)",
  "teacher-lessons": "مدرس — دروسي",
  "teacher-room": "مدرس — غرفة الحصة",
};

const SCENES = Object.keys(SCENE_LABELS);
const VIEWPORTS = [
  { tag: "desktop-1366x850", width: 1366, height: 850 },
  { tag: "phone-390x844", width: 390, height: 844 },
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: "ar-EG" });

for (const scene of SCENES) {
  for (const vp of VIEWPORTS) {
    const page = await context.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const url = `${BASE}/preview/online/walkthrough?scene=${scene}`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
    await page.waitForTimeout(800);
    const file = join(OUT, `${scene}__${vp.tag}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log("saved", file);
    await page.close();
  }
}

await browser.close();

const manifest = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE,
  scenes: SCENE_LABELS,
  outDir: OUT,
};
console.log(JSON.stringify(manifest, null, 2));