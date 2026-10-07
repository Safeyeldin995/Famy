import { expect, it } from "vitest";
import { copyWeeklyHours } from "../copyWeeklyHours";

it("copies only selected enabled days, preserves 24:00, and does not mutate the saved rows", () => {
  const rows = [
    { weekday: 0, start_time: "18:00", end_time: "24:00", enabled: true },
    { weekday: 1, start_time: "09:00", end_time: "17:00", enabled: true },
    { weekday: 2, start_time: "10:00", end_time: "19:00", enabled: true },
    { weekday: 3, start_time: "11:00", end_time: "20:00", enabled: false },
  ];
  const before = structuredClone(rows);
  const copied = copyWeeklyHours(rows, 0, [0, 1, 1, 3, 99]);
  expect(copied[1]).toEqual({ weekday: 1, start_time: "18:00", end_time: "24:00", enabled: true });
  for (const index of [0, 2, 3]) expect(copied[index]).toBe(rows[index]);
  expect(rows).toEqual(before);
});
it("does nothing for disabled or absent sources and empty selection", () => {
  const rows = [{ weekday: 1, start_time: "09:00", end_time: "17:00", enabled: false }];
  expect(copyWeeklyHours(rows, 1, [1])).toEqual(rows);
  expect(copyWeeklyHours(rows, 99, [1])).toEqual(rows);
  expect(copyWeeklyHours([{ ...rows[0], enabled: true }], 1, [])).toEqual([
    { ...rows[0], enabled: true },
  ]);
});
