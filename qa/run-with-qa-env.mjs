#!/usr/bin/env node
// Runs a child command after loading QA env and passing read-only preflight.
import { loadQaEnv } from "./load-qa-env.mjs";
import { runPreflightChecks } from "./env-guard.mjs";
import { runCliIfDirect } from "./cli-entrypoint.mjs";
import { spawnChildAndWait } from "./spawn-child.mjs";

/**
 * @param {string[]} [argv]
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2)) {
  const childArgs = argv;
  if (!childArgs.length) {
    console.error("[qa-run] Usage: node qa/run-with-qa-env.mjs <command> [...args]");
    return 1;
  }

  try {
    loadQaEnv({ required: true });
    runPreflightChecks(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const [command, ...args] = childArgs;
  try {
    return await spawnChildAndWait(command, args, process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

runCliIfDirect(import.meta.url, () => main());
