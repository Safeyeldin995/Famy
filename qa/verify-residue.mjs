import fs from "node:fs";
import path from "node:path";
import { loadQaEnv } from "./load-qa-env.mjs";
import { runPreflightChecks } from "./env-guard.mjs";
import { getSupabaseAdmin } from "./admin-client.mjs";
import { runCliIfDirect } from "./cli-entrypoint.mjs";

export const RESIDUE_CLEAN_LOG = "[qa-residue] clean.";
export const RESIDUE_READ_FAILED_LOG = "[qa-residue] read failed:";

const RETAINED_PROFILE_REASON =
  "Retained only when FK-bound or auth deletion failed; must remain suspended/neutralized";

/**
 * @param {unknown} value
 */
function sanitizeResidueErrorText(value) {
  if (typeof value !== "string" || !value.trim()) return "query-failed";
  return value
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\b(?:sb_secret_|sb_publishable_|service_role)[A-Za-z0-9_-]*/gi, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]")
    .slice(0, 180);
}

/**
 * @param {unknown} error
 * @returns {{ code: string, message: string }}
 */
export function safeResidueReadError(error) {
  const record =
    error && typeof error === "object" ? /** @type {Record<string, unknown>} */ (error) : null;
  const code =
    typeof record?.code === "string" && record.code.trim() ? record.code.trim() : "unknown";
  return { code, message: sanitizeResidueErrorText(record?.message) };
}

/**
 * Successful reads must be an array. `data: null` is not empty residue.
 * @param {{ data?: unknown, error?: unknown } | null | undefined} result
 */
export function isSuccessfulResidueRead(result) {
  return !result?.error && Array.isArray(result?.data);
}

/**
 * @param {string} label
 * @param {{ data?: unknown, error?: unknown } | null | undefined} result
 */
export function formatResidueReadFailure(label, result) {
  const { code, message } = safeResidueReadError(result?.error);
  return `${RESIDUE_READ_FAILED_LOG} ${label} code=${code} message=${message}`;
}

/**
 * @param {string} label
 * @param {{ data?: unknown, error?: unknown } | null | undefined} result
 */
export function requireResidueReadRows(label, result) {
  if (!isSuccessfulResidueRead(result)) {
    const error = new Error(formatResidueReadFailure(label, result));
    error.name = "ResidueReadError";
    throw error;
  }
  return /** @type {unknown[]} */ (result.data);
}

/**
 * @returns {Promise<number>}
 */
export async function main() {
  loadQaEnv({ required: true });
  runPreflightChecks(process.env);

  const supabaseAdmin = getSupabaseAdmin();
  const reportDir = path.resolve(process.cwd(), "qa/report");
  const reportPath = path.join(reportDir, "residue-verify.json");

  const labeledQueries = [
    {
      label: "active_qa_zones",
      run: () =>
        supabaseAdmin
          .from("zones")
          .select("id,name_en")
          .ilike("name_en", "QA_%")
          .eq("is_active", true),
    },
    {
      label: "active_qa_services",
      run: () =>
        supabaseAdmin
          .from("services")
          .select("id,name_en")
          .ilike("name_en", "QA_%")
          .eq("is_active", true),
    },
    {
      label: "active_qa_payment_methods",
      run: () =>
        supabaseAdmin
          .from("payment_methods")
          .select("id,name_en")
          .ilike("name_en", "QA_%")
          .or("is_active.eq.true,is_default.eq.true"),
    },
    {
      label: "active_qa_campaigns",
      run: () =>
        supabaseAdmin
          .from("notification_campaigns")
          .select("id,title_en")
          .ilike("title_en", "QA_%")
          .in("status", ["draft", "scheduled", "sending"]),
    },
    {
      label: "active_qa_bookings",
      run: () =>
        supabaseAdmin
          .from("bookings")
          .select("id,notes")
          .ilike("notes", "QA_%")
          .in("status", ["pending", "confirmed", "in_progress"]),
    },
    {
      label: "retained_qa_profiles",
      run: () =>
        supabaseAdmin
          .from("profiles")
          .select("id,full_name,is_suspended")
          .ilike("full_name", "QA_%"),
    },
  ];

  let reads;
  try {
    const settled = await Promise.all(
      labeledQueries.map(async (query) => ({
        label: query.label,
        result: await query.run(),
      })),
    );
    reads = Object.fromEntries(
      settled.map((row) => [row.label, requireResidueReadRows(row.label, row.result)]),
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ResidueReadError") {
      console.error(error.message);
      return 1;
    }
    throw error;
  }

  const report = {
    generated_at: new Date().toISOString(),
    active_qa_zones: reads.active_qa_zones,
    active_qa_services: reads.active_qa_services,
    active_qa_payment_methods: reads.active_qa_payment_methods,
    active_qa_campaigns: reads.active_qa_campaigns,
    active_qa_bookings: reads.active_qa_bookings,
    retained_qa_profiles: reads.retained_qa_profiles.map((profile) => ({
      id: profile.id,
      full_name: profile.full_name,
      is_suspended: profile.is_suspended,
      reason: RETAINED_PROFILE_REASON,
    })),
  };

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const hasActiveResidue =
    report.active_qa_zones.length ||
    report.active_qa_services.length ||
    report.active_qa_payment_methods.length ||
    report.active_qa_campaigns.length ||
    report.active_qa_bookings.length ||
    report.retained_qa_profiles.some((profile) => !profile.is_suspended);

  if (hasActiveResidue) {
    console.error("[qa-residue] active QA residue detected:", JSON.stringify(report, null, 2));
    return 1;
  }

  console.log(`${RESIDUE_CLEAN_LOG} retained profiles: ${report.retained_qa_profiles.length}`);
  return 0;
}

runCliIfDirect(import.meta.url, () => main());
