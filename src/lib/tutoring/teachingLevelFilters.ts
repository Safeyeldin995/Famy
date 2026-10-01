import type { TeachingLevelRow } from "@/lib/db/teaching-queries";

const BRITISH_LEVEL_CODES = new Set(["g10", "g11", "g12"]);

export function teachingLevelsForCurriculum(
  curriculumCode: string | null | undefined,
  levels: TeachingLevelRow[],
): TeachingLevelRow[] {
  if (curriculumCode === "british") {
    return levels.filter((row) => BRITISH_LEVEL_CODES.has(row.code));
  }
  return levels;
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
