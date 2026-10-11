import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  queryFn: async (): Promise<
    { start: Date; end: Date; label: string; available?: boolean }[]
  > => [],
  key: [] as unknown[],
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: unknown[]; queryFn: typeof state.queryFn }) => {
    state.queryFn = options.queryFn;
    state.key = options.queryKey;
    return {};
  },
}));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({}) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => ({
      data: [
        { vacation_mode: false, min_notice_hours: 2, max_advance_days: 30, buffer_minutes: 0 },
      ],
      error: null,
    }),
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        lte: () => chain,
        gte: () => chain,
        in: () => chain,
        maybeSingle: () => chain,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: state.data[table] ?? [], error: null }).then(resolve),
      };
      return chain;
    },
  },
}));
import { useAvailableSlots } from "../queries";

beforeEach(() => {
  state.data = { availability_rules: [{ start_time: "09:00", end_time: "15:00" }], settings: null };
});

describe("unavailable slot presentation", () => {
  it("keeps the normal query key/output and exposes rejected candidates only with opt-in", async () => {
    const day = new Date();
    day.setDate(day.getDate() + 2);
    day.setHours(0, 0, 0, 0);
    const occupiedStart = new Date(day);
    occupiedStart.setHours(11);
    const occupiedEnd = new Date(day);
    occupiedEnd.setHours(13);
    state.data.bookings = [
      { start_at: occupiedStart.toISOString(), end_at: occupiedEnd.toISOString() },
    ];
    useAvailableSlots("provider", day, 120, { serviceId: "service", addressId: "address" });
    expect(state.key).toEqual([
      "available-slots",
      "provider",
      day.toDateString(),
      120,
      "service",
      "address",
      false,
      null,
    ]);
    const normal = await state.queryFn();
    expect(normal.map((slot) => slot.start.getHours())).toEqual([9, 13]);
    expect(normal.every((slot) => !("available" in slot))).toBe(true);
    useAvailableSlots("provider", day, 120, {
      serviceId: "service",
      addressId: "address",
      includeUnavailable: true,
    });
    expect(state.key.at(-1)).toBe("include-unavailable");
    const candidates = await state.queryFn();
    expect(candidates.map((slot) => [slot.start.getHours(), slot.available])).toEqual([
      [9, true],
      [11, false],
      [13, true],
    ]);
    expect(
      candidates.filter((slot) => slot.available).map(({ available: _available, ...slot }) => slot),
    ).toEqual(normal);
  });
  it("does not expose candidate slots for a fully blocked day", async () => {
    state.data.provider_vacations = [{ start_date: "fixture", end_date: "fixture" }];
    useAvailableSlots("provider", new Date(), 120, { includeUnavailable: true });
    expect(await state.queryFn()).toEqual([]);
  });
});
