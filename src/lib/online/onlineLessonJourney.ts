export const ONLINE_LESSON_JOURNEY_STEPS = [
  "requested",
  "confirmed",
  "paid",
  "startingSoon",
  "inLesson",
  "done",
] as const;

export type OnlineLessonJourneyStep = (typeof ONLINE_LESSON_JOURNEY_STEPS)[number];

export function onlineLessonJourneyIndex(
  status: string,
  paymentCaptured: boolean,
  now: number,
  startAt: string,
  endAt: string,
): number {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (status === "completed") return 5;
  if (["in_progress", "completion_requested"].includes(status)) return 4;
  if (paymentCaptured) {
    if (now >= start - 15 * 60_000 && now <= end) return 3;
    return 2;
  }
  if (status === "confirmed") return 1;
  if (status === "pending") return 0;
  return -1;
}