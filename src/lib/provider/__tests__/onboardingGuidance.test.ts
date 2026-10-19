import { describe, expect, it } from "vitest";
import {
  guidanceItem,
  localOnboardingMissing,
  onboardingMissingItems,
} from "../onboardingGuidance";
const complete = {
  legalName: "Test",
  dob: "1990-01-01",
  governorate: "G",
  area: "A",
  address: "Street",
  photo: true,
  services: true,
  prices: true,
  bioEn: "Experience",
  bioAr: "",
  years: 0,
  babysitting: false,
  maxChildren: "" as const,
  ageGroups: 0,
  coverage: true,
  references: [
    { full_name: "Test", relationship: "client", phone: "fixture", notes: "" },
    { full_name: "", relationship: "", phone: "", notes: "" },
  ],
  idFront: true,
  idBack: true,
  confirmed: true,
};
describe("onboarding guidance", () => {
  it("does not add requirements to a complete draft or require reference two", () => {
    expect(localOnboardingMissing(complete)).toEqual([]);
  });
  it("points missing contact, coverage and ID back to their exact fields without changing drafts", () => {
    const draft = {
      ...complete,
      references: [{ ...complete.references[0], phone: "" }],
      coverage: false,
      idBack: false,
    };
    const before = structuredClone(draft);
    expect(localOnboardingMissing(draft)).toEqual([
      guidanceItem("coverage"),
      guidanceItem("reference-0-refPhone"),
      guidanceItem("idBack"),
    ]);
    expect(draft).toEqual(before);
    expect(guidanceItem("reference-0-refPhone").section).toBe("references");
    expect(guidanceItem("idBack").section).toBe("review");
  });
  it("maps server reasons, deduplicates and preserves unknown failures as review actions", () => {
    expect(
      onboardingMissingItems([guidanceItem("idBack")], { documents: "national_id_required" }),
    ).toEqual([guidanceItem("idBack")]);
    expect(onboardingMissingItems([], { coverage: "zone_required" })[0].field).toBe("coverage");
    expect(onboardingMissingItems([], { references: "duplicate_reference_phones" })[0].field).toBe(
      "reference-1-refPhone",
    );
    expect(onboardingMissingItems([], { other: "new_server_reason" })[0]).toMatchObject({
      field: "review",
      error: "new_server_reason",
    });
  });
  it("shows every absent personal field and required confirmation; partial optional references stay required", () => {
    const fields = localOnboardingMissing({
      ...complete,
      dob: "",
      area: "",
      confirmed: false,
      references: [complete.references[0], { ...complete.references[1], notes: "contact" }],
    }).map((i) => i.field);
    expect(fields).toEqual([
      "dob",
      "area",
      "reference-1-refName",
      "reference-1-refRelationship",
      "reference-1-refPhone",
      "confirmed",
    ]);
  });
});
