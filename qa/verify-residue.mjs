import fs from "node:fs";
import path from "node:path";
import { loadQaEnv } from "./load-qa-env.mjs";
import { runPreflightChecks } from "./env-guard.mjs";
import { getSupabaseAdmin } from "./admin-client.mjs";
import { runCliIfDirect } from "./cli-entrypoint.mjs";

export const RESIDUE_CLEAN_LOG = "[qa-residue] clean.";
export const RESIDUE_READ_FAILED_LOG = "[qa-residue] read failed:";

/** PostgREST `PGRSTnnn` or PostgreSQL SQLSTATE. Anything else is `unknown`. */
export const ALLOWED_RESIDUE_ERROR_CODE = /^(?:PGRST[0-9]{3}|[0-9A-Z]{5})$/;

const RETAINED_PROFILE_REASON =
  "Retained only when FK-bound or auth deletion failed; must remain suspended/neutralized";

/**
 * @param {unknown} error
 * @returns {"unknown" | string}
 */
export function allowlistedResidueErrorCode(error) {
  const record =
    error && typeof error === "object" ? /** @type {Record<string, unknown>} */ (error) : null;
  const code = typeof record?.code === "string" ? record.code.trim() : "";
  return ALLOWED_RESIDUE_ERROR_CODE.test(code) ? code : "unknown";
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
  return `${RESIDUE_READ_FAILED_LOG} ${label} code=${allowlistedResidueErrorCode(result?.error)}`;
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
