import { onlineLessonJourneyIndex } from "./onlineLessonJourney";
import { onlineLessonPaymentDeadline } from "./onlineLessonPaymentDeadline";
import { sessionJoinWindow } from "@/lib/livekit/sessionAccess";

export type OnlineLessonDetailGuidance = {
  messageKey: string;
  messageParams?: Record<string, string>;
  showJoinDisabled?: boolean;
  joinOpensAt?: Date;
};

export function onlineLessonDetailGuidance(input: {
  status: string;
  paymentCaptured: boolean;
  paidHeld: boolean;
  confirmedAt: string | null | undefined;
  startAt: Date;
  endAt: Date;
  now?: number;
  locale: string;
}): OnlineLessonDetailGuidance | null {
  const now = input.now ?? Date.now();
  const journey = onlineLessonJourneyIndex(
    input.status,
    input.paymentCaptured,
    now,
    input.startAt.toISOString(),
    input.endAt.toISOString(),
  );

  if (journey === 0) {
    return { messageKey: "onlineLesson.journey.next.requested" };
  }

  if (journey === 1 && input.confirmedAt) {
    const deadline = onlineLessonPaymentDeadline(input.confirmedAt, input.startAt.toISOString());
    const time = new Intl.DateTimeFormat(input.locale, {
      timeZone: "Africa/Cairo",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(deadline);
    return {
      messageKey: "onlineWeb.lessonDetail.payBy",
      messageParams: { time },
    };
  }

  if (journey === 1) {
    return { messageKey: "onlineLesson.journey.next.confirmed" };
  }

  const join = sessionJoinWindow(input.startAt, input.endAt, new Date(now));
  const opensLabel = new Intl.DateTimeFormat(input.locale, {
    timeZone: "Africa/Cairo",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(join.opensAt);

  if (journey >= 2 && !join.open && input.paymentCaptured) {
    return {
      messageKey: "onlineWeb.lessonDetail.joinFrom",
      messageParams: { time: opensLabel },
      showJoinDisabled: true,
      joinOpensAt: join.opensAt,
    };
  }

  if (input.paidHeld && !input.paymentCaptured) {
    return { messageKey: "payment.awaitingReview" };
  }

  if (journey === 2) {
    return { messageKey: "onlineLesson.journey.next.paid" };
  }
  if (journey === 3) {
    return { messageKey: "onlineLesson.journey.next.startingSoon" };
  }
  if (journey === 4) {
    return { messageKey: "onlineLesson.journey.next.inLesson" };
  }
  if (journey === 5) {
    return { messageKey: "onlineLesson.journey.next.done" };
  }

  return null;
}