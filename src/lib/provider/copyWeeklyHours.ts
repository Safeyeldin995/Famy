export type WeeklyHoursRow = {
  weekday: number;
  start_time: string;
  end_time: string;
  enabled: boolean;
};

/** Local draft change only: never enables a day or writes to the server. */
export function copyWeeklyHours<T extends WeeklyHoursRow>(
  rows: readonly T[],
  sourceDay: number,
  selectedDays: readonly number[],
): T[] {
  const source = rows.find((row) => row.weekday === sourceDay);
  if (!source?.enabled) return [...rows];
  return rows.map((row) =>
    row.enabled && row.weekday !== sourceDay && selectedDays.includes(row.weekday)
      ? { ...row, start_time: source.start_time, end_time: source.end_time }
      : row,
  );
}
