import type { TeachingCapabilityOption } from "./teachingCapabilities";
import { isTeachingCurriculumNa } from "./lessonServices";
import { teachingLevelsForCurriculum } from "./teachingLevelFilters";

export type CapabilityPickValue = {
  subjectCode: string;
  curriculumId: string;
  levelId: string;
};

export type LabeledOption = { value: string; label: string };

export function approvedCapabilitiesForService(
  capabilities: TeachingCapabilityOption[],
  serviceId: string | null | undefined,
): TeachingCapabilityOption[] {
  return capabilities.filter(
    (cap) => cap.status === "approved" && (!serviceId || cap.serviceId === serviceId),
  );
}

function uniqueByValue(options: LabeledOption[]): LabeledOption[] {
  const seen = new Set<string>();
  return options.filter((row) => {
    if (!row.value || seen.has(row.value)) return false;
    seen.add(row.value);
    return true;
  });
}

export function subjectOptionsFromCapabilities(
  capabilities: TeachingCapabilityOption[],
  lang: "en" | "ar",
): LabeledOption[] {
  const rows = uniqueByValue(
    capabilities.map((cap) => ({
      value: cap.subjectCode,
      label: lang === "ar" ? cap.subjectNameAr : cap.subjectNameEn,
    })),
  );
  return rows.sort((a, b) => a.label.localeCompare(b.label, lang === "ar" ? "ar" : "en"));
}

export function curriculumOptionsFromCapabilities(
  capabilities: TeachingCapabilityOption[],
  subjectCode: string,
  lang: "en" | "ar",
): LabeledOption[] {
  if (!subjectCode) return [];
  const rows = uniqueByValue(
    capabilities
      .filter((cap) => cap.subjectCode === subjectCode && !isTeachingCurriculumNa(cap.curriculumCode))
      .map((cap) => ({
        value: cap.curriculumId,
        label: lang === "ar" ? cap.curriculumNameAr : cap.curriculumNameEn,
      })),
  );
  return rows.sort((a, b) => a.label.localeCompare(b.label, lang === "ar" ? "ar" : "en"));
}

export function levelOptionsFromCapabilities(
  capabilities: TeachingCapabilityOption[],
  subjectCode: string,
  curriculumId: string,
  lang: "en" | "ar",
): LabeledOption[] {
  if (!subjectCode) return [];
  const scoped = capabilities.filter((cap) => {
    if (cap.subjectCode !== subjectCode) return false;
    if (curriculumId) return cap.curriculumId === curriculumId;
    return isTeachingCurriculumNa(cap.curriculumCode);
  });
  const curriculumCode = scoped[0]?.curriculumCode ?? null;
  const filtered = teachingLevelsForCurriculum(
    curriculumCode,
    scoped.map((cap) => ({
      id: cap.levelId,
      code: cap.levelCode,
      name_en: cap.levelNameEn,
      name_ar: cap.levelNameAr,
    })),
  );
  const allowed = new Set(scoped.map((cap) => cap.levelId));
  const rows = uniqueByValue(
    filtered
      .filter((level) => allowed.has(level.id))
      .map((level) => ({
        value: level.id,
        label: (lang === "ar" ? level.name_ar : level.name_en) || level.id,
      })),
  );
  return rows.sort((a, b) => a.label.localeCompare(b.label, lang === "ar" ? "ar" : "en"));
}

export function capabilitiesMatchingPick(
  capabilities: TeachingCapabilityOption[],
  pick: CapabilityPickValue,
): TeachingCapabilityOption[] {
  return capabilities.filter((cap) => {
    if (pick.subjectCode && cap.subjectCode !== pick.subjectCode) return false;
    if (pick.curriculumId && cap.curriculumId !== pick.curriculumId) return false;
    if (pick.levelId && cap.levelId !== pick.levelId) return false;
    return true;
  });
}

export function soleOptionValue(options: LabeledOption[]): string {
  return options.length === 1 ? options[0]!.value : "";
}

export function coerceCapabilityPick(
  capabilities: TeachingCapabilityOption[],
  pick: CapabilityPickValue,
  requiresCurriculum: boolean,
): CapabilityPickValue {
  const subjects = subjectOptionsFromCapabilities(capabilities, "en");
  let subjectCode = subjects.some((row) => row.value === pick.subjectCode)
    ? pick.subjectCode
    : soleOptionValue(subjects);
  const curricula = curriculumOptionsFromCapabilities(capabilities, subjectCode, "en");
  let curriculumId = requiresCurriculum
    ? curricula.some((row) => row.value === pick.curriculumId)
      ? pick.curriculumId
      : soleOptionValue(curricula)
    : "";
  const levels = levelOptionsFromCapabilities(
    capabilities,
    subjectCode,
    curriculumId || (requiresCurriculum ? "" : curricula[0]?.value ?? ""),
    "en",
  );
  let levelId = levels.some((row) => row.value === pick.levelId)
    ? pick.levelId
    : soleOptionValue(levels);
  if (!requiresCurriculum && !curriculumId && levels.length) {
    const lessonCap = capabilities.find(
      (cap) => cap.subjectCode === subjectCode && cap.levelId === levelId,
    );
    curriculumId = lessonCap?.curriculumId ?? "";
  }
  return { subjectCode, curriculumId, levelId };
}

export function capabilityPickFromCapability(
  cap: TeachingCapabilityOption | null | undefined,
): CapabilityPickValue {
  if (!cap) return { subjectCode: "", curriculumId: "", levelId: "" };
  return {
    subjectCode: cap.subjectCode,
    curriculumId: isTeachingCurriculumNa(cap.curriculumCode) ? "" : cap.curriculumId,
    levelId: cap.levelId,
  };
}