// Standalone QA operational containment — defaults to dry-run.
import { loadQaEnv } from "./load-qa-env.mjs";
import { runPreflightChecks } from "./env-guard.mjs";
import { parseContainmentArgs } from "./containment-args.mjs";
import { runContainmentDryRun, runContainmentExecute, printExecuteSummary } from "./containment-core.mjs";
import { runCliIfDirect } from "./cli-entrypoint.mjs";

/**
 * @param {string[]} [argv]
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2)) {
  const parsed = parseContainmentArgs(argv);

  try {
    loadQaEnv({ required: true });
    runPreflightChecks(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (parsed.mode === "rejected") {
    console.error(`[qa-containment] ${parsed.error}`);
    return 1;
  }

  if (parsed.mode === "dry-run") {
    await runContainmentDryRun();
    return 0;
  }

  try {
    const payload = await runContainmentExecute({ planFingerprint: parsed.planFingerprint });
    printExecuteSummary(payload);
    return payload.success ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

runCliIfDirect(import.meta.url, () => main());
