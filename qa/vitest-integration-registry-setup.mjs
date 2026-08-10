/**
 * Vitest worker-local setup for guarded live QA integration tests.
 * Runs inside each integration test worker — not in globalSetup parent process.
 */
import { loadQaEnv } from "./load-qa-env.mjs";
import { runPreflightChecks } from "./env-guard.mjs";
import { enableGuardedIntegrationRegistryMode } from "./registry.mjs";

loadQaEnv({ required: true });
runPreflightChecks(process.env);
enableGuardedIntegrationRegistryMode(process.env);
