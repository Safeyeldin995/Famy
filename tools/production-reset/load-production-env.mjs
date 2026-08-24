import fs from "node:fs";
import path from "node:path";
import { PRODUCTION_PROJECT_REF } from "./constants.mjs";

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
 * @returns {{ url: string; serviceRoleKey: string; projectRef: string }}
 */
export function loadProductionEnv() {
  const root = process.cwd();
  loadEnvFile(path.join(root, ".env"));
  loadEnvFile(path.join(root, ".env.local"));

  const url = process.env.SUPABASE_URL ?? "";
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? "";

  if (!url || !serviceRoleKey) {
    throw new Error(
      "[production-reset] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env",
    );
  }

  const match = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  const projectRef = match?.[1] ?? "";
  if (projectRef !== PRODUCTION_PROJECT_REF) {
    throw new Error(
      `[production-reset] Refusing: SUPABASE_URL ref ${projectRef ? projectRef.slice(0, 4) + "…" : "(missing)"} is not Production ${PRODUCTION_PROJECT_REF.slice(0, 4)}…${PRODUCTION_PROJECT_REF.slice(-4)}`,
    );
  }

  const qaUrl = process.env.QA_SUPABASE_URL ?? "";
  if (qaUrl.includes("bfwveoqbyqlhixjvdzha")) {
    throw new Error("[production-reset] Refusing: QA_SUPABASE_URL points at QA — use Production .env only");
  }

  return { url, serviceRoleKey, projectRef };
}

/**
 * @param {string} ref
 */
export function maskProjectRef(ref) {
  return ref.length >= 8 ? `${ref.slice(0, 4)}…${ref.slice(-4)}` : "****";
}
