// Durable recovery for QA tests that temporarily mutate shared rows. Entries
// are written before the mutation and removed only after an exact DB readback.
import fs from "fs";
import path from "path";
import { supabaseAdmin } from "./admin-client.mjs";

const RESTORATION_PATH = path.resolve(process.cwd(), "qa/.auth/restorations.json");

function readEntries() {
  try {
    return JSON.parse(fs.readFileSync(RESTORATION_PATH, "utf8"));
  } catch {
    return [];
  }
}

function writeEntries(entries) {
  fs.mkdirSync(path.dirname(RESTORATION_PATH), { recursive: true });
  const temporaryPath = `${RESTORATION_PATH}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(entries, null, 2));
  fs.renameSync(temporaryPath, RESTORATION_PATH);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function assertSafeGlobalMutationTarget(baseURL) {
  const production = "https://famy-chi.vercel.app";
  if (String(baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "").replace(/\/$/, "") === production) {
    throw new Error("Global-state QA tests are forbidden against Production; use local or a Preview deployment with restoration enabled.");
  }
}

export function registerRestoration(entry) {
  const entries = readEntries();
  if (entries.some((item) => item.id === entry.id)) {
    throw new Error(`Restoration entry already registered: ${entry.id}`);
  }
  writeEntries([...entries, entry]);
}

async function restoreEntry(entry) {
  if (entry.type === "setting") {
    const query = supabaseAdmin.from("settings");
    const result = entry.existed
      ? await query.upsert({ key: entry.key, value: entry.value }, { onConflict: "key" })
      : await query.delete().eq("key", entry.key);
    if (result.error) throw new Error(`Could not restore setting ${entry.key}: ${result.error.message}`);
    const { data, error } = await supabaseAdmin.from("settings").select("value").eq("key", entry.key).maybeSingle();
    if (error || Boolean(data) !== entry.existed || (entry.existed && !sameJson(data.value, entry.value))) {
      throw new Error(`Setting ${entry.key} did not restore to its exact original value.`);
    }
    return;
  }

  if (entry.type === "category") {
    const { id, ...values } = entry.row;
    const { error } = await supabaseAdmin.from("categories").update(values).eq("id", id);
    if (error) throw new Error(`Could not restore category ${id}: ${error.message}`);
    const { data } = await supabaseAdmin.from("categories").select("id,slug,name_en,name_ar,is_active").eq("id", id).single();
    if (!sameJson(data, entry.row)) throw new Error(`Category ${id} did not restore exactly.`);
    return;
  }

  if (entry.type === "payment_defaults") {
    const { error: clearError } = await supabaseAdmin.from("payment_methods").update({ is_default: false }).eq("is_default", true);
    if (clearError) throw new Error(`Could not clear temporary payment default: ${clearError.message}`);
    const originalDefaults = entry.rows.filter((row) => row.is_default).map((row) => row.id);
    if (originalDefaults.length) {
      const { error } = await supabaseAdmin.from("payment_methods").update({ is_default: true }).in("id", originalDefaults);
      if (error) throw new Error(`Could not restore payment default: ${error.message}`);
    }
    const { data, error } = await supabaseAdmin.from("payment_methods").select("id").eq("is_default", true).order("id");
    const restored = (data ?? []).map((row) => row.id).sort();
    if (error || !sameJson(restored, [...originalDefaults].sort())) {
      throw new Error("Payment-method defaults did not restore to the exact original set.");
    }
    return;
  }

  if (entry.type === "delete_reminder") {
    const { error } = await supabaseAdmin.from("booking_reminder_rules").delete().eq("lead_minutes", entry.leadMinutes);
    if (error) throw new Error(`Could not remove QA reminder: ${error.message}`);
    const { count } = await supabaseAdmin.from("booking_reminder_rules").select("id", { count: "exact", head: true }).eq("lead_minutes", entry.leadMinutes);
    if (count !== 0) throw new Error(`QA reminder ${entry.leadMinutes} remains after restoration.`);
    return;
  }

  if (entry.type === "booking_status") {
    const { error } = await supabaseAdmin.from("bookings").update({ status: entry.status }).eq("id", entry.bookingId);
    if (error) throw new Error(`Could not restore booking status: ${error.message}`);
    const { data } = await supabaseAdmin.from("bookings").select("status").eq("id", entry.bookingId).single();
    if (data?.status !== entry.status) throw new Error(`Booking ${entry.bookingId} status did not restore.`);
    return;
  }

  throw new Error(`Unknown restoration entry type: ${entry.type}`);
}

export async function restoreRestoration(id) {
  const entries = readEntries();
  const entry = entries.find((item) => item.id === id);
  if (!entry) return;
  await restoreEntry(entry);
  writeEntries(readEntries().filter((item) => item.id !== id));
}

export async function restorePendingRestorations() {
  for (const entry of readEntries()) await restoreRestoration(entry.id);
}

export function assertNoPendingRestorations() {
  const entries = readEntries();
  if (entries.length) throw new Error(`Pending QA restorations remain: ${entries.map((entry) => entry.id).join(", ")}`);
}
