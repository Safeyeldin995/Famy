// Extend the existing local fixture in memory for the schedule tables introduced by parity.
// No live backend is contacted and the protected qa/provider-web.cjs is not edited.
import { createRequire, Module } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const sourcePath = path.resolve("qa/provider-web.cjs");
const source = fs.readFileSync(sourcePath, "utf8");
const marker = "        availability_rules: availability,";
if (source.split(marker).length !== 2) throw new Error("Provider fixture shape changed");
let extended = source.replace(
  marker,
  `${marker}\n        provider_vacations: [{ id: id(77), provider_id: pid, start_date: "2026-11-01", end_date: "2026-11-03", reason: null }],\n        availability_exceptions: [{ id: id(78), provider_id: pid, date: "2026-11-05", is_blocked: true, reason: null }],`,
);
const endMarker = '  providerMode = "pending";';
if (extended.split(endMarker).length !== 2) throw new Error("Booking fixture shape changed");
extended = extended.replace(
  endMarker,
  `
  bookingConfirmed.start_at = new Date(Date.now() - 2 * 3600000).toISOString();
  bookingConfirmed.end_at = new Date(Date.now() - 3600000).toISOString();
  bookingConfirmed.status = "arrival_confirmed";
  await visit(\`/pro-booking/\${bidActive}\`);
  await shot("pro-booking-ready-to-start");
  await page.getByRole("button", { name: ar.pro.booking.startService, exact: true }).click();
  assert(writes.some((w) => w.body?.status === "in_progress"));
  bookingConfirmed.status = "in_progress";
  await visit(\`/pro-booking/\${bidActive}\`);
  await shot("pro-booking-in-progress");
  await page.getByRole("button", { name: ar.pro.booking.requestCompletion, exact: true }).click();
  assert(writes.some((w) => w.body?.status === "completion_requested"));
  bookingConfirmed.status = "completed";
  await visit(\`/pro-booking/\${bidActive}\`);
  await shot("pro-booking-completed");
  await visit("/schedule");
  await page.getByText(ar.scheduleUi.holidays, { exact: true }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 420);
  await page.waitForTimeout(250);
  await shot("pro-schedule-blocked");

${endMarker}`,
);
process.argv = [
  process.argv[0],
  sourcePath,
  "dist-provider-parity",
  "qa/parity-evidence/provider/native",
];
const fixture = new Module(sourcePath);
fixture.filename = sourcePath;
fixture.paths = require.resolve.paths(sourcePath);
fixture._compile(extended, sourcePath);
