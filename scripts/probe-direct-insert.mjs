import { createClient } from "@supabase/supabase-js";
import fs from "fs";

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i < 0) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv(".env");
loadEnv(".env.local");

const url = process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stamp = Date.now();
const email = `qa-probe-${stamp}@famio.local`;
const { data: created } = await admin.auth.admin.createUser({
  email,
  password: "Probe123!",
  email_confirm: true,
});
const userId = created.user.id;
await admin.from("user_roles").upsert({ user_id: userId, role: "customer" });
await admin.from("profiles").upsert({
  id: userId,
  full_name: email,
  phone: `+2019${String(stamp).slice(-8)}`,
});

const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const { data: signIn } = await anon.auth.signInWithPassword({ email, password: "Probe123!" });
const client = createClient(url, anonKey, {
  global: { headers: { Authorization: `Bearer ${signIn.session.access_token}` } },
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: provider } = await admin.from("providers").select("id").limit(1).single();
const { data: service } = await admin.from("services").select("id").eq("is_active", true).limit(1).single();
const { data: address } = await admin.from("addresses").insert({
  user_id: userId,
  label: "home",
  line1: "probe",
  area: "Maadi",
  city: "Cairo",
  is_default: true,
  lat: 30.02,
  lng: 31.015,
}).select("id").single();

const start = new Date(Date.now() + 96 * 60 * 60 * 1000);
start.setUTCHours(10, 0, 0, 0);
const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

const { data, error } = await client.from("bookings").insert({
  customer_id: userId,
  provider_id: provider.id,
  service_id: service.id,
  address_id: address.id,
  start_at: start.toISOString(),
  end_at: end.toISOString(),
  status: "pending",
  price_subtotal: 200,
  price_total: 250,
}).select("id");

console.log(JSON.stringify({ code: error?.code, message: error?.message, data }, null, 2));
await admin.from("bookings").delete().eq("id", data?.[0]?.id ?? "00000000-0000-0000-0000-000000000000");
await admin.from("addresses").delete().eq("user_id", userId);
await admin.auth.admin.deleteUser(userId);
