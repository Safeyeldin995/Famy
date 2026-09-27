#!/usr/bin/env node
/**
 * Isolated Issue #68 browser harness.
 * Synthetic credentials only. Does not load .env.qa.local or real QA/Production secrets.
 */
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnChildAndWait } from "./spawn-child.mjs";
import { DEFAULT_HARNESS_PORT, HARNESS_HOST, HARNESS_RUNTIME_KEYS, SYNTHETIC_PUBLISHABLE_KEY } from "./issue68-host/constants.mjs";

const hostDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(hostDir, "..");
const portFlag = process.argv.indexOf("--port");
const PORT = portFlag >= 0 ? Number(process.argv[portFlag + 1]) : DEFAULT_HARNESS_PORT;
const origin = `http://${HARNESS_HOST}:${PORT}`;

function getRuntimeEnv(source) {
  /** @type {NodeJS.ProcessEnv} */
  const env = {};
  for (const key of HARNESS_RUNTIME_KEYS) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return env;
}

function assertNoSensitiveKeys(env) {
  const forbidden = [
    "QA_SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "QA_SUPABASE_URL",
    "AUTH_INTENT_SECRET",
    "FIREBASE_PRIVATE_KEY",
    "VERCEL_AUTOMATION_BYPASS_SECRET",
  ];
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();
    if (forbidden.some((item) => item.toUpperCase() === upper)) {
      throw new Error(`[issue68-host] refused to spawn with sensitive key ${key}`);
    }
    if (upper.includes("SERVICE_ROLE") || upper.includes("SECRET_KEY")) {
      throw new Error(`[issue68-host] refused to spawn with sensitive key ${key}`);
    }
  }
}

function portOccupied(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HARNESS_HOST, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

if (await portOccupied(PORT)) {
  console.error(`[issue68-host] port ${PORT} is occupied; refusing to reuse an existing server`);
  process.exit(1);
}

const childEnv = {
  ...getRuntimeEnv(process.env),
  NODE_ENV: "development",
  FAMY_ENV: "issue68-harness",
  VITE_SUPABASE_URL: origin,
  VITE_SUPABASE_PUBLISHABLE_KEY: SYNTHETIC_PUBLISHABLE_KEY,
  SUPABASE_URL: origin,
  SUPABASE_PUBLISHABLE_KEY: SYNTHETIC_PUBLISHABLE_KEY,
};
assertNoSensitiveKeys(childEnv);

const viteBin = path.join(repoRoot, "node_modules/vite/bin/vite.js");
const configPath = path.join(hostDir, "issue68-host/vite.config.ts");
const exitCode = await spawnChildAndWait(
  process.execPath,
  [viteBin, "--config", configPath, "--host", HARNESS_HOST, "--port", String(PORT), "--strictPort"],
  childEnv,
);
process.exit(exitCode);
