import { createClient } from "@supabase/supabase-js";
import { execSync } from "child_process";
import { loadEnv } from "./env.mjs";
import { authenticatedClient } from "./authenticated-client.mjs";

loadEnv();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key || !anonKey) {
  console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or anon key");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

function runSql(query) {
  const oneLine = query.replace(/\s+/g, " ").trim();
  try {
    return execSync(`npx supabase db query --linked ${JSON.stringify(oneLine)}`, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    return err.stdout?.trim() ?? err.message;
  }
}

async function rpcDenied(client, fn, args) {
  const { error } = await client.rpc(fn, args);
  return { denied: !!error, message: error?.message ?? "ok" };
}

async function main() {
  console.log("=== routine_privileges (authenticated) ===");
  console.log(runSql(`
    SELECT routine_name, grantee, privilege_type
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name IN ('apply_provider_onboarding_status','log_provider_onboarding_event','admin_set_provider_verification','provider_onboarding_completion')
      AND grantee IN ('authenticated','anon','PUBLIC')
    ORDER BY routine_name, grantee
  `));

  console.log("\n=== provider_documents policies ===");
  console.log(runSql(`
    SELECT tablename, policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'provider_documents'
    ORDER BY policyname
  `));

  const { data: provider } = await admin.from("providers").select("id").limit(1).maybeSingle();
  const providerId = provider?.id;
  if (!providerId) {
    console.error("No provider row available for RPC denial checks");
    process.exit(1);
  }

  console.log("\n=== RPC denial checks ===");
  let providerClient;
  let customerClient;
  try {
    providerClient = authenticatedClient("provider");
    customerClient = authenticatedClient("customer");
  } catch (err) {
    console.log("Auth storage state unavailable:", err.message);
  }

  const checks = [
    ["anon.apply_provider_onboarding_status", await rpcDenied(anon, "apply_provider_onboarding_status", {
      p_provider_id: providerId, p_new_status: "APPROVED", p_actor_id: providerId, p_actor_role: "admin", p_action: "approve",
    })],
  ];
  if (providerClient) {
    checks.push(["provider.log_provider_onboarding_event", await rpcDenied(providerClient, "log_provider_onboarding_event", {
      p_provider_id: providerId, p_actor_id: providerId, p_actor_role: "admin", p_action: "forged", p_previous_status: "DRAFT", p_new_status: "APPROVED",
    })]);
  }
  if (customerClient) {
    checks.push(["customer.provider_onboarding_completion(other)", await rpcDenied(customerClient, "provider_onboarding_completion", { p_provider_id: providerId })]);
  }

  for (const [name, result] of checks) {
    console.log(`${name}: ${result.denied ? "DENIED" : "ALLOWED"} ${result.message}`);
    if (!result.denied) process.exitCode = 1;
  }

  console.log("\nPrivilege verification complete.");
}

main().catch((e) => { console.error(e); process.exit(1); });
