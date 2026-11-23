#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const FLOWS_DIR = path.resolve(process.cwd(), "mobile/maestro/flows");
const REQUIRED = [
  "01-customer-sign-in.yaml",
  "02-in-person-booking-request.yaml",
  "03-online-lesson-happy-path.yaml",
  "04-customer-cancel-fee-windows.yaml",
  "05-provider-cancel-wallet.yaml",
  "06-report-problem.yaml",
];

let failed = false;
for (const file of REQUIRED) {
  const full = path.join(FLOWS_DIR, file);
  if (!fs.existsSync(full)) {
    console.error(`[release-gate] Missing Maestro flow: ${file}`);
    failed = true;
    continue;
  }
  const raw = fs.readFileSync(full, "utf8");
  if (!raw.includes("appId:")) {
    console.error(`[release-gate] Invalid Maestro flow (missing appId): ${file}`);
    failed = true;
  }
  if (/optional:\s*true/.test(raw)) {
    console.error(`[release-gate] Flow must not use optional steps: ${file}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`[release-gate] Maestro flows OK (${REQUIRED.length})`);