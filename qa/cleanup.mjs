// Standalone cleanup — defaults to dry-run. Destructive mode requires explicit confirmation.
import { loadQaEnv } from "./load-qa-env.mjs";
import { runPreflightChecks } from "./env-guard.mjs";
import { parseCleanupArgs } from "./cleanup-args.mjs";
import { runTeardown, runTeardownDryRun } from "./teardown-core.mjs";
import { runCliIfDirect } from "./cli-entrypoint.mjs";

/**
 * @param {string[]} [argv]
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2)) {
  const parsed = parseCleanupArgs(argv);

  try {
    loadQaEnv({ required: true });
    runPreflightChecks(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (parsed.mode === "rejected") {
    console.error(`[qa-cleanup] ${parsed.error}`);
    return 1;
  }

  if (parsed.mode === "dry-run") {
    await runTeardownDryRun();
    return 0;
  }

  await runTeardown({ planFingerprint: parsed.planFingerprint });
  return 0;
}

runCliIfDirect(import.meta.url, () => main());
