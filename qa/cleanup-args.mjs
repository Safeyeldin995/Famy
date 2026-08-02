export const CLEANUP_CONFIRM_VALUE = "I-UNDERSTAND-QA-CLEANUP";

const DANGEROUS_FLAGS = new Set(["--force", "--yes", "--production", "--prod", "--no-guard"]);

/**
 * @typedef {"dry-run" | "execute" | "rejected"} CleanupMode
 * @typedef {{ mode: CleanupMode; confirmValue?: string; error?: string }} CleanupArgsResult
 */

/**
 * @param {string[]} [argv]
 * @returns {CleanupArgsResult}
 */
export function parseCleanupArgs(argv) {
  const args = argv ?? [];

  for (const arg of args) {
    if (DANGEROUS_FLAGS.has(arg)) {
      return { mode: "rejected", error: `Dangerous cleanup flag is not allowed: ${arg}` };
    }
  }

  const execute = args.includes("--execute");
  const confirmArg = args.find((arg) => arg.startsWith("--confirm="));
  const confirmValue = confirmArg?.slice("--confirm=".length);

  if (!execute) {
    return { mode: "dry-run", confirmValue };
  }

  if (confirmValue !== CLEANUP_CONFIRM_VALUE) {
    return {
      mode: "rejected",
      error: "Destructive cleanup requires --execute --confirm=I-UNDERSTAND-QA-CLEANUP",
    };
  }

  return { mode: "execute", confirmValue };
}
