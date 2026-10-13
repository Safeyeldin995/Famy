import { describe, expect, it, vi, beforeEach } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/lib/preview/constants", () => ({ isPreviewRoute: () => false }));

const { fetchBookingParties } = await import("../booking-parties");

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async (_name: string, args: { p_booking_ids: string[] }) => ({
    data: args.p_booking_ids.map((id) => ({ booking_id: id, other_name: `name-${id}` })),
    error: null,
  }));
});

describe("fetchBookingParties", () => {
  it("sends ids in batches the RPC accepts and merges the results", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `b${i}`);
    const parties = await fetchBookingParties([...ids, "b1", ""]);
    expect(rpc).toHaveBeenCalledTimes(3);
    for (const [, args] of rpc.mock.calls)
      expect(args.p_booking_ids.length).toBeLessThanOrEqual(200);
    expect(parties.size).toBe(450);
    expect(parties.get("b449")?.other_name).toBe("name-b449");
  });

  it("does not call the RPC for an empty list", async () => {
    expect((await fetchBookingParties([])).size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces RPC errors to the caller", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error("denied") });
    await expect(fetchBookingParties(["b1"])).rejects.toThrow("denied");
  });
});
