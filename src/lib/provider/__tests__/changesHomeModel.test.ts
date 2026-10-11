import { expect, it } from "vitest";
import {
  applyStepSearch,
  changesHomeModel,
  providerEntryRedirect,
  submissionErrors,
} from "../changesHomeModel";
const deferred = {
  hours: false,
  photo: false,
  about: false,
  personal: false,
  reference: false,
  babysitting: false,
  needsBabysitting: true,
  subjects: false,
  needsSubjects: true,
};
it("keeps all setup rows plus the three application links in the changes variant", () => {
  const model = changesHomeModel(deferred, { ok: true, complete: true });
  expect(model.applicationItems.map(({ key, step }) => ({ key, step }))).toEqual([
    { key: "basics", step: 1 },
    { key: "services", step: 2 },
    { key: "identity", step: 3 },
  ]);
  expect(model.setupItems.map((item) => item.key)).toEqual([
    "photo",
    "about",
    "babysitting",
    "subjects",
    "reference",
    "personal",
    "hours",
  ]);
  expect(model.canSubmit).toBe(true); // Deferred work never becomes a new submit gate.
});
it("enables resubmit only after an affirmative minimal completeness result", () => {
  expect(changesHomeModel(deferred).canSubmit).toBe(false);
  expect(changesHomeModel(deferred, { ok: false, complete: true }).canSubmit).toBe(false);
  for (const section of ["personal", "coverage", "services", "documents", "review"]) {
    const model = changesHomeModel(deferred, {
      ok: true,
      complete: false,
      errors: { [section]: "required" },
    });
    expect(model.canSubmit).toBe(false);
    expect(model.applicationItems.some((item) => item.highlighted && !item.done)).toBe(true);
  }
});
it("maps returned errors to the matching rows without discarding deferred tasks", () => {
  const error = Object.assign(new Error("submission_incomplete"), {
    completionErrors: {
      coverage: "zone_required",
      services: "provider_price_invalid",
      review: "accuracy_confirmation_required",
    },
  });
  const model = changesHomeModel(deferred, { ok: true, complete: true }, submissionErrors(error));
  expect(model.applicationItems.filter((item) => item.highlighted).map((item) => item.key)).toEqual(
    ["basics", "services", "identity"],
  );
  expect(model.hintKey).toBe("providerApply.missingIdentity");
  expect(model.canSubmit).toBe(false);
  expect(
    changesHomeModel(
      deferred,
      { ok: true, complete: true },
      { references: "reference_required" },
    ).setupItems.find((item) => item.key === "reference")?.highlighted,
  ).toBe(true);
  expect(submissionErrors(new Error("network"))).toEqual({});
  expect(submissionErrors({ completionErrors: null })).toEqual({});
});
it("accepts only apply steps 1 through 3", () => {
  for (const step of [1, 2, 3]) {
    expect(applyStepSearch({ step })).toEqual({ step });
    expect(applyStepSearch({ step: String(step) })).toEqual({ step });
  }
  for (const step of [undefined, 0, 4, "other", 2.5]) expect(applyStepSearch({ step })).toEqual({});
});
it("keeps NEEDS_CHANGES at home and only routes new/draft providers into apply", () => {
  expect(providerEntryRedirect("provider", true, "NEEDS_CHANGES", "/pro")).toBeNull();
  expect(providerEntryRedirect("provider", true, "NEEDS_CHANGES", "/pro/setup/about")).toBeNull();
  expect(providerEntryRedirect("provider", true, "APPROVED", "/pro/profile")).toBeNull();
  expect(providerEntryRedirect("provider", true, "DRAFT", "/pro")).toBe("/pro/apply");
  expect(providerEntryRedirect("provider", false, undefined, "/pro")).toBe("/pro/apply");
  expect(providerEntryRedirect("provider", true, "DRAFT", "/pro/apply")).toBeNull();
  expect(providerEntryRedirect("provider", true, "DRAFT", "/pro/onboarding")).toBeNull();
});
