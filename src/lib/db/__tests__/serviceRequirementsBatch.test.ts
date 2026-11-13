import { describe, expect, it, vi } from "vitest";
import { fetchRequirementsForServiceIds } from "../serviceRequirementsBatch";

describe("fetchRequirementsForServiceIds", () => {
  it("resolves with an empty list when no services are selected", async () => {
    const load = vi.fn();
    await expect(fetchRequirementsForServiceIds([], load)).resolves.toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it("loads requirements when service ids are present", async () => {
    const load = vi.fn().mockResolvedValue([{ id: "req-1" }]);
    await expect(fetchRequirementsForServiceIds(["svc-a"], load)).resolves.toEqual([{ id: "req-1" }]);
    expect(load).toHaveBeenCalledWith(["svc-a"]);
  });
});
