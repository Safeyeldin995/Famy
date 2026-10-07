import { expect, it } from "vitest";
import {
  defaultWorkingHours,
  mergeExperiencePayload,
  mergeReferencesPayload,
  setupDateOfBirth,
  workingHoursState,
} from "../setupHelpers";
import { nextInteger } from "@/components/famio/NumberStepper";
it("merges bio edits without clearing other experience fields", () => {
  const snapshot = {
    provider: {
      languages: ["ar", "en"],
      bio_en: "Saved bio",
      years_experience: 4,
      max_children_per_booking: 3,
    },
    details: { previous_work: "Saved work", newborn_experience: true, first_aid_training: true },
    needsBabysitting: true,
    age_group_capabilities: [
      { age_group_code: "preschool", years_experience: 2, note: "Saved note" },
    ],
  };
  expect(mergeExperiencePayload(snapshot, { bio_ar: "نبذة" })).toEqual({
    years_experience: 4,
    bio_ar: "نبذة",
    bio_en: "Saved bio",
    languages: ["ar", "en"],
    previous_work: "Saved work",
    newborn_experience: true,
    first_aid_training: true,
    max_children_per_booking: 3,
    age_group_capabilities: [{ code: "preschool", years_experience: 2, note: "Saved note" }],
  });
  expect(mergeExperiencePayload({ ...snapshot, needsBabysitting: false }, {})).not.toHaveProperty(
    "max_children_per_booking",
  );
});
it("keeps the other reference and saved notes when editing one", () => {
  const saved = [
    { full_name: "First", relationship: "Work", phone: "synthetic-a", notes: "Keep" },
    { full_name: "Second", relationship: "Work", phone: "synthetic-b", notes: "Other" },
  ];
  const result = mergeReferencesPayload(saved, [{ index: 0, value: { full_name: "Changed" } }]);
  expect(result.references[1]).toEqual(saved[1]);
  expect(result.references[0].notes).toBe("Keep");
  expect(saved[0].full_name).toBe("First");
});
it("uses Sunday=0 through Saturday=6, matching PostgreSQL DOW and pro.availability", () => {
  expect(defaultWorkingHours()).toEqual(
    [0, 1, 2, 3, 4].map((weekday) => ({ weekday, start_time: "09:00", end_time: "17:00" })),
  );
  expect(workingHoursState(defaultWorkingHours(), [])).toEqual({
    done: true,
    needsNight: false,
    isDefault: true,
  });
  const night = [{ pricing_model: "fixed", fixed_start_time: "18:00:00", duration_min: 360 }];
  expect(workingHoursState(defaultWorkingHours(), night).done).toBe(false);
  expect(
    workingHoursState([{ weekday: 0, start_time: "18:00", end_time: "24:00" }], night).done,
  ).toBe(true);
  expect(workingHoursState([], []).done).toBe(false);
});
it("keeps integer steps within bounds", () => {
  expect(nextInteger(5, 1, 1, 6, 2)).toBe(6);
  expect(nextInteger(1, -1, 1, 6, 1)).toBe(1);
  expect(nextInteger(4, -1, 0, 40, 1)).toBe(3);
});
it("accepts real adult birthdays only", () => {
  const today = new Date(2026, 9, 8);
  expect(setupDateOfBirth("2008", "10", "8", today)).toBe("2008-10-08");
  expect(setupDateOfBirth("2008", "10", "9", today)).toBeNull();
  expect(setupDateOfBirth("2000", "2", "30", today)).toBeNull();
});
