import { describe, expect, it } from "vitest";
import {
  homeCategoryDbSlug,
  homeCategoryLessonSlug,
  isHomeCategoryId,
  servicesForHomeCategory,
} from "../homeCategories";

const services = [
  { slug: "school-subject-tutoring" },
  { slug: "homework-support" },
  { slug: "quran-lessons" },
  { slug: "music-lessons" },
];

describe("homeCategories", () => {
  it("keeps Quran and music out of school tutoring and in their own groups", () => {
    expect(servicesForHomeCategory(services, "tutoring").map((s) => s.slug)).toEqual([
      "school-subject-tutoring",
      "homework-support",
    ]);
    expect(servicesForHomeCategory(services, "quran").map((s) => s.slug)).toEqual([
      "quran-lessons",
    ]);
    expect(servicesForHomeCategory(services, "music").map((s) => s.slug)).toEqual([
      "music-lessons",
    ]);
  });

  it("maps groups to their DB category and lesson service", () => {
    expect(homeCategoryDbSlug("quran")).toBe("tutoring");
    expect(homeCategoryDbSlug("babysitting")).toBe("babysitting");
    expect(homeCategoryLessonSlug("music")).toBe("music-lessons");
    expect(homeCategoryLessonSlug("tutoring")).toBeNull();
    expect(isHomeCategoryId("quran")).toBe(true);
    expect(isHomeCategoryId("cleaning")).toBe(false);
  });
});

describe("home doors", () => {
  it("shows tutoring before babysitting and only live categories", async () => {
    const { visibleHomeDoors } = await import("../homeCategories");
    expect(visibleHomeDoors(["babysitting", "tutoring"])).toEqual(["tutoring", "babysitting"]);
    expect(visibleHomeDoors(["babysitting"])).toEqual(["babysitting"]);
    expect(visibleHomeDoors(["cleaning"])).toEqual([]);
  });

  it("shows Quran and music shortcuts only when their service is live", async () => {
    const { visibleTutoringShortcuts } = await import("../homeCategories");
    expect(visibleTutoringShortcuts(["quran-lessons", "music-lessons", "math"])).toEqual([
      "quran",
      "music",
    ]);
    expect(visibleTutoringShortcuts(["music-lessons", null])).toEqual(["music"]);
    expect(visibleTutoringShortcuts([])).toEqual([]);
  });
});
