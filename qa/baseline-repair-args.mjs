export const BASELINE_REPAIR_CONFIRM_VALUE = "I-UNDERSTAND-QA-BASELINE-REPAIR";

const DANGEROUS_FLAGS = new Set(["--force", "--yes", "--production", "--prod", "--no-guard"]);
const FINGERPRINT_RE = /^[a-f0-9]{64}$/;

/**
 * @typedef {"dry-run" | "execute" | "rejected"} BaselineRepairMode
 * @typedef {{ mode: BaselineRepairMode; confirmValue?: string; planFingerprint?: string; error?: string }} BaselineRepairArgsResult
 */

/**
 * @param {string[]} [argv]
 * @returns {BaselineRepairArgsResult}
 */
export function parseBaselineRepairArgs(argv) {
  const args = argv ?? [];
  const seen = new Set();
  let execute = false;
  /** @type {string | undefined} */
  let confirmValue;
  /** @type {string | undefined} */
  let planFingerprint;

  for (const arg of args) {
    if (DANGEROUS_FLAGS.has(arg)) {
      return { mode: "rejected", error: `Dangerous baseline-repair flag is not allowed: ${arg}` };
    }

    if (arg === "--execute") {
      if (seen.has("--execute")) {
        return { mode: "rejected", error: "Duplicate baseline-repair flag is not allowed: --execute" };
      }
      seen.add("--execute");
      execute = true;
      continue;
    }

    if (arg.startsWith("--confirm=")) {
      if (seen.has("--confirm")) {
        return { mode: "rejected", error: "Duplicate baseline-repair flag is not allowed: --confirm" };
      }
      confirmValue = arg.slice("--confirm=".length);
      if (!confirmValue) {
        return { mode: "rejected", error: "Malformed baseline-repair flag: --confirm= requires a value" };
      }
      seen.add("--confirm");
      continue;
    }

    if (arg.startsWith("--plan-fingerprint=")) {
      if (seen.has("--plan-fingerprint")) {
        return { mode: "rejected", error: "Duplicate baseline-repair flag is not allowed: --plan-fingerprint" };
      }
      planFingerprint = arg.slice("--plan-fingerprint=".length);
      if (!planFingerprint || !FINGERPRINT_RE.test(planFingerprint)) {
        return {
          mode: "rejected",
          error: "Malformed baseline-repair flag: --plan-fingerprint must be a 64-char sha256 hex digest",
        };
      }
      seen.add("--plan-fingerprint");
      continue;
    }

    if (arg.startsWith("--")) {
      return { mode: "rejected", error: `Unknown baseline-repair flag is not allowed: ${arg}` };
    }

    return { mode: "rejected", error: `Unexpected baseline-repair argument: ${arg}` };
  }

  if (!execute) {
    return { mode: "dry-run", confirmValue, planFingerprint };
  }

  if (confirmValue !== BASELINE_REPAIR_CONFIRM_VALUE) {
    return {
      mode: "rejected",
      error: "Baseline repair execute requires --execute --confirm=I-UNDERSTAND-QA-BASELINE-REPAIR",
    };
  }

  if (!planFingerprint) {
    return {
      mode: "rejected",
      error: "Baseline repair execute requires --plan-fingerprint from the preceding dry-run",
    };
  }

  return { mode: "execute", confirmValue, planFingerprint };
}
