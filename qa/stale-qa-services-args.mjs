export const STALE_QA_SERVICES_CONFIRM_VALUE = "I-UNDERSTAND-QA-STALE-SERVICE-CLEANUP";

const DANGEROUS_FLAGS = new Set(["--force", "--yes", "--production", "--prod", "--no-guard"]);
const FINGERPRINT_RE = /^[a-f0-9]{64}$/;

/**
 * @typedef {"dry-run" | "execute" | "rejected"} StaleQaServicesMode
 * @typedef {{ mode: StaleQaServicesMode; confirmValue?: string; planFingerprint?: string; error?: string }} StaleQaServicesArgsResult
 */

/**
 * @param {string[]} [argv]
 * @returns {StaleQaServicesArgsResult}
 */
export function parseStaleQaServicesArgs(argv) {
  const args = argv ?? [];
  const seen = new Set();
  let execute = false;
  /** @type {string | undefined} */
  let confirmValue;
  /** @type {string | undefined} */
  let planFingerprint;

  for (const arg of args) {
    if (DANGEROUS_FLAGS.has(arg)) {
      return { mode: "rejected", error: `Dangerous stale-qa-services flag is not allowed: ${arg}` };
    }

    if (arg === "--execute") {
      if (seen.has("--execute")) {
        return { mode: "rejected", error: "Duplicate stale-qa-services flag is not allowed: --execute" };
      }
      seen.add("--execute");
      execute = true;
      continue;
    }

    if (arg.startsWith("--confirm=")) {
      if (seen.has("--confirm")) {
        return { mode: "rejected", error: "Duplicate stale-qa-services flag is not allowed: --confirm" };
      }
      confirmValue = arg.slice("--confirm=".length);
      if (!confirmValue) {
        return { mode: "rejected", error: "Malformed stale-qa-services flag: --confirm= requires a value" };
      }
      seen.add("--confirm");
      continue;
    }

    if (arg.startsWith("--plan-fingerprint=")) {
      if (seen.has("--plan-fingerprint")) {
        return {
          mode: "rejected",
          error: "Duplicate stale-qa-services flag is not allowed: --plan-fingerprint",
        };
      }
      planFingerprint = arg.slice("--plan-fingerprint=".length);
      if (!planFingerprint || !FINGERPRINT_RE.test(planFingerprint)) {
        return {
          mode: "rejected",
          error:
            "Malformed stale-qa-services flag: --plan-fingerprint must be a 64-char sha256 hex digest",
        };
      }
      seen.add("--plan-fingerprint");
      continue;
    }

    if (arg.startsWith("--")) {
      return { mode: "rejected", error: `Unknown stale-qa-services flag is not allowed: ${arg}` };
    }

    return { mode: "rejected", error: `Unexpected stale-qa-services argument: ${arg}` };
  }

  if (!execute) {
    return { mode: "dry-run", confirmValue, planFingerprint };
  }

  if (confirmValue !== STALE_QA_SERVICES_CONFIRM_VALUE) {
    return {
      mode: "rejected",
      error:
        "Stale QA service cleanup execute requires --execute --confirm=I-UNDERSTAND-QA-STALE-SERVICE-CLEANUP",
    };
  }

  if (!planFingerprint) {
    return {
      mode: "rejected",
      error: "Stale QA service cleanup execute requires --plan-fingerprint from the preceding dry-run",
    };
  }

  return { mode: "execute", confirmValue, planFingerprint };
}
