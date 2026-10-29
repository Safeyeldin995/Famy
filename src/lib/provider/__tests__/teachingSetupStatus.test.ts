import { expect, it } from "vitest";
import { missingTeachingServices, gradeSummary, teachingDuration } from "../teachingSetupStatus";
it("names each missing service and counts pending but not rejected subjects", () => {
  const services = [{ id: "school" }, { id: "language" }, { id: "homework" }];
  expect(
    missingTeachingServices(services, [
      {
        service_id: "school",
        subject_id: "math",
        level_id: "g1",
        session_price: 400,
        status: "pending",
      },
      {
        service_id: "language",
        subject_id: "english",
        level_id: "g2",
        session_price: 400,
        status: "rejected",
      },
    ]),
  ).toEqual(services.slice(1));
});
it("requires a saved subject, grade and price before a teaching service is complete", () => {
  const service = [{ id: "homework" }];
  const row = {
    service_id: "homework",
    subject_id: "math",
    level_id: "g1",
    session_price: 400,
    status: "pending",
  };
  expect(missingTeachingServices(service, [])).toEqual(service);
  expect(missingTeachingServices(service, [{ ...row, subject_id: "" }])).toEqual(service);
  expect(missingTeachingServices(service, [{ ...row, level_id: "" }])).toEqual(service);
  expect(missingTeachingServices(service, [{ ...row, session_price: 0 }])).toEqual(service);
  expect(missingTeachingServices(service, [row])).toEqual([]);
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
