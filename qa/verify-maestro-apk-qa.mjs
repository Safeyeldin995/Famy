#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import {
  KNOWN_PRODUCTION_PROJECT_REF,
  KNOWN_QA_PROJECT_REF,
} from "./qa-identity.mjs";

const apkPath = process.argv[2];
if (!apkPath || !fs.existsSync(apkPath)) {
  console.error("[maestro] Usage: node qa/verify-maestro-apk-qa.mjs <path-to.apk>");
  process.exit(1);
}

let blob = "";
try {
  blob = execSync(`strings ${JSON.stringify(apkPath)}`, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (error) {
  console.error("[maestro] Could not read APK:", error instanceof Error ? error.message : error);
  process.exit(1);
}

const hasQa = blob.includes(KNOWN_QA_PROJECT_REF);
const hasProd = blob.includes(KNOWN_PRODUCTION_PROJECT_REF);

if (hasProd) {
  console.error(
    `[maestro] APK embeds Production Supabase ref ${KNOWN_PRODUCTION_PROJECT_REF}. ` +
      "Build the APK with QA Supabase URL (EAS env EXPO_PUBLIC_SUPABASE_URL / extra.supabaseUrl).",
  );
  process.exit(1);
}

if (!hasQa) {
  console.error(
    `[maestro] APK does not embed QA Supabase ref ${KNOWN_QA_PROJECT_REF}. ` +
      "Refusing to run flows against an unknown backend.",
  );
  process.exit(1);
}

console.log(`[maestro] APK QA identity OK (${KNOWN_QA_PROJECT_REF}).`);