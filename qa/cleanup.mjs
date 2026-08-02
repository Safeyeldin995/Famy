// Standalone cleanup — defaults to dry-run. Destructive mode requires explicit confirmation.
import { loadQaEnv } from "./load-qa-env.mjs";
import { runPreflightChecks } from "./env-guard.mjs";
import { parseCleanupArgs } from "./cleanup-args.mjs";
import { runTeardown, runTeardownDryRun } from "./teardown-core.mjs";

const parsed = parseCleanupArgs(process.argv.slice(2));

try {
  loadQaEnv({ required: true });
  runPreflightChecks(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (parsed.mode === "rejected") {
  console.error(`[qa-cleanup] ${parsed.error}`);
  process.exit(1);
}

if (parsed.mode === "dry-run") {
  await runTeardownDryRun();
  process.exit(0);
}

await runTeardown();
