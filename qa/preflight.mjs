#!/usr/bin/env node
// Read-only QA preflight — validates environment identity before any write-capable command.
import { loadQaEnv } from "./load-qa-env.mjs";
import { runPreflightChecks } from "./env-guard.mjs";
import { runCliIfDirect } from "./cli-entrypoint.mjs";

/**
 * @returns {Promise<number>}
 */
export async function main() {
  try {
    loadQaEnv({ required: true });
    const result = runPreflightChecks(process.env);
    console.log("[qa-preflight] OK");
    console.log(`[qa-preflight] tier=${process.env.FAMY_ENV} qa_ref=${result.qaProjectRef.slice(0, 4)}…${result.qaProjectRef.slice(-4)}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

runCliIfDirect(import.meta.url, () => main());
