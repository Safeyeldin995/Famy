export type TeachingLevelRow = {
  id: string;
  code?: string | null;
  name_en?: string;
  name_ar?: string;
  is_active?: boolean;
  sort_order?: number;
};

export type TeachingServiceLevelRow = {
  service_id: string;
  level_id: string;
};

const BRITISH_LEVEL_CODES = new Set(["g10", "g11", "g12"]);

export function teachingLevelsForService(
  serviceId: string,
  levels: TeachingLevelRow[],
  serviceLevelLinks: TeachingServiceLevelRow[],
): TeachingLevelRow[] {
  const allowed = new Set(
    serviceLevelLinks.filter((row) => row.service_id === serviceId).map((row) => row.level_id),
  );
  if (allowed.size === 0) return levels;
  return levels.filter((row) => allowed.has(row.id));
}

export function teachingLevelsForCurriculum(
  curriculumCode: string | null | undefined,
  levels: TeachingLevelRow[],
): TeachingLevelRow[] {
  if (curriculumCode === "british") {
    return levels.filter((row) => BRITISH_LEVEL_CODES.has(row.code ?? ""));
  }
  return levels;
}

export function teachingLevelsForServiceAndCurriculum(
  serviceId: string,
  curriculumCode: string | null | undefined,
  levels: TeachingLevelRow[],
  serviceLevelLinks: TeachingServiceLevelRow[],
): TeachingLevelRow[] {
  return teachingLevelsForCurriculum(
    curriculumCode,
    teachingLevelsForService(serviceId, levels, serviceLevelLinks),
  );
}

export type TeachingCapabilityUpsertInput = {
  serviceId: string;
  subjectId: string;
  curriculumId: string;
  levelId: string;
  sessionDurationMin: number;
  sessionPrice: number;
  id?: string | null;
};

export type TeachingCapabilityUpsertOutcome = {
  levelId: string;
  ok: boolean;
  error?: string;
};

export async function upsertTeachingCapabilitiesForLevels(
  levelIds: string[],
  base: Omit<TeachingCapabilityUpsertInput, "levelId">,
  upsertOne: (input: TeachingCapabilityUpsertInput) => Promise<unknown>,
): Promise<TeachingCapabilityUpsertOutcome[]> {
  const outcomes: TeachingCapabilityUpsertOutcome[] = [];
  for (const levelId of levelIds) {
    try {
      await upsertOne({ ...base, levelId });
      outcomes.push({ levelId, ok: true });
    } catch (error: unknown) {
      outcomes.push({
        levelId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return outcomes;
}
