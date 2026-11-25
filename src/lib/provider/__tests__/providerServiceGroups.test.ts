import { describe, expect, it } from "vitest";
import { groupProviderServices, providerServiceGroupKey } from "../providerServiceGroups";

describe("providerServiceGroups", () => {
  it("maps statuses to groups and hides removed", () => {
    expect(providerServiceGroupKey("approved")).toBe("active");
    expect(providerServiceGroupKey("removed")).toBeNull();
    const groups = groupProviderServices([
      { service_id: "a", status: "paused" },
      { service_id: "b", status: "approved" },
      { service_id: "c", status: "removed" },
      { service_id: "d", status: "pending" },
    ]);
    expect(groups.map((g) => g.key)).toEqual(["active", "pending", "paused"]);
    expect(groups[0]?.items.map((r) => r.service_id)).toEqual(["b"]);
  });
});