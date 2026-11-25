import { describe, expect, it } from "vitest";
import { providerSelfServiceBackTarget } from "../providerAccountBack";

describe("providerSelfServiceBackTarget", () => {
  it("returns pro-profile only for approved providers (#434)", () => {
    expect(providerSelfServiceBackTarget(true, "APPROVED")).toBe("/pro-profile");
  });

  it("returns the gated native path for non-approved providers", () => {
    expect(providerSelfServiceBackTarget(true, "SUBMITTED")).toBe("/pro-setup-home");
    expect(providerSelfServiceBackTarget(true, "DRAFT")).toBe("/pro-apply");
    expect(providerSelfServiceBackTarget(true, "REJECTED")).toBe("/pro-setup-home");
  });
});