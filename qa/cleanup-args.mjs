export const CLEANUP_CONFIRM_VALUE = "I-UNDERSTAND-QA-CLEANUP";

const DANGEROUS_FLAGS = new Set(["--force", "--yes", "--production", "--prod", "--no-guard"]);
const ALLOWED_EXACT_FLAGS = new Set(["--execute"]);
const FINGERPRINT_RE = /^[a-f0-9]{64}$/;

/**
 * @typedef {"dry-run" | "execute" | "rejected"} CleanupMode
 * @typedef {{ mode: CleanupMode; confirmValue?: string; planFingerprint?: string; error?: string }} CleanupArgsResult
 */

/**
 * @param {string[]} [argv]
 * @returns {CleanupArgsResult}
 */
export function parseCleanupArgs(argv) {
  const args = argv ?? [];
  const seen = new Set();
  let execute = false;
  /** @type {string | undefined} */
  let confirmValue;
  /** @type {string | undefined} */
  let planFingerprint;

  for (const arg of args) {
    if (DANGEROUS_FLAGS.has(arg)) {
      return { mode: "rejected", error: `Dangerous cleanup flag is not allowed: ${arg}` };
    }

    if (arg === "--execute") {
      if (seen.has("--execute")) {
        return { mode: "rejected", error: "Duplicate cleanup flag is not allowed: --execute" };
      }
      seen.add("--execute");
      execute = true;
      continue;
    }

    if (arg.startsWith("--confirm=")) {
      if (seen.has("--confirm")) {
        return { mode: "rejected", error: "Duplicate cleanup flag is not allowed: --confirm" };
      }
      confirmValue = arg.slice("--confirm=".length);
      if (!confirmValue) {
        return { mode: "rejected", error: "Malformed cleanup flag: --confirm= requires a value" };
      }
      seen.add("--confirm");
      continue;
    }

    if (arg.startsWith("--plan-fingerprint=")) {
      if (seen.has("--plan-fingerprint")) {
        return { mode: "rejected", error: "Duplicate cleanup flag is not allowed: --plan-fingerprint" };
      }
      planFingerprint = arg.slice("--plan-fingerprint=".length);
      if (!planFingerprint || !FINGERPRINT_RE.test(planFingerprint)) {
        return { mode: "rejected", error: "Malformed cleanup flag: --plan-fingerprint must be a 64-char sha256 hex digest" };
      }
      seen.add("--plan-fingerprint");
      continue;
    }

    if (arg.startsWith("--")) {
      return { mode: "rejected", error: `Unknown cleanup flag is not allowed: ${arg}` };
    }

    return { mode: "rejected", error: `Unexpected cleanup argument: ${arg}` };
  }

  if (!execute) {
    return { mode: "dry-run", confirmValue, planFingerprint };
  }

  if (confirmValue !== CLEANUP_CONFIRM_VALUE) {
    return {
      mode: "rejected",
      error: "Destructive cleanup requires --execute --confirm=I-UNDERSTAND-QA-CLEANUP",
    };
  }

  if (!planFingerprint) {
    return {
      mode: "rejected",
      error: "Destructive cleanup requires --plan-fingerprint from the preceding dry-run",
    };
  }

  return { mode: "execute", confirmValue, planFingerprint };
}
