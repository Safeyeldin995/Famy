import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { promoFitsMode } from "@/lib/db/promo-codes-queries";

describe("promoFitsMode", () => {
  it("shows codes for every booking when the mode is all or unknown", () => {
    expect(promoFitsMode("all", "online")).toBe(true);
    expect(promoFitsMode("all", "in_person")).toBe(true);
    expect(promoFitsMode(undefined, "online")).toBe(true);
  });

  it("hides codes limited to the other booking mode", () => {
    expect(promoFitsMode("online", "online")).toBe(true);
    expect(promoFitsMode("online", "in_person")).toBe(false);
    expect(promoFitsMode("in_person", "online")).toBe(false);
    expect(promoFitsMode("in_person", "in_person")).toBe(true);
  });
});
