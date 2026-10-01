import { describe, expect, it, vi } from "vitest";
import {
  teachingLevelsForCurriculum,
  upsertTeachingCapabilitiesForLevels,
} from "@/lib/tutoring/teachingLevelFilters";

describe("teachingLevelFilters", () => {
  it("filters British curriculum levels to grades 10–12", () => {
    const levels = [
      { id: "1", code: "g9", name_en: "G9", name_ar: "G9", is_active: true, sort_order: 1 },
      { id: "2", code: "g10", name_en: "G10", name_ar: "G10", is_active: true, sort_order: 2 },
      { id: "3", code: "g12", name_en: "G12", name_ar: "G12", is_active: true, sort_order: 3 },
    ];
    expect(teachingLevelsForCurriculum("british", levels).map((row) => row.code)).toEqual([
      "g10",
      "g12",
    ]);
  });

  it("upserts every selected level and continues after a failure", async () => {
    const upsertOne = vi
      .fn()
      .mockResolvedValueOnce("ok-1")
      .mockRejectedValueOnce(new Error("duplicate"))
      .mockResolvedValueOnce("ok-3");
    const outcomes = await upsertTeachingCapabilitiesForLevels(
      ["lvl-1", "lvl-2", "lvl-3"],
      {
        serviceId: "svc",
        subjectId: "sub",
        curriculumId: "cur",
        sessionDurationMin: 120,
        sessionPrice: 400,
      },
      upsertOne,
    );
    expect(upsertOne).toHaveBeenCalledTimes(3);
    expect(outcomes).toEqual([
      { levelId: "lvl-1", ok: true },
      { levelId: "lvl-2", ok: false, error: "duplicate" },
      { levelId: "lvl-3", ok: true },
    ]);
  });
});
