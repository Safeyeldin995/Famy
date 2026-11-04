import { describe, expect, it } from "vitest";
import {
  buildRequirementFulfillmentPayload,
  validateTeachingGroups,
} from "@/lib/provider/serviceRequestPayload";

describe("serviceRequestPayload", () => {
  it("validates tutoring groups require complete rows", () => {
    expect(validateTeachingGroups([])).toBe("teaching_required");
    expect(
      validateTeachingGroups([
        {
          subject_id: "s",
          curriculum_id: "c",
          level_ids: [],
          session_duration_min: 60,
          session_price: 100,
        },
      ]),
    ).toBe("teaching_incomplete");
    expect(
      validateTeachingGroups([
        {
          subject_id: "s",
          curriculum_id: "c",
          level_ids: ["l1"],
          session_duration_min: 60,
          session_price: 100,
        },
      ]),
    ).toBeNull();
  });

  it("builds requirement fulfillment payload for approval requirements only", () => {
    const payload = buildRequirementFulfillmentPayload(
      ["r1", "r2"],
      [
        { requirement_id: "r1", notes: "note", evidence_storage_path: "/p" },
        { requirement_id: "r3", notes: null, evidence_storage_path: null },
      ],
    );
    expect(payload).toEqual([
      { requirement_id: "r1", notes: "note", evidence_storage_path: "/p" },
    ]);
  });
});
