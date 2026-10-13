import { expect, it } from "vitest";
import { missingTeachingServices, gradeSummary, teachingDuration } from "../teachingSetupStatus";
it("names each missing service and counts pending but not rejected subjects", () => {
  const services = [{ id: "school" }, { id: "language" }, { id: "homework" }];
  expect(
    missingTeachingServices(services, [
      { service_id: "school", status: "pending" },
      { service_id: "language", status: "rejected" },
    ]),
  ).toEqual(services.slice(1));
});
it("summarizes consecutive grades and localizes teaching durations", () => {
  expect(
    gradeSummary(
      [
        { code: "kg", name_ar: "رياض الأطفال", name_en: "KG" },
        { code: "g1", name_ar: "الصف الأول", name_en: "Grade 1" },
      ],
      true,
    ),
  ).toBe("من رياض الأطفال لحد الصف الأول");
  expect([60, 90, 120].map((value) => teachingDuration(value, true))).toEqual([
    "ساعة",
    "ساعة ونص",
    "ساعتين",
  ]);
});
