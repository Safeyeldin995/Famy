/**
 * «الطلبة بيدوروا على إيه»: shared logic for the tutor demand card (web + app).
 * Rows come from public.provider_tutor_demand_insights() (migration 20261128153000):
 * aggregates only, never customer data.
 */
import { governorateName } from "../geo/egyptGovernorates";

export type TutorDemandInsightRow = {
  service_id: string;
  service_slug: string | null;
  service_name_ar: string | null;
  service_name_en: string | null;
  subject_id: string | null;
  subject_code: string | null;
  subject_name_ar: string | null;
  subject_name_en: string | null;
  curriculum_id: string | null;
  curriculum_code: string | null;
  curriculum_name_ar: string | null;
  curriculum_name_en: string | null;
  level_id: string | null;
  level_code: string | null;
  level_label_ar: string | null;
  level_label_en: string | null;
  service_mode: "online" | "in_person";
  governorate_code: string | null;
  students: number;
  last_requested_at: string;
  teaches_subject: boolean;
  capability_status: string | null;
  mode_fits: boolean;
  near_me: boolean;
};

export type DemandTranslate = (key: string, options?: Record<string, unknown>) => string;

const pick = (ar: boolean, a: string | null | undefined, e: string | null | undefined) =>
  ((ar ? (a ?? e) : (e ?? a)) ?? "").trim();

/** «فرنساوي IB سنة 3»: what is wanted, without the count or the mode. */
export function demandWhat(row: TutorDemandInsightRow, lang: string): string {
  const ar = lang.startsWith("ar");
  const subject = pick(ar, row.subject_name_ar, row.subject_name_en);
  const service = pick(ar, row.service_name_ar, row.service_name_en);
  const curriculum =
    row.curriculum_code && row.curriculum_code !== "na"
      ? pick(ar, row.curriculum_name_ar, row.curriculum_name_en)
      : "";
  const level = pick(ar, row.level_label_ar, row.level_label_en);
  return [subject || service, curriculum, level].filter(Boolean).join(" ");
}

/** «أونلاين» / «في البيت في الجيزة» / «في البيت». */
export function demandWhere(row: TutorDemandInsightRow, lang: string, t: DemandTranslate): string {
  if (row.service_mode === "online") return t("tutorDemand.modeOnline");
  if (row.governorate_code) {
    return t("tutorDemand.modeHomeIn", { place: governorateName(row.governorate_code, lang) });
  }
  return t("tutorDemand.modeHome");
}

/** «12 طالب بيدوروا على فرنساوي IB سنة 3 أونلاين». */
export function demandHeadline(
  row: TutorDemandInsightRow,
  lang: string,
  t: DemandTranslate,
): string {
  return t("tutorDemand.headline", {
    count: Math.max(1, Math.round(Number(row.students) || 0)),
    what: demandWhat(row, lang),
    where: demandWhere(row, lang, t),
  });
}

/** Whole days since the newest request, never negative. */
export function demandAgeDays(lastRequestedAt: string, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(lastRequestedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 86_400_000);
}

export function demandRecency(lastRequestedAt: string, t: DemandTranslate, now?: Date): string {
  const days = demandAgeDays(lastRequestedAt, now);
  if (days === 0) return t("tutorDemand.lastToday");
  if (days === 1) return t("tutorDemand.lastYesterday");
  return t("tutorDemand.lastDays", { count: days });
}

/** Rows the tutor can act on right away come first: what they teach, near them, then size. */
export function isGoodFit(row: TutorDemandInsightRow): boolean {
  return row.teaches_subject && row.mode_fits;
}

export function sortDemandRows(rows: readonly TutorDemandInsightRow[]): TutorDemandInsightRow[] {
  const score = (r: TutorDemandInsightRow) =>
    (isGoodFit(r) ? 2 : 0) + (r.near_me && r.mode_fits ? 1 : 0);
  return [...rows].sort(
    (a, b) =>
      score(b) - score(a) ||
      Number(b.students) - Number(a.students) ||
      new Date(b.last_requested_at).getTime() - new Date(a.last_requested_at).getTime(),
  );
}

export type DemandAction =
  | { kind: "pending" }
  | { kind: "has_it"; needsMode: boolean }
  | {
      kind: "add";
      /** "setup": the tutor already offers this service; "request": ask admin for the service first. */
      target: "setup" | "request";
      serviceId: string;
      subjectId: string | null;
      curriculumId: string | null;
      levelId: string | null;
    };

/**
 * What «أضيفها لموادي» does for this row. `serviceStatus` is the tutor's
 * provider_services status for the row's service (undefined when they don't offer it).
 */
export function demandAction(
  row: TutorDemandInsightRow,
  serviceStatus: string | null | undefined,
): DemandAction {
  if (row.capability_status === "pending") return { kind: "pending" };
  if (row.capability_status === "approved") return { kind: "has_it", needsMode: !row.mode_fits };
  const offers =
    serviceStatus === "approved" || serviceStatus === "pending" || serviceStatus === "paused";
  return {
    kind: "add",
    target: offers ? "setup" : "request",
    serviceId: row.service_id,
    subjectId: row.subject_id,
    curriculumId: row.curriculum_id,
    levelId: row.level_id,
  };
}

/** Search params carried to the add-subject screens (both apps read the same names). */
export type DemandPrefill = {
  service?: string;
  subject?: string;
  curriculum?: string;
  level?: string;
};

export function demandPrefillParams(action: Extract<DemandAction, { kind: "add" }>): DemandPrefill {
  const out: DemandPrefill = { service: action.serviceId };
  if (action.subjectId) out.subject = action.subjectId;
  if (action.curriculumId) out.curriculum = action.curriculumId;
  if (action.levelId) out.level = action.levelId;
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads prefill search params defensively: anything that isn't a uuid is dropped. */
export function readDemandPrefill(raw: Record<string, unknown> | null | undefined): DemandPrefill {
  const out: DemandPrefill = {};
  for (const key of ["service", "subject", "curriculum", "level"] as const) {
    const v = raw?.[key];
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === "string" && UUID.test(s)) out[key] = s;
  }
  return out;
}
