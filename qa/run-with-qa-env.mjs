#!/usr/bin/env node
// Runs a child command after loading QA env and passing read-only preflight.
import { spawnSync } from "node:child_process";
import { loadQaEnv } from "./load-qa-env.mjs";
import { runPreflightChecks } from "./env-guard.mjs";

const childArgs = process.argv.slice(2);
if (!childArgs.length) {
  console.error("[qa-run] Usage: node qa/run-with-qa-env.mjs <command> [...args]");
  process.exit(1);
}

try {
  loadQaEnv({ required: true });
  runPreflightChecks(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const [command, ...args] = childArgs;
const result = spawnSync(command, args, {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
