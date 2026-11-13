import { describe, expect, it } from "vitest";
import { rebookSupervisionSeedMatches, rebookTutoringSeedMatches } from "../rebookFlowSeeds";

describe("rebookFlowSeeds", () => {
  it("matches tutoring seed only for the same service and recipient", () => {
    const seed = { serviceId: "svc-1", forWhom: "child-1" };
    expect(rebookTutoringSeedMatches(seed, "svc-1", "child-1")).toBe(true);
    expect(rebookTutoringSeedMatches(seed, "svc-2", "child-1")).toBe(false);
    expect(rebookTutoringSeedMatches(seed, "svc-1", "child-2")).toBe(false);
  });

  it("matches supervision seed only for the same service", () => {
    expect(rebookSupervisionSeedMatches({ serviceId: "svc-1" }, "svc-1")).toBe(true);
    expect(rebookSupervisionSeedMatches({ serviceId: "svc-1" }, "svc-2")).toBe(false);
  });
});
