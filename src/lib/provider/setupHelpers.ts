import type { OnboardingReference } from "./onboardingReferences";
import { isFixedPackage, packageEndTime, type PackageService } from "@/lib/pricing/servicePackages";

export type SetupSnapshot = {
  profile?: { full_name?: string; avatar_url?: string | null };
  provider?: {
    years_experience?: number | null;
    bio_ar?: string | null;
    bio_en?: string | null;
    languages?: string[] | null;
    max_children_per_booking?: number | null;
  };
  details?: {
    previous_work?: string | null;
    newborn_experience?: boolean;
    first_aid_training?: boolean;
    date_of_birth?: string;
    governorate?: string;
    area?: string;
    full_address?: string;
  };
  age_group_capabilities?: {
    age_group_code: string;
    years_experience?: number | null;
    note?: string | null;
    verified_at?: string | null;
    verified_by?: string | null;
  }[];
  needsBabysitting?: boolean;
};
export function mergeExperiencePayload(
  snapshot: SetupSnapshot,
  edits: Partial<ReturnType<typeof experienceDefaults>>,
) {
  return { ...experienceDefaults(snapshot), ...edits };
}
function experienceDefaults(snapshot: SetupSnapshot) {
  const p = snapshot.provider;
  const d = snapshot.details;
  return {
    years_experience: p?.years_experience ?? 0,
    bio_ar: p?.bio_ar ?? "",
    bio_en: p?.bio_en ?? "",
    languages: p?.languages ?? [],
    previous_work: d?.previous_work ?? "",
    newborn_experience: d?.newborn_experience ?? false,
    first_aid_training: d?.first_aid_training ?? false,
    ...(snapshot.needsBabysitting
      ? {
          max_children_per_booking: p?.max_children_per_booking ?? 1,
          age_group_capabilities: (snapshot.age_group_capabilities ?? []).map((row) => ({
            code: row.age_group_code,
            years_experience: row.years_experience ?? null,
            note: row.note ?? null,
          })),
        }
      : {}),
  };
}
export function mergeReferencesPayload(
  saved: OnboardingReference[],
  edited: { index: number; value: Partial<OnboardingReference> }[],
) {
  const references = saved.map((row) => ({ ...row }));
  for (const { index, value } of edited)
    references[index] = {
      ...(references[index] ?? { full_name: "", relationship: "", phone: "", notes: "" }),
      ...value,
    };
  return { references };
}
export type WorkingRule = { weekday: number; start_time: string; end_time: string };
export function defaultWorkingHours(): WorkingRule[] {
  // PostgreSQL extract(dow): Sunday = 0, Saturday = 6, as in pro.availability.tsx.
  return [0, 1, 2, 3, 4].map((weekday) => ({ weekday, start_time: "09:00", end_time: "17:00" }));
}
export function workingHoursState(rules: WorkingRule[], services: PackageService[]) {
  const fixed = services.filter((s) => isFixedPackage(s) && s.fixed_start_time);
  const needsNight = fixed.some(
    (s) =>
      !rules.some(
        (r) =>
          r.start_time.slice(0, 5) <= s.fixed_start_time!.slice(0, 5) &&
          r.end_time.slice(0, 5) >= packageEndTime(s),
      ),
  );
  const defaults = defaultWorkingHours();
  const isDefault =
    rules.length === defaults.length &&
    defaults.every((d) =>
      rules.some(
        (r) =>
          r.weekday === d.weekday &&
          r.start_time.slice(0, 5) === d.start_time &&
          r.end_time.slice(0, 5) === d.end_time,
      ),
    );
  return { done: rules.length > 0 && !needsNight, needsNight, isDefault };
}
export function setupDateOfBirth(year: string, month: string, day: string, today = new Date()) {
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  )
    return null;
  const cutoff = new Date(Date.UTC(today.getFullYear() - 18, today.getMonth(), today.getDate()));
  return date <= cutoff ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` : null;
}
