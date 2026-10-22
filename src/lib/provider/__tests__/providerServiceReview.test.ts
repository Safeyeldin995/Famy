import { describe, expect, it } from "vitest";
import {
  effectiveTeachingCapabilityStatus,
  effectiveTeachingGroupStatuses,
} from "../providerServiceReview";

describe("providerServiceReview", () => {
  it("inherits rejected status from parent service", () => {
    expect(effectiveTeachingCapabilityStatus("approved", "rejected")).toBe("rejected");
    expect(effectiveTeachingGroupStatuses(["approved", "pending"], "rejected")).toEqual([
      "rejected",
    ]);
  });

  it("keeps capability status when service is approved", () => {
    expect(effectiveTeachingCapabilityStatus("pending", "approved")).toBe("pending");
    expect(effectiveTeachingGroupStatuses(["approved", "pending"], "approved")).toEqual([
      "approved",
      "pending",
    ]);
  });
});
