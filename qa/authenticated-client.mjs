// Builds a real user-session Supabase client from Playwright storage state so
// RPC authorization tests exercise authenticated grants/RLS, not service role.
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.mjs";

loadEnv();

export function authenticatedClient(role) {
  const state = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), `qa/.auth/${role}.json`), "utf8"));
  const authItem = state.origins
    .flatMap((origin) => origin.localStorage ?? [])
    .find((item) => item.name.startsWith("sb-") && item.name.endsWith("-auth-token"));
  if (!authItem) throw new Error(`No Supabase auth token found for ${role}.`);
  const session = JSON.parse(authItem.value);
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
}
