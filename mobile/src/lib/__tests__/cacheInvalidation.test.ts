import { describe, expect, it } from "vitest";
import {
  bookingCancelInvalidationKeys,
  invalidateQueryKeyList,
  notificationReadInvalidationKeys,
  rescheduleActionInvalidationKeys,
  shouldAbandonOtpOnExpiry,
  submitReviewInvalidationKeys,
} from "../cacheInvalidation";

describe("mobile cache invalidation keys", () => {
  it("includes unread badge keys when notifications are marked read", () => {
    const keys = notificationReadInvalidationKeys().map((k) => k.join("/"));
    expect(keys).toContain("notifications/unread-count");
    expect(keys).toContain("pro-notifications/unread-count");
  });

  it("refreshes provider booking lists after reschedule actions", () => {
    const keys = rescheduleActionInvalidationKeys("b1").map((k) => k.join("/"));
    expect(keys).toContain("provider-booking/b1");
    expect(keys).toContain("provider-bookings");
  });

  it("keeps customer and provider booking caches aligned on cancel", () => {
    const keys = bookingCancelInvalidationKeys("b1").map((k) => k.join("/"));
    expect(keys).toContain("booking/b1");
    expect(keys).toContain("my-bookings");
    expect(keys).toContain("provider-booking/b1");
  });

  it("refreshes provider reviews after a new review", () => {
    const keys = submitReviewInvalidationKeys("b1", "p1").map((k) => k.join("/"));
    expect(keys).toContain("booking-review/b1");
    expect(keys).toContain("reviews/p1");
  });
});

describe("shouldAbandonOtpOnExpiry", () => {
  it("does not abandon while verifying or resending", () => {
    expect(
      shouldAbandonOtpOnExpiry({
        otpExpiresIn: 0,
        loadingContext: false,
        verifying: true,
        resending: false,
      }),
    ).toBe(false);
    expect(
      shouldAbandonOtpOnExpiry({
        otpExpiresIn: 0,
        loadingContext: false,
        verifying: false,
        resending: true,
      }),
    ).toBe(false);
  });

  it("abandons when timer elapsed and screen is idle", () => {
    expect(
      shouldAbandonOtpOnExpiry({
        otpExpiresIn: 0,
        loadingContext: false,
        verifying: false,
        resending: false,
      }),
    ).toBe(true);
  });
});

describe("invalidateQueryKeyList", () => {
  it("resolves only after every invalidation has finished", async () => {
    const order: string[] = [];
    const qc = {
      invalidateQueries: ({ queryKey }: { queryKey: readonly string[] }) =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            order.push(queryKey.join("/"));
            resolve();
          }, 5),
        ),
    };
    await invalidateQueryKeyList(qc as never, [["a"], ["b"]]);
    order.push("done");
    expect(order).toEqual(["a", "b", "done"]);
  });
});
