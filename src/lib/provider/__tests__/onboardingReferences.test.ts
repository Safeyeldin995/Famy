import { describe, expect, it } from "vitest";
import {
  buildReferencesPayload,
  type OnboardingReference,
} from "@/lib/provider/onboardingReferences";

const ref = (partial: Partial<OnboardingReference>): OnboardingReference => ({
  full_name: "",
  relationship: "",
  phone: "",
  notes: "",
  ...partial,
});

describe("buildReferencesPayload", () => {
  it("requires the first reference", () => {
    expect(buildReferencesPayload(ref({}), ref({}))).toEqual({ ok: false, error: "ref1" });
  });

  it("allows an empty second reference", () => {
    const one = ref({
      full_name: "Nadia",
      relationship: "client",
      phone: "+201011122233",
      notes: "weekly",
    });
    expect(buildReferencesPayload(one, ref({}))).toEqual({ ok: true, references: [one] });
  });

  it("rejects a half-filled second reference", () => {
    const one = ref({ full_name: "Nadia", relationship: "client", phone: "+201011122233" });
    expect(buildReferencesPayload(one, ref({ full_name: "Layla" }))).toEqual({
      ok: false,
      error: "ref2",
    });
  });

  it("keeps two complete references including notes", () => {
    const one = ref({
      full_name: "Nadia",
      relationship: "client",
      phone: "+201011122233",
      notes: "weekly",
    });
    const two = ref({
      full_name: "Layla",
      relationship: "neighbor",
      phone: "+201022233344",
      notes: "trusted",
    });
    expect(buildReferencesPayload(one, two)).toEqual({ ok: true, references: [one, two] });
  });
});
