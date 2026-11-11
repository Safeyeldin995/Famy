import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AttemptRow = {
  id: string;
  ip_hash: string | null;
  phone_hash: string;
  created_at: string;
};

const rows = vi.hoisted(() => [] as AttemptRow[]);
let idSeq = 0;

const fromMock = vi.hoisted(() =>
  vi.fn((table: string) => {
    if (table !== "otp_send_attempts") throw new Error(`unexpected table ${table}`);
    const state: { filters: Record<string, string | undefined>; op?: string; payload?: unknown } = {
      filters: {},
    };
    const builder = {
      select(_cols?: string, _opts?: { count?: string; head?: boolean }) {
        state.op = "select";
        return builder;
      },
      eq(column: string, value: string) {
        state.filters[column] = value;
        return builder;
      },
      gte(column: string, value: string) {
        state.filters[`${column}_gte`] = value;
        return builder;
      },
      lt(column: string, value: string) {
        state.filters[`${column}_lt`] = value;
        return builder;
      },
      order(_column: string, _opts?: { ascending?: boolean }) {
        return builder;
      },
      limit(_n: number) {
        return builder;
      },
      maybeSingle: async () => {
        const filtered = rows.filter((row) => {
          if (
            state.filters.phone_hash &&
            row.phone_hash !== state.filters.phone_hash
          ) {
            return false;
          }
          if (state.filters.ip_hash && row.ip_hash !== state.filters.ip_hash) {
            return false;
          }
          if (state.filters.created_at_gte && row.created_at < state.filters.created_at_gte) {
            return false;
          }
          return true;
        });
        filtered.sort((a, b) => a.created_at.localeCompare(b.created_at));
        const first = filtered[0];
        return { data: first ? { created_at: first.created_at } : null, error: null };
      },
      insert: async (payload: { phone_hash: string; ip_hash: string | null }) => {
        rows.push({
          id: `id-${++idSeq}`,
          phone_hash: payload.phone_hash,
          ip_hash: payload.ip_hash,
          created_at: new Date().toISOString(),
        });
        return { error: null };
      },
      delete: () => ({
        eq: (column: string, value: string) => ({
          lt: async (_col: string, cutoff: string) => {
            for (let i = rows.length - 1; i >= 0; i -= 1) {
              const row = rows[i]!;
              if ((column === "phone_hash" && row.phone_hash === value) || (column === "ip_hash" && row.ip_hash === value)) {
                if (row.created_at < cutoff) rows.splice(i, 1);
              }
            }
            return { error: null };
          },
        }),
      }),
      then(onFulfilled?: (v: unknown) => unknown) {
        const filtered = rows.filter((row) => {
          if (state.filters.phone_hash && row.phone_hash !== state.filters.phone_hash) return false;
          if (state.filters.ip_hash && row.ip_hash !== state.filters.ip_hash) return false;
          if (state.filters.created_at_gte && row.created_at < state.filters.created_at_gte) {
            return false;
          }
          return true;
        });
        const result =
          state.op === "select"
            ? { count: filtered.length, error: null, data: null }
            : { error: null };
        return Promise.resolve(result).then(onFulfilled);
      },
    };
    return builder;
  }),
);

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: fromMock },
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => ({
    headers: new Headers({ "x-forwarded-for": "203.0.113.10, 198.51.100.2" }),
  }),
}));

describe("recordOtpSendAttemptIfAllowed", () => {
  beforeEach(() => {
    rows.length = 0;
    idSeq = 0;
    process.env.AUTH_INTENT_SECRET = "test-auth-intent-secret";
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.AUTH_INTENT_SECRET;
  });

  it("blocks the 6th phone attempt within the window", async () => {
    const { recordOtpSendAttemptIfAllowed } = await import("@/lib/otp/otpSendAttempts.server");
    const phone = "+201055512345";
    for (let i = 0; i < 5; i += 1) {
      const res = await recordOtpSendAttemptIfAllowed({ phoneE164: phone, ipAddress: null });
      expect(res.ok).toBe(true);
    }
    const blocked = await recordOtpSendAttemptIfAllowed({ phoneE164: phone, ipAddress: null });
    expect(blocked).toMatchObject({ ok: false, error: "rate_limited" });
    expect((blocked as { retryAfter?: number }).retryAfter).toBeGreaterThan(0);
    expect(rows).toHaveLength(5);
  });

  it("blocks the 11th IP attempt within the window", async () => {
    const { recordOtpSendAttemptIfAllowed } = await import("@/lib/otp/otpSendAttempts.server");
    for (let i = 0; i < 10; i += 1) {
      const res = await recordOtpSendAttemptIfAllowed({
        phoneE164: `+2010555000${String(i).padStart(2, "0")}`,
        ipAddress: "203.0.113.10",
      });
      expect(res.ok).toBe(true);
    }
    const blocked = await recordOtpSendAttemptIfAllowed({
      phoneE164: "+201099988877",
      ipAddress: "203.0.113.10",
    });
    expect(blocked).toMatchObject({ ok: false, error: "rate_limited" });
  });

  it("stores salted hashes only, never raw phone or IP", async () => {
    const { recordOtpSendAttemptIfAllowed, hashOtpSendAttemptValue } = await import(
      "@/lib/otp/otpSendAttempts.server"
    );
    const phone = "+201012345678";
    const ip = "203.0.113.10";
    await recordOtpSendAttemptIfAllowed({ phoneE164: phone, ipAddress: ip });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.phone_hash).toBe(hashOtpSendAttemptValue(phone));
    expect(row.ip_hash).toBe(hashOtpSendAttemptValue(ip));
    expect(row.phone_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.phone_hash).not.toContain("2010");
    expect(row.ip_hash).not.toContain("203.0.113");
  });
});
