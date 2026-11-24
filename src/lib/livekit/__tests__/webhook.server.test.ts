import { describe, expect, it, vi } from "vitest";
import { applyLiveKitWebhookEvent } from "@/lib/livekit/webhook.server";

describe("applyLiveKitWebhookEvent", () => {
  it("delegates to the atomic database RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const admin = { rpc, from: vi.fn() };

    await applyLiveKitWebhookEvent(
      admin as never,
      {
        id: "evt-1",
        event: "participant_joined",
        room: { name: "booking_00000000-0000-0000-0000-000000000901" },
        participant: { identity: "customer:user-1" },
      },
      new Date("2026-11-23T12:00:00.000Z"),
    );

    expect(rpc).toHaveBeenCalledWith("apply_livekit_session_webhook_event", {
      p_event_id: "evt-1",
      p_booking_id: "00000000-0000-0000-0000-000000000901",
      p_event_type: "participant_joined",
      p_participant: "customer",
      p_event_at: "2026-11-23T12:00:00.000Z",
    });
  });
});