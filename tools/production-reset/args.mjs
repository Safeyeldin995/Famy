import {
  RESET_CONFIRM_VALUE,
  EXECUTE_TARGET_QA_CLONE,
  EXECUTE_TARGET_PRODUCTION,
} from "./constants.mjs";

const DANGEROUS_FLAGS = new Set(["--force", "--yes", "--no-guard"]);
const FINGERPRINT_RE = /^[a-f0-9]{64}$/;

/**
 * @param {string | undefined} target
 */
function parseTargetValue(target) {
  if (target === EXECUTE_TARGET_QA_CLONE || target === EXECUTE_TARGET_PRODUCTION) {
    return target;
  }
  return null;
}

/**
 * @param {string[]} [argv]
 */
export function parseProductionResetArgs(argv) {
  const args = argv ?? [];
  const seen = new Set();
  let execute = false;
  let simulate = false;
  /** @type {string | undefined} */
  let confirmValue;
  /** @type {string | undefined} */
  let planFingerprint;
  /** @type {string | undefined} */
  let target;

  for (const arg of args) {
    if (DANGEROUS_FLAGS.has(arg)) {
      return { mode: "rejected", error: `Dangerous production-reset flag is not allowed: ${arg}` };
    }
    if (arg === "--execute") {
      if (seen.has("--execute")) {
        return { mode: "rejected", error: "Duplicate flag: --execute" };
      }
      seen.add("--execute");
      execute = true;
      continue;
    }
    if (arg === "--simulate") {
      if (seen.has("--simulate")) {
        return { mode: "rejected", error: "Duplicate flag: --simulate" };
      }
      seen.add("--simulate");
      simulate = true;
      continue;
    }
    if (arg.startsWith("--confirm=")) {
      if (seen.has("--confirm")) {
        return { mode: "rejected", error: "Duplicate flag: --confirm" };
      }
      confirmValue = arg.slice("--confirm=".length);
      if (!confirmValue) {
        return { mode: "rejected", error: "Malformed flag: --confirm=" };
      }
      seen.add("--confirm");
      continue;
    }
    if (arg.startsWith("--plan-fingerprint=")) {
      if (seen.has("--plan-fingerprint")) {
        return { mode: "rejected", error: "Duplicate flag: --plan-fingerprint" };
      }
      planFingerprint = arg.slice("--plan-fingerprint=".length);
      if (!planFingerprint || !FINGERPRINT_RE.test(planFingerprint)) {
        return {
          mode: "rejected",
          error: "--plan-fingerprint must be a 64-char sha256 hex digest",
        };
      }
      seen.add("--plan-fingerprint");
      continue;
    }
    if (arg.startsWith("--target=")) {
      if (seen.has("--target")) {
        return { mode: "rejected", error: "Duplicate flag: --target" };
      }
      const value = arg.slice("--target=".length);
      const parsedTarget = parseTargetValue(value);
      if (!parsedTarget) {
        return {
          mode: "rejected",
          error: `--target must be ${EXECUTE_TARGET_QA_CLONE} or ${EXECUTE_TARGET_PRODUCTION}`,
        };
      }
      target = parsedTarget;
      seen.add("--target");
      continue;
    }
    if (arg.startsWith("--")) {
      return { mode: "rejected", error: `Unknown flag: ${arg}` };
    }
    return { mode: "rejected", error: `Unexpected argument: ${arg}` };
  }

  if (!execute) {
    if (simulate) {
      return { mode: "rejected", error: "--simulate requires --execute" };
    }
    return { mode: "dry-run", confirmValue, planFingerprint, target };
  }

  if (confirmValue !== RESET_CONFIRM_VALUE) {
    return {
      mode: "rejected",
      error: `Execute requires --execute --confirm=${RESET_CONFIRM_VALUE}`,
    };
  }
  if (!planFingerprint) {
    return { mode: "rejected", error: "Execute requires --plan-fingerprint from dry-run" };
  }
  if (!target) {
    return {
      mode: "rejected",
      error: `Execute requires --target=${EXECUTE_TARGET_QA_CLONE} or --target=${EXECUTE_TARGET_PRODUCTION}`,
    };
  }
  if (!simulate) {
    return {
      mode: "rejected",
      error: "Stage 2 execute requires --simulate (non-simulate mutations are not approved)",
    };
  }

  return {
    mode: "execute",
    confirmValue,
    planFingerprint,
    target,
    simulate,
  };
}
