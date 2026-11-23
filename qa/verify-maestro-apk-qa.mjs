#!/usr/bin/env node
import fs from "node:fs";
import { KNOWN_QA_PROJECT_REF } from "./qa-identity.mjs";
import { verifyApkQaIdentity } from "./maestro-apk-qa-inspect.mjs";

const apkPath = process.argv[2];
if (!apkPath || !fs.existsSync(apkPath)) {
  console.error("[maestro] Usage: node qa/verify-maestro-apk-qa.mjs <path-to.apk>");
  process.exit(1);
}

const result = verifyApkQaIdentity(apkPath);
if (!result.ok) {
  console.error(result.message);
  process.exit(1);
}

console.log(`[maestro] APK QA identity OK (${KNOWN_QA_PROJECT_REF}) in decompressed assets.`);