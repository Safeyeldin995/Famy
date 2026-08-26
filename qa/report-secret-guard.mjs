import fs from "node:fs";
import path from "node:path";

/** Supabase service-role JWT and modern sb_secret_ keys — not anon publishable keys. */
export const SUPABASE_SECRET_KEY_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "QA_SUPABASE_SECRET_KEY",
  "SUPABASE_SECRET_KEY",
  "AUTH_INTENT_SECRET",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_CLIENT_EMAIL",
];

const REPORT_SECRET_KEY_PATTERN = new RegExp(
  `"(${SUPABASE_SECRET_KEY_NAMES.join("|")})"\\s*:\\s*"(?!""|undefined)[^"]{8,}"`,
);

/**
 * @param {string} token
 */
function isServiceRoleJwt(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

/**
 * @param {string} content
 * @returns {string[]}
 */
export function findSecretPatternsInText(content) {
  /** @type {string[]} */
  const hits = [];
  if (REPORT_SECRET_KEY_PATTERN.test(content)) {
    hits.push("json-secret-key-value");
  }
  if (/sb_secret_[A-Za-z0-9_-]{8,}/.test(content)) {
    hits.push("sb_secret_…");
  }
  const jwtMatches = content.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? [];
  for (const token of jwtMatches) {
    if (isServiceRoleJwt(token)) {
      hits.push(`${token.slice(0, 24)}…`);
    }
  }
  return hits;
}

/**
 * @param {string} reportDir
 * @returns {{ ok: true } | { ok: false; violations: Array<{ file: string; hits: string[] }> }}
 */
export function assertQaReportDirectorySecretFree(reportDir) {
  const root = path.resolve(reportDir);
  if (!fs.existsSync(root)) {
    return { ok: true };
  }

  /** @type {Array<{ file: string; hits: string[] }>} */
  const violations = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filePath = path.join(root, entry.name);
    const content = fs.readFileSync(filePath, "utf8");
    const hits = findSecretPatternsInText(content);
    if (hits.length) {
      violations.push({ file: path.relative(process.cwd(), filePath), hits });
    }
  }

  if (violations.length) {
    return { ok: false, violations };
  }
  return { ok: true };
}
