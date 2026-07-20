import fs from "fs";
import path from "path";
import { loadEnv } from "./env.mjs";
import { supabaseAdmin } from "./admin-client.mjs";

loadEnv();

const reportDir = path.resolve(process.cwd(), "qa/report");
const [{ data: activeZones }, { data: activeServices }, { data: activeMethods }, { data: activeCampaigns }, { data: activeBookings }, { data: retainedProfiles }] = await Promise.all([
  supabaseAdmin.from("zones").select("id,name_en").ilike("name_en", "QA_%").eq("is_active", true),
  supabaseAdmin.from("services").select("id,name_en").ilike("name_en", "QA_%").eq("is_active", true),
  supabaseAdmin.from("payment_methods").select("id,name_en").ilike("name_en", "QA_%").or("is_active.eq.true,is_default.eq.true"),
  supabaseAdmin.from("notification_campaigns").select("id,title_en").ilike("title_en", "QA_%").in("status", ["draft", "scheduled", "sending"]),
  supabaseAdmin.from("bookings").select("id,notes").ilike("notes", "QA_%").in("status", ["pending", "confirmed", "in_progress"]),
  supabaseAdmin.from("profiles").select("id,full_name,is_suspended").ilike("full_name", "QA_%"),
]);

const report = {
  generated_at: new Date().toISOString(),
  active_qa_zones: activeZones ?? [],
  active_qa_services: activeServices ?? [],
  active_qa_payment_methods: activeMethods ?? [],
  active_qa_campaigns: activeCampaigns ?? [],
  active_qa_bookings: activeBookings ?? [],
  retained_qa_profiles: (retainedProfiles ?? []).map((profile) => ({
    id: profile.id,
    full_name: profile.full_name,
    is_suspended: profile.is_suspended,
    reason: "Retained only when FK-bound or auth deletion failed; must remain suspended/neutralized",
  })),
};

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, "residue-verify.json"), JSON.stringify(report, null, 2));

const hasActiveResidue = report.active_qa_zones.length
  || report.active_qa_services.length
  || report.active_qa_payment_methods.length
  || report.active_qa_campaigns.length
  || report.active_qa_bookings.length
  || report.retained_qa_profiles.some((profile) => !profile.is_suspended);

if (hasActiveResidue) {
  console.error("[qa-residue] active QA residue detected:", JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(`[qa-residue] clean. retained profiles: ${report.retained_qa_profiles.length}`);
