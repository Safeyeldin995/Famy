import { describe, expect, it } from "vitest";
import { teachingUpsertErrorKey } from "@/lib/tutoring/teachingUpsertErrors";

describe("teachingUpsertErrorKey", () => {
  it("maps known TEACHING_* prefixes to i18n keys", () => {
    expect(teachingUpsertErrorKey("TEACHING_INVALID_PRICE: Session price must be whole EGP")).toBe(
      "teaching.errors.invalidPrice",
    );
    expect(teachingUpsertErrorKey("TEACHING_SUBJECT_NOT_LINKED: Level is not active.")).toBe(
      "teaching.errors.subjectNotLinked",
    );
  });

  it("falls back to generic for unknown TEACHING codes and non-teaching text", () => {
    expect(teachingUpsertErrorKey("TEACHING_FUTURE_CODE: secret sql detail")).toBe(
      "teaching.errors.generic",
    );
    expect(teachingUpsertErrorKey("duplicate key value violates unique constraint")).toBe(
      "teaching.errors.generic",
    );
  });
});
