import {
  DEFAULT_BOOKING_EXPIRY_SETTINGS,
  pendingResponseDeadline,
  type BookingExpirySettings,
} from "@/lib/booking/pending-expiry";

export type ProviderNextActionKind = "pending_request" | "start_job" | "setup_issue";

export type ProviderNextAction = {
  kind: ProviderNextActionKind;
  bookingId?: string;
  labelKey: string;
  labelParams?: Record<string, string | number>;
  ctaKey?: string;
  route?: string;
};

type BookingRow = {
  id: string;
  status?: string | null;
  created_at?: string;
  start_at: string;
};

export function pickProviderNextAction(input: {
  pending: BookingRow[];
  upcoming: BookingRow[];
  missingDocument: boolean;
  rejectedService: boolean;
  now?: Date;
  expirySettings?: BookingExpirySettings;
}): ProviderNextAction | null {
  const now = input.now ?? new Date();
  const settings = input.expirySettings ?? DEFAULT_BOOKING_EXPIRY_SETTINGS;

  if (input.pending.length > 0) {
    const sorted = [...input.pending].sort((a, b) => {
      const da = pendingResponseDeadline(
        a.created_at ?? a.start_at,
        a.start_at,
        settings,
      ).getTime();
      const db = pendingResponseDeadline(
        b.created_at ?? b.start_at,
        b.start_at,
        settings,
      ).getTime();
      return da - db;
    });
    const soonest = sorted[0];
    const deadline = pendingResponseDeadline(
      soonest.created_at ?? soonest.start_at,
      soonest.start_at,
      settings,
    );
    const minutesLeft = Math.max(0, Math.round((deadline.getTime() - now.getTime()) / 60000));
    return {
      kind: "pending_request",
      bookingId: soonest.id,
      labelKey:
        minutesLeft <= 0
          ? "proNextAction.pendingOverdue"
          : minutesLeft < 60
            ? "proNextAction.pendingMinutes"
            : "proNextAction.pendingHours",
      labelParams:
        minutesLeft <= 0
          ? undefined
          : minutesLeft < 60
            ? { count: minutesLeft }
            : { count: Math.max(1, Math.round(minutesLeft / 60)) },
      ctaKey: "proNextAction.viewRequests",
      route: "/jobs",
    };
  }

  const nextJob = [...input.upcoming]
    .filter((b) => b.start_at)
    .sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at))[0];
  if (nextJob) {
    const startMs = new Date(nextJob.start_at).getTime();
    const withinHour = startMs - now.getTime() <= 3600000 && startMs >= now.getTime() - 60000;
    if (withinHour) {
      return {
        kind: "start_job",
        bookingId: nextJob.id,
        labelKey: "proNextAction.startSoon",
        ctaKey: "proNextAction.start",
        route: `/pro-booking/${nextJob.id}`,
      };
    }
    return {
      kind: "start_job",
      bookingId: nextJob.id,
      labelKey: "proNextAction.nextJob",
      labelParams: { when: nextJob.start_at },
      ctaKey: "proNextAction.openBooking",
      route: `/pro-booking/${nextJob.id}`,
    };
  }

  if (input.missingDocument) {
    return {
      kind: "setup_issue",
      labelKey: "proNextAction.missingDocument",
      ctaKey: "proNextAction.uploadDocument",
      route: "/pro-setup-home",
    };
  }
  if (input.rejectedService) {
    return {
      kind: "setup_issue",
      labelKey: "proNextAction.rejectedService",
      ctaKey: "proNextAction.fixServices",
      route: "/pro-profile-edit",
    };
  }

  return null;
}