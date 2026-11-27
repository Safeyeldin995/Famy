import { describe, expect, it } from "vitest";
import { isProductionSupabaseUrl } from "./otpIntegration.harness";

describe("integration harness Production guard", () => {
  it("recognises the Production Supabase project", () => {
    expect(isProductionSupabaseUrl("https://mjhkaiabfnzewprcnojp.supabase.co")).toBe(true);
    expect(isProductionSupabaseUrl("https://MJHKAIABFNZEWPRCNOJP.supabase.co/")).toBe(true);
  });

  it("allows the QA project and local stacks", () => {
    expect(isProductionSupabaseUrl("https://bfwveoqbyqlhixjvdzha.supabase.co")).toBe(false);
    expect(isProductionSupabaseUrl("http://127.0.0.1:54321")).toBe(false);
    expect(isProductionSupabaseUrl(undefined)).toBe(false);
  });
});
