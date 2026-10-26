// Extend the existing isolated provider fixture, retaining all original assertions.
// The protected mobile/qa/*.cjs files are not edited.
import { createRequire, Module } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const sourcePath = path.resolve("qa/provider-web.cjs");
const source = fs.readFileSync(sourcePath, "utf8");
const anchor = '  await shot("pro-schedule");';
if (source.split(anchor).length !== 2) throw new Error("Provider fixture anchor changed");
const checks = `
  const startControl = page.getByRole("button", { name: ar.pro.schedule.start, exact: true });
  await startControl.click();
  const timeSearch = page.getByRole("textbox", { name: ar.common.search, exact: true });
  await timeSearch.fill("10");
  await page.getByRole("radio", { name: "10 ص", exact: true }).click();
  await expect(startControl).toContainText("10 ص");
  await page.getByRole("button", { name: ar.pro.schedule.saveSchedule, exact: true }).click();
  await expect.poll(() => writes.some(w => w.table === "replace_provider_availability" && w.body.p_rules.every(rule => rule.start_time === "10:00"))).toBe(true);
  await page.getByRole("button", { name: ar.pro.schedule.end, exact: true }).click();
  await expect(page.getByRole("radio", { name: "12 بالليل", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: ar.providerApply.close, exact: true }).last().click();
  await expect(page.getByRole("radio", { name: "12 بالليل", exact: true })).toHaveCount(0);
  await page.getByRole("checkbox", { name: ar.providerSetup.sameHours, exact: true }).click();
  await expect(page.getByRole("button", { name: ar.pro.schedule.start, exact: true })).toHaveCount(availability.length);
  await page.getByRole("button", { name: ar.pro.schedule.start, exact: true }).first().click();
  await page.getByRole("textbox", { name: ar.common.search, exact: true }).fill("11");
  await page.getByRole("radio", { name: "11 ص", exact: true }).click();
  await expect(page.getByRole("button", { name: ar.pro.schedule.start, exact: true }).first()).toContainText("11 ص");
  await expect(page.getByRole("button", { name: ar.pro.schedule.start, exact: true }).last()).toContainText("10 ص");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= 390));
  console.log("PASS: schedule time selection, shared/individual hours, HH:MM payload, midnight, close and 390px width");
`;
process.argv = [
  process.argv[0],
  sourcePath,
  "dist-parity",
  "qa/parity-evidence/native/schedule-test",
];
const fixture = new Module(sourcePath);
fixture.filename = sourcePath;
fixture.paths = require.resolve.paths(sourcePath);
fixture._compile(source.replace(anchor, anchor + checks), sourcePath);
