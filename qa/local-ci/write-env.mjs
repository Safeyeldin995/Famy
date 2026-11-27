#!/usr/bin/env node
/**
 * Writes .env.local-ci from the running local Supabase stack.
 * Values are the local stack's well-known development keys; nothing is printed.
 */
import fs from "node:fs";
import path from "node:path";
import { buildLocalCiEnv, LOCAL_CI_ENV_FILE, readSupabaseStatus } from "./env.mjs";

const env = buildLocalCiEnv(readSupabaseStatus());
const body = Object.entries(env)
  .map(([key, value]) => `${key}=${value}`)
  .join("\n");
fs.writeFileSync(path.resolve(process.cwd(), LOCAL_CI_ENV_FILE), `${body}\n`, { mode: 0o600 });
console.log(`[local-ci] wrote ${LOCAL_CI_ENV_FILE} for ${env.LOCAL_SUPABASE_URL}`);
