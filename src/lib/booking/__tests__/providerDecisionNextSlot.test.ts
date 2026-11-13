import { describe, expect, it } from "vitest";
import { providerDecisionNextSlotLine } from "../providerDecisionNextSlot";

describe("providerDecisionNextSlotLine", () => {
  const t = (key: string) => key;
  const slot = { start: new Date(), end: new Date(), label: "" };

  it("hides the line when settings or slots error", () => {
    expect(
      providerDecisionNextSlotLine({
        slot,
        settingsReady: true,
        slotsReady: true,
        settingsErrored: true,
        slotsErrored: false,
        language: "ar",
        cairoTime: false,
        t,
      }),
    ).toBeNull();
  });

  it("returns copy when a slot is ready", () => {
    expect(
      providerDecisionNextSlotLine({
        slot,
        settingsReady: true,
        slotsReady: true,
        settingsErrored: false,
        slotsErrored: false,
        language: "en",
        cairoTime: false,
        t,
      }),
    ).toBe("providerPage.nextSlot");
  });
});
