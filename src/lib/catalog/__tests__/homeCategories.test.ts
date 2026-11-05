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
