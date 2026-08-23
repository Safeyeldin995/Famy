#!/usr/bin/env node
/**
 * Playwright webServer entrypoint — loads QA secrets at spawn time so they never
 * appear in Playwright's serialized config (JSON reporter / results.json).
 */
import { loadQaEnv } from "./load-qa-env.mjs";
import { runPreflightChecks } from "./env-guard.mjs";
import {
  assertWebServerEnvLeastPrivilege,
  buildPlaywrightWebServerEnv,
  getEffectiveNormalizedChildEnv,
} from "./playwright-webserver-env.mjs";
import { spawnChildAndWait } from "./spawn-child.mjs";

loadQaEnv({ required: true });
runPreflightChecks(process.env);

const webServerEnv = buildPlaywrightWebServerEnv(process.env);
assertWebServerEnvLeastPrivilege(process.env, webServerEnv);
const childEnv = getEffectiveNormalizedChildEnv(process.env, webServerEnv);

const devArgs = ["run", "dev", "--", ...process.argv.slice(2)];
const exitCode = await spawnChildAndWait("npm", devArgs, childEnv);
process.exit(exitCode);
