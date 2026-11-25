import { describe, expect, it } from "vitest";
import { buildCreateBookingRpcArgs } from "@/lib/db/queries";

describe("buildCreateBookingRpcArgs", () => {
  it("sends explicit null address for online web requests", () => {
    const args = buildCreateBookingRpcArgs({
      provider_id: "p1",
      service_id: "s1",
      address_id: null,
      start_at: "2026-12-01T10:00:00.000Z",
      end_at: "2026-12-01T11:00:00.000Z",
      idempotency_key: "idem-1",
      service_mode: "online",
      teaching_capability_id: "cap-1",
      teaching_subject_code: "math",
      teaching_curriculum_code: "eg",
      teaching_level_code: "g6",
    });
    expect(args.p_address_id).toBeNull();
    expect(args.p_service_mode).toBe("online");
    expect("p_address_id" in args).toBe(true);
  });
});