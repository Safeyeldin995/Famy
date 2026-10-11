import { expect, it } from "vitest";
import { scheduleDate } from "../scheduleDate";
it("serializes date-only fields without a timezone conversion", () => {
  expect(scheduleDate({ year: "2028", month: "2", day: "29" })).toBe("2028-02-29");
});
it("rejects incomplete and impossible dates", () => {
  expect(scheduleDate({ year: "", month: "2", day: "1" })).toBeNull();
  expect(scheduleDate({ year: "2027", month: "2", day: "29" })).toBeNull();
  expect(scheduleDate({ year: "2027", month: "4", day: "31" })).toBeNull();
});
