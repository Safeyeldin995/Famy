import { describe, expect, it } from "vitest";
import { onlineLessonSessionHref, resolveOnlineLessonSessionPath } from "@/lib/resolveOnlineLessonLink";

const bookingId = "b1";
const customerId = "cust-1";
const providerUserId = "prov-user-1";

describe("resolveOnlineLessonSessionPath", () => {
  it("routes the provider to the pro session screen", () => {
    expect(
      resolveOnlineLessonSessionPath(bookingId, providerUserId, {
        customerId,
        providerProfileId: providerUserId,
      }),
    ).toBe("/pro-booking/[id]/session");
    expect(
      onlineLessonSessionHref(bookingId, providerUserId, {
        customerId,
        providerProfileId: providerUserId,
      }),
    ).toBe("/pro-booking/b1/session");
  });

  it("routes the customer to the customer session screen", () => {
    expect(
      resolveOnlineLessonSessionPath(bookingId, customerId, {
        customerId,
        providerProfileId: providerUserId,
      }),
    ).toBe("/booking/[id]/session");
    expect(
      onlineLessonSessionHref(bookingId, customerId, {
        customerId,
        providerProfileId: providerUserId,
      }),
    ).toBe("/booking/b1/session");
  });

  it("falls back to customer session when provider profile is unknown", () => {
    expect(
      onlineLessonSessionHref(bookingId, providerUserId, {
        customerId,
        providerProfileId: null,
      }),
    ).toBe("/booking/b1/session");
  });
});