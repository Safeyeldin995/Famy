import { describe, expect, it } from "vitest";
import {
  guaranteeCardState,
  guaranteeCoversCategory,
  guaranteeErrorKey,
  launchCommissionLastDay,
  launchCommissionPercentLabel,
  parseFirstLessonGuarantee,
  parseGuaranteeStatus,
  parseMyLaunchCommission,
} from "../launchOffers";

describe("launch offers helpers", () => {
  it("treats a missing or broken guarantee row as off", () => {
    expect(parseFirstLessonGuarantee(null).enabled).toBe(false);
    expect(parseFirstLessonGuarantee({ enabled: "yes" }).enabled).toBe(false);
    const on = parseFirstLessonGuarantee({ enabled: true, category_slugs: ["quran"] });
    expect(guaranteeCoversCategory(on, "quran")).toBe(true);
    expect(guaranteeCoversCategory(on, "babysitting")).toBe(false);
    expect(guaranteeCoversCategory(on, null)).toBe(false);
  });

  it("picks the right card for each status", () => {
    expect(guaranteeCardState(null)).toBeNull();
    expect(
      guaranteeCardState(parseGuaranteeStatus({ eligible: true, blocked: null, amount: 300 })),
    ).toBe("offer");
    expect(
      guaranteeCardState(
        parseGuaranteeStatus({
          eligible: false,
          blocked: "already_claimed",
          amount: 0,
          claim: { id: "c", amount: 300, status: "claimed", created_at: "x" },
        }),
      ),
    ).toBe("claimed");
    expect(
      guaranteeCardState(
        parseGuaranteeStatus({
          eligible: false,
          blocked: "already_claimed",
          claim: { id: "c", amount: 300, status: "reversed", created_at: "x" },
        }),
      ),
    ).toBeNull();
    expect(
      guaranteeCardState(parseGuaranteeStatus({ eligible: false, blocked: "money_flag_open" })),
    ).toBe("waiting");
    expect(
      guaranteeCardState(parseGuaranteeStatus({ eligible: false, blocked: "not_first_lesson" })),
    ).toBeNull();
  });

  it("maps database refusals to short messages", () => {
    expect(guaranteeErrorKey("GUARANTEE_BLOCKED:monthly_limit")).toBe(
      "firstLessonGuarantee.errors.monthlyLimit",
    );
    expect(guaranteeErrorKey("GUARANTEE_BLOCKED:tutor_already_used")).toBe(
      "firstLessonGuarantee.errors.alreadyUsed",
    );
    expect(guaranteeErrorKey("network down")).toBe("firstLessonGuarantee.errors.generic");
  });

  it("shows the last day of the lower commission in Cairo with Western digits", () => {
    // Ends at Cairo midnight starting 1 Dec: the last day is 30 Nov.
    const label = launchCommissionLastDay("2026-11-30T22:00:00Z", "ar");
    expect(label).toMatch(/30/);
    expect(label).not.toMatch(/[٠-٩]/);
    expect(launchCommissionLastDay("2026-11-30T22:00:00Z", "en")).toMatch(/30 November/);
  });

  it("reads the provider's commission status", () => {
    expect(parseMyLaunchCommission({ active: false })).toEqual({ active: false });
    const on = parseMyLaunchCommission({
      active: true,
      ends_at: "2026-12-28T10:00:00Z",
      starts_at: "2026-11-28T10:00:00Z",
      percent_in_person: 7.5,
      percent_online: null,
      regular_in_person: 15,
      regular_online: 15,
    });
    expect(on.active).toBe(true);
    expect(launchCommissionPercentLabel(on)).toBe("7.5%");
  });
});
