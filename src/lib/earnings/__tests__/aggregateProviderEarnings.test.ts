import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/locales/en";
import ar from "@/lib/i18n/locales/ar";
import {
  aggregateProviderEarnings,
  EARNINGS_LABEL,
  earningsHeadlineKind,
  earningsLabelKey,
  isCommissionSnapshotted,
  providerBookingValue,
  type ProviderEarningsBooking,
} from "../aggregateProviderEarnings";

const NOW = new Date("2026-10-01T12:00:00.000Z");

function row(
  partial: Partial<ProviderEarningsBooking> & Pick<ProviderEarningsBooking, "start_at" | "status">,
): ProviderEarningsBooking {
  return {
    price_subtotal: 200,
    price_extras_total: 50,
    price_travel_fee: 40,
    ...partial,
  };
}

describe("provider booking value", () => {
  it("is subtotal + extras + travel and never the customer total", () => {
    expect(
      providerBookingValue({
        price_subtotal: 200,
        price_extras_total: 50,
        price_travel_fee: 40,
      }),
    ).toBe(290);
  });
});

describe("earnings labels", () => {
  it("never calls an unsnapshotted amount earned or net", () => {
    expect(earningsLabelKey("bookingValue")).toBe(EARNINGS_LABEL.bookingValue);
    expect(en.pro.earnings.bookingValue.toLowerCase()).not.toMatch(/earn|net/);
    expect(ar.pro.earnings.bookingValue).toBe("قيمة الحجز");
    expect(ar.pro.earnings.commissionUnrecorded).toBe("العمولة غير مسجلة لهذا الحجز");
    expect(en.pro.earnings).not.toHaveProperty("totalEarned");
    expect(ar.pro.earnings).not.toHaveProperty("totalEarned");
  });

  it("uses net labels only for snapshotted amounts", () => {
    expect(isCommissionSnapshotted({ price_provider_net: 258.75 })).toBe(true);
    expect(isCommissionSnapshotted({ price_provider_net: null })).toBe(false);
    expect(earningsLabelKey("net")).toBe("pro.earnings.yourNet");
    expect(en.pro.earnings.yourNet.toLowerCase()).toContain("net");
  });
});

describe("aggregateProviderEarnings", () => {
  it("keeps snapshotted net and unsnapshotted booking value as separate sums", () => {
    const capturedAt = "2026-10-01T08:00:00.000Z";
    const totals = aggregateProviderEarnings(
      [
        row({
          id: "snap",
          status: "completed",
          start_at: capturedAt,
          price_provider_net: 258.75,
          price_commission_percent: 12.5,
          price_commission_amount: 31.25,
          payments: [{ status: "captured", amount: 999, captured_at: capturedAt }],
        }),
        row({
          id: "hist",
          status: "completed",
          start_at: capturedAt,
          price_provider_net: null,
          payments: [{ status: "captured", amount: 999, captured_at: capturedAt }],
        }),
        row({
          id: "upcoming-snap",
          status: "confirmed",
          start_at: "2026-10-03T10:00:00.000Z",
          price_provider_net: 175,
          payments: [{ status: "pending", amount: 400 }],
        }),
        row({
          id: "upcoming-hist",
          status: "pending",
          start_at: "2026-10-04T10:00:00.000Z",
          price_provider_net: null,
          payments: [],
        }),
      ],
      NOW,
    );

    expect(totals.captured).toEqual({ net: 258.75, bookingValue: 290 });
    expect(totals.captured.net + totals.captured.bookingValue).not.toBe(totals.captured.net);
    expect(totals.mtd).toEqual({ net: 258.75, bookingValue: 290 });
    expect(totals.last7).toEqual({ net: 258.75, bookingValue: 290 });
    expect(totals.upcoming).toEqual({ net: 175, bookingValue: 290 });
    expect(totals.completedCount).toBe(2);
    expect(totals.hasSnapshottedCaptured).toBe(true);
    expect(totals.hasUnsnapshottedCaptured).toBe(true);
    expect(
      earningsHeadlineKind(totals.hasSnapshottedCaptured, totals.hasUnsnapshottedCaptured),
    ).toBe("mixed");
  });

  it("does not count pending payments as captured", () => {
    const totals = aggregateProviderEarnings(
      [
        row({
          status: "completed",
          start_at: "2026-10-01T08:00:00.000Z",
          price_provider_net: 175,
          payments: [{ status: "pending", amount: 400 }],
        }),
      ],
      NOW,
    );
    expect(totals.captured).toEqual({ net: 0, bookingValue: 0 });
    expect(totals.completedCount).toBe(0);
    expect(totals.upcoming.net).toBe(0);
  });

  it("labels an unsnapshotted-only set as booking value, not net", () => {
    const totals = aggregateProviderEarnings(
      [
        row({
          status: "completed",
          start_at: "2026-09-30T08:00:00.000Z",
          price_provider_net: null,
          payments: [{ status: "captured", captured_at: "2026-09-30T08:00:00.000Z" }],
        }),
      ],
      NOW,
    );
    expect(totals.captured).toEqual({ net: 0, bookingValue: 290 });
    expect(
      earningsHeadlineKind(totals.hasSnapshottedCaptured, totals.hasUnsnapshottedCaptured),
    ).toBe("bookingValue");
    expect(earningsLabelKey("bookingValue")).not.toMatch(/net|earned/i);
  });
});
