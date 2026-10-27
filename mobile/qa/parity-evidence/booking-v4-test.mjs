// Reuse protected payment/booking fixtures without editing mobile/qa/*.cjs.
import { createRequire, Module } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const sourcePath = path.resolve("qa/phase2a-web.cjs");
let source = fs.readFileSync(sourcePath, "utf8").replace(/\r\n/g, "\n");
function replace(anchor, value) {
  if (source.split(anchor).length !== 2) throw new Error(`Fixture changed: ${anchor}`);
  source = source.replace(anchor, () => value);
}
replace("let browser;", "let browser;\nlet failurePage;");
replace(
  "const page = await context.newPage();",
  "const page = await context.newPage();\n  failurePage = page;",
);
replace(
  ".catch((e) => {",
  `.catch(async (e) => {
    fs.writeFileSync(path.join(artifacts, 'failure.txt'), String(e.stack || e));
    try { await failurePage?.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }); }
    catch { console.error('Failure screenshot unavailable: browser page closed or crashed. Last successful screenshots retained.'); }`,
);
replace(
  'weekday: "short",\n      day: "numeric",\n      month: "short",',
  'weekday: "long",\n      day: "numeric",\n      month: "long",',
);
replace("await radio(day);", "await button(day);");
replace(
  '.getByRole("radio", { name: /^[0-9]+:[0-9]+/ })',
  '.getByRole("button", { name: /^[0-9]+:[0-9]+/ })',
);
replace(
  '    await page.getByLabel(ar.mobileBooking.promo, { exact: true }).fill("LOCALTEST");',
  '    await button(ar.customerBooking.promo);\n    await page.getByLabel(ar.mobileBooking.promo, { exact: true }).fill("LOCALTEST");',
);
// Detail title and its status card both show the new state. Verify both and the fixture's guarded mutation.
replace(
  "await expect(page.getByText(ar.status.cancelled, { exact: true })).toBeVisible();",
  'assert.equal(booking.status, "cancelled");\n      await expect(page.getByText(ar.status.cancelled, { exact: true })).toHaveCount(2);\n      await expect(page.getByText(ar.status.cancelled, { exact: true }).first()).toBeVisible();',
);
process.argv = [process.argv[0], sourcePath, "dist-parity", "qa/parity-evidence/native/booking-v4"];
const fixture = new Module(sourcePath);
fixture.filename = sourcePath;
fixture.paths = require.resolve.paths(sourcePath);
fixture._compile(source, sourcePath);
