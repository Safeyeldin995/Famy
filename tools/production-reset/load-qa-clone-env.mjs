import fs from "node:fs";
import path from "node:path";
import { PRODUCTION_PROJECT_REF } from "./constants.mjs";
import { maskProjectRef } from "./load-production-env.mjs";
import {
  resolveProjectRefFromDatabaseUrl,
  resolveProjectRefFromRestUrl,
} from "./project-ref-from-url.mjs";

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
 * Fail closed: database URL must resolve to the same project as the verified REST URL.
 *
 * @param {string} databaseUrl
 * @param {string} restProjectRef
 */
export function assertQaCloneDatabaseUrlIdentity(databaseUrl, restProjectRef) {
  const databaseProjectRef = resolveProjectRefFromDatabaseUrl(databaseUrl);
  if (!databaseProjectRef) {
    throw new Error(
      "[production-reset:execute] Cannot resolve project ref from QA-clone database URL — refusing to proceed",
    );
  }

  if (databaseProjectRef === PRODUCTION_PROJECT_REF) {
    throw new Error(
      `[production-reset:execute] Refusing QA-clone database URL: resolves to Production ${maskProjectRef(PRODUCTION_PROJECT_REF)}`,
    );
  }

  if (databaseProjectRef !== restProjectRef) {
    throw new Error(
      `[production-reset:execute] QA-clone database URL project ref ${maskProjectRef(databaseProjectRef)} does not match REST URL ref ${maskProjectRef(restProjectRef)}`,
    );
  }

  return databaseProjectRef;
}

/**
 * QA-clone credentials for execute/simulate — never Production.
 *
 * @returns {{ url: string; serviceRoleKey: string; projectRef: string; databaseUrl: string | null; maskedProjectRef: string; databaseProjectRef: string | null }}
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

  const projectRef = resolveProjectRefFromRestUrl(url);
  if (!projectRef) {
    throw new Error("[production-reset:execute] QA-clone Supabase URL is missing or invalid");
  }

  if (projectRef === PRODUCTION_PROJECT_REF) {
    throw new Error(
      `[production-reset:execute] Refusing QA-clone target: REST URL resolves to Production ${maskProjectRef(PRODUCTION_PROJECT_REF)}`,
    );
  }

  /** @type {string | null} */
  let databaseProjectRef = null;
  if (databaseUrl) {
    databaseProjectRef = assertQaCloneDatabaseUrlIdentity(databaseUrl, projectRef);
  }

  return {
    url,
    serviceRoleKey,
    projectRef,
    databaseUrl,
    databaseProjectRef,
    maskedProjectRef: maskProjectRef(projectRef),
  };
}
