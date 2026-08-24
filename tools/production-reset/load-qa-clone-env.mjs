import fs from "node:fs";
import path from "node:path";
import { PRODUCTION_PROJECT_REF } from "./constants.mjs";
import { maskProjectRef } from "./load-production-env.mjs";

/**
 * @param {string} filePath
 */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

/**
 * QA-clone credentials for execute/simulate — never Production.
 *
 * @returns {{ url: string; serviceRoleKey: string; projectRef: string; databaseUrl: string | null; maskedProjectRef: string }}
 */
export function loadQaCloneEnv() {
  const root = process.cwd();
  loadEnvFile(path.join(root, ".env.qa.local"));
  loadEnvFile(path.join(root, ".env.local"));
  loadEnvFile(path.join(root, ".env"));

  const url = process.env.QA_CLONE_SUPABASE_URL ?? process.env.QA_SUPABASE_URL ?? "";
  const serviceRoleKey =
    process.env.QA_CLONE_SUPABASE_SECRET_KEY ??
    process.env.QA_SUPABASE_SECRET_KEY ??
    process.env.QA_CLONE_SUPABASE_SERVICE_ROLE_KEY ??
    "";

  const databaseUrl =
    process.env.QA_CLONE_DATABASE_URL ?? process.env.QA_DATABASE_URL ?? null;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "[production-reset:execute] Missing QA-clone credentials — set QA_CLONE_SUPABASE_URL and QA_CLONE_SUPABASE_SECRET_KEY (or QA_SUPABASE_* in .env.qa.local)",
    );
  }

  const match = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  const projectRef = match?.[1] ?? "";
  if (!projectRef) {
    throw new Error("[production-reset:execute] QA-clone Supabase URL is missing or invalid");
  }

  if (projectRef === PRODUCTION_PROJECT_REF) {
    throw new Error(
      `[production-reset:execute] Refusing QA-clone target: URL resolves to Production ${maskProjectRef(PRODUCTION_PROJECT_REF)}`,
    );
  }

  return {
    url,
    serviceRoleKey,
    projectRef,
    databaseUrl,
    maskedProjectRef: maskProjectRef(projectRef),
  };
}
