import { notificationDayKey } from "./notificationDay";
export const PROVIDER_JOURNEY_STEPS = [
  "accepted",
  "onTheWay",
  "arrived",
  "started",
  "completed",
] as const;
/** Presentation only: intermediate customer confirmations keep the current milestone. */
export function providerTimelineIndex(status: string): number {
  return (
    (
      {
        confirmed: 0,
        on_the_way: 1,
        arrived: 2,
        arrival_confirmed: 2,
        in_progress: 3,
        completion_requested: 3,
        completed: 4,
      } as Record<string, number>
    )[status] ?? -1
  );
}

export function groupProviderNotifications<T extends { created_at: string }>(items: T[]) {
  const groups = new Map<string, { date: Date; items: T[] }>();
  for (const item of [...items].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))) {
    const date = new Date(item.created_at);
    const key = notificationDayKey(date);
    const group = groups.get(key) ?? { date, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
}
