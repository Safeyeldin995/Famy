import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BookAnotherProviderLink, RespondWithinHint } from "@/components/famio/PendingExpiry";
import { expiredRequestCopy, respondWithinLabel } from "@/lib/booking/pending-expiry";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === "pro.bookings.respondWithinMinutes")
        return `Respond within ${options?.count} min`;
      if (key === "pro.bookings.respondWithinHours")
        return `Respond within ${options?.count} hours`;
      if (key === "pro.bookings.respondOverdue") return "Response window closed";
      if (key === "bookingDetail.bookAnotherProvider") return "Book another provider";
      if (key === "bookingDetail.expiredTitle") return "Request expired";
      if (key === "bookingDetail.expiredReason") return "The provider did not respond in time";
      if (key === "bookingDetail.closedCancelledTitle") return "Booking cancelled";
      return key;
    },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: string; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock("@/lib/preview/previewPath", () => ({
  previewPath: (path: string) => path,
}));

describe("pending expiry UI states", () => {
  afterEach(() => cleanup());

  it("shows the expired title and reason for provider_no_response", () => {
    const copy = expiredRequestCopy(
      { status: "cancelled", cancellation_reason: "provider_no_response" },
      (key) =>
        ({
          "bookingDetail.expiredTitle": "Request expired",
          "bookingDetail.expiredReason": "The provider did not respond in time",
          "bookingDetail.closedCancelledTitle": "Booking cancelled",
        })[key] ?? key,
    );
    expect(copy.expired).toBe(true);
    expect(copy.title).toBe("Request expired");
    expect(copy.reason).toBe("The provider did not respond in time");
  });

  it("renders Book another provider", () => {
    render(<BookAnotherProviderLink />);
    expect(screen.getByText("Book another provider")).toBeTruthy();
  });

  it("renders the provider response deadline", () => {
    const createdAt = "2026-10-01T00:00:00.000Z";
    const startAt = "2026-10-02T00:00:00.000Z";
    const now = new Date("2026-10-01T10:00:00.000Z");
    const label = respondWithinLabel(
      createdAt,
      startAt,
      (key, options) => {
        if (key === "pro.bookings.respondWithinHours")
          return `Respond within ${options?.count} hours`;
        return key;
      },
      undefined,
      now,
    );
    expect(label).toBe("Respond within 2 hours");

    render(<RespondWithinHint createdAt={createdAt} startAt={startAt} />);
    expect(screen.getByTestId("respond-within")).toBeTruthy();
  });
});
