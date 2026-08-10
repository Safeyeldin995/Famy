export const CONTAINMENT_CONFIRM_VALUE = "I-UNDERSTAND-QA-CONTAINMENT";

const DANGEROUS_FLAGS = new Set(["--force", "--yes", "--production", "--prod", "--no-guard"]);
const FINGERPRINT_RE = /^[a-f0-9]{64}$/;

/**
 * @typedef {"dry-run" | "execute" | "rejected"} ContainmentMode
 * @typedef {{ mode: ContainmentMode; confirmValue?: string; planFingerprint?: string; error?: string }} ContainmentArgsResult
 */

/**
 * @param {string[]} [argv]
 * @returns {ContainmentArgsResult}
 */
export function parseContainmentArgs(argv) {
  const args = argv ?? [];
  const seen = new Set();
  let execute = false;
  /** @type {string | undefined} */
  let confirmValue;
  /** @type {string | undefined} */
  let planFingerprint;

  for (const arg of args) {
    if (DANGEROUS_FLAGS.has(arg)) {
      return { mode: "rejected", error: `Dangerous containment flag is not allowed: ${arg}` };
    }

    if (arg === "--execute") {
      if (seen.has("--execute")) {
        return { mode: "rejected", error: "Duplicate containment flag is not allowed: --execute" };
      }
      seen.add("--execute");
      execute = true;
      continue;
    }

    if (arg.startsWith("--confirm=")) {
      if (seen.has("--confirm")) {
        return { mode: "rejected", error: "Duplicate containment flag is not allowed: --confirm" };
      }
      confirmValue = arg.slice("--confirm=".length);
      if (!confirmValue) {
        return { mode: "rejected", error: "Malformed containment flag: --confirm= requires a value" };
      }
      seen.add("--confirm");
      continue;
    }

    if (arg.startsWith("--plan-fingerprint=")) {
      if (seen.has("--plan-fingerprint")) {
        return { mode: "rejected", error: "Duplicate containment flag is not allowed: --plan-fingerprint" };
      }
      planFingerprint = arg.slice("--plan-fingerprint=".length);
      if (!planFingerprint || !FINGERPRINT_RE.test(planFingerprint)) {
        return { mode: "rejected", error: "Malformed containment flag: --plan-fingerprint must be a 64-char sha256 hex digest" };
      }
      seen.add("--plan-fingerprint");
      continue;
    }

    if (arg.startsWith("--")) {
      return { mode: "rejected", error: `Unknown containment flag is not allowed: ${arg}` };
    }

    return { mode: "rejected", error: `Unexpected containment argument: ${arg}` };
  }

  if (!execute) {
    return { mode: "dry-run", confirmValue, planFingerprint };
  }

  if (confirmValue !== CONTAINMENT_CONFIRM_VALUE) {
    return {
      mode: "rejected",
      error: "Containment execute requires --execute --confirm=I-UNDERSTAND-QA-CONTAINMENT",
    };
  }

  if (!planFingerprint) {
    return {
      mode: "rejected",
      error: "Containment execute requires --plan-fingerprint from the preceding dry-run",
    };
  }

  return { mode: "execute", confirmValue, planFingerprint };
}
