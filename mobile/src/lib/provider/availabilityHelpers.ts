export type WorkingRule = { weekday: number; start_time: string; end_time: string };

export function hasSharedWorkingHours(rules: WorkingRule[]) {
  return (
    rules.length > 0 &&
    new Set(rules.map((row) => row.weekday)).size === rules.length &&
    rules.every(
      (row) =>
        row.start_time.slice(0, 5) === rules[0].start_time.slice(0, 5) &&
        row.end_time.slice(0, 5) === rules[0].end_time.slice(0, 5),
    )
  );
}

export function setSharedWorkingHours(
  rules: WorkingRule[],
  start_time: string,
  end_time: string,
): WorkingRule[] {
  return [...new Set(rules.map((row) => row.weekday))].map((weekday) => ({
    weekday,
    start_time,
    end_time,
  }));
}
