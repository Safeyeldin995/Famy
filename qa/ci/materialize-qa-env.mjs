#!/usr/bin/env node
/**
 * Writes .env.qa.local from process env (CI secrets). Never logs secret values.
 */
import fs from "node:fs";
import path from "node:path";
import {
  KNOWN_PRODUCTION_PROJECT_REF,
  KNOWN_QA_PROJECT_REF,
} from "../qa-identity.mjs";
import { collectQaGuardErrors, parseSupabaseProjectRef } from "../env-guard.mjs";

const REQUIRED = [
  "QA_SUPABASE_URL",
  "QA_SUPABASE_PUBLISHABLE_KEY",
  "QA_SUPABASE_SECRET_KEY",
  "FAMY_QA_APP_ORIGIN",
  "FAMY_PRODUCTION_APP_ORIGIN",
] ;

function read(name) {
  const value = process.env[name]?.trim();
  return value || "";
}

function main() {
  const secretKey = read("QA_SUPABASE_SECRET_KEY") || read("QA_SUPABASE_SERVICE_ROLE_KEY");
  const env = {
    ...process.env,
    FAMY_ENV: "qa",
    FAMY_QA_SUPABASE_PROJECT_REF: KNOWN_QA_PROJECT_REF,
    FAMY_PRODUCTION_SUPABASE_PROJECT_REF: KNOWN_PRODUCTION_PROJECT_REF,
    QA_SUPABASE_SECRET_KEY: secretKey,
  };

  const missing = REQUIRED.filter((key) => {
    if (key === "QA_SUPABASE_SECRET_KEY") return !secretKey;
    return !read(key);
  });

  if (missing.length) {
    console.error(
      `[release-gate] Admin E2E requires GitHub secrets: ${missing.join(", ")}. ` +
        "Also set FAMY_QA_APP_ORIGIN and FAMY_PRODUCTION_APP_ORIGIN to non-Production QA preview URLs.",
    );
    process.exit(1);
  }

  try {
    parseSupabaseProjectRef(env.QA_SUPABASE_URL);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const guardErrors = collectQaGuardErrors(env);
  if (guardErrors.length) {
    console.error(`[release-gate] QA env rejected:\n- ${guardErrors.join("\n- ")}`);
    process.exit(1);
  }

  const lines = [
    "FAMY_ENV=qa",
    `FAMY_QA_SUPABASE_PROJECT_REF=${KNOWN_QA_PROJECT_REF}`,
    `FAMY_PRODUCTION_SUPABASE_PROJECT_REF=${KNOWN_PRODUCTION_PROJECT_REF}`,
    `QA_SUPABASE_URL=${read("QA_SUPABASE_URL")}`,
    `QA_SUPABASE_PUBLISHABLE_KEY=${read("QA_SUPABASE_PUBLISHABLE_KEY")}`,
    `QA_SUPABASE_SECRET_KEY=${secretKey}`,
    `FAMY_QA_APP_ORIGIN=${read("FAMY_QA_APP_ORIGIN")}`,
    `FAMY_PRODUCTION_APP_ORIGIN=${read("FAMY_PRODUCTION_APP_ORIGIN")}`,
    `OTP_PROVIDER=${read("OTP_PROVIDER") || "mock"}`,
    `VITE_OTP_PROVIDER=${read("VITE_OTP_PROVIDER") || "mock"}`,
  ];

  const out = path.resolve(process.cwd(), ".env.qa.local");
  fs.writeFileSync(out, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`[release-gate] Wrote ${out} (no values logged).`);
}

main();