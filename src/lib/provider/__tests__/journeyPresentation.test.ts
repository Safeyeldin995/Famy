import { expect, it } from "vitest";
import { groupProviderNotifications, providerTimelineIndex } from "../journeyPresentation";

it("keeps customer confirmations at their existing display milestone", () => {
  expect(
    [
      "pending",
      "confirmed",
      "on_the_way",
      "arrived",
      "arrival_confirmed",
      "in_progress",
      "completion_requested",
      "completed",
    ].map(providerTimelineIndex),
  ).toEqual([-1, 0, 1, 2, 2, 3, 3, 4]);
  expect(providerTimelineIndex("cancelled")).toBe(-1);
});
it("groups non-contiguous notifications by calendar day, newest first, without mutating the input", () => {
  const items = [
    { id: "old", created_at: "2026-08-31T10:00:00" },
    { id: "new", created_at: "2026-09-01T15:00:00" },
    { id: "same-day", created_at: "2026-09-01T09:00:00" },
  ];
  expect(groupProviderNotifications(items).map((g) => g.items.map((n) => n.id))).toEqual([
    ["new", "same-day"],
    ["old"],
  ]);
  expect(items[0].id).toBe("old");
  expect(groupProviderNotifications([])).toEqual([]);
});
