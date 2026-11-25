import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  IDS,
  createBookingLifecycleDb,
  queryRows,
  seedLifecycleBooking,
  setBookingStatusAsSystem,
  tryAsUser,
} from "./booking-lifecycle.harness";

let db: PGlite;
let bookingId: string;
let conversationId: string;
let messageId: string;

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  const seed = await seedLifecycleBooking(db, { status: "pending" });
  bookingId = seed.bookingId;
  await setBookingStatusAsSystem(db, bookingId, "confirmed");

  const conv = await queryRows<{ id: string }>(
    db,
    `SELECT id FROM public.conversations WHERE booking_id = $1`,
    [bookingId],
  );
  conversationId = conv[0]?.id;
  if (!conversationId) throw new Error("expected conversation after confirmed booking");

  const sent = await tryAsUser(
    db,
    IDS.customer,
    `INSERT INTO public.messages (conversation_id, body) VALUES ($1, $2) RETURNING id`,
    [conversationId, "hello from customer"],
  );
  if (!sent.ok) throw new Error(sent.error);
  messageId = String(sent.rows?.[0]?.id);
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("ugc_reports and chat blocks", () => {
  it("creates an open UGC report via RPC", async () => {
    const r = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.report_ugc($1, $2, $3, $4, $5, $6) AS id`,
      ["chat_message", "harassment", "test detail", messageId, conversationId, null],
    );
    expect(r.ok).toBe(true);
    const open = await queryRows<{ n: string }>(
      db,
      `SELECT count(*)::text AS n FROM public.ugc_reports WHERE status = 'open'`,
    );
    expect(Number(open[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it("blocks a conversation and prevents new messages", async () => {
    const block = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.block_chat_conversation($1) AS id`,
      [conversationId],
    );
    expect(block.ok).toBe(true);

    const hidden = await queryRows<{ hidden_at: string | null }>(
      db,
      `SELECT hidden_at FROM public.conversations WHERE id = $1`,
      [conversationId],
    );
    expect(hidden[0]?.hidden_at).toBeTruthy();

    const msg = await tryAsUser(
      db,
      IDS.providerUser,
      `INSERT INTO public.messages (conversation_id, body) VALUES ($1, $2)`,
      [conversationId, "blocked attempt"],
    );
    expect(msg.ok).toBe(false);
    expect(msg.error).toMatch(/user_blocked/i);
  });

  it("prevents new bookings between a blocked pair", async () => {
    const service = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.services WHERE slug = 'hourly-babysitting' LIMIT 1`,
    );
    const insert = await asServiceRoleInsertBooking(db, service[0]!.id);
    expect(insert.ok).toBe(false);
    expect(insert.error).toMatch(/user_blocked/i);
  });
});

async function asServiceRoleInsertBooking(
  db: PGlite,
  serviceId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await db.exec("BEGIN");
    await db.query("SELECT set_config('request.jwt.claim.sub', '', true)");
    await db.exec("SET LOCAL ROLE service_role");
    await db.query(
      `
      INSERT INTO public.bookings (
        customer_id, provider_id, service_id, address_id,
        start_at, end_at, status, price_total, currency
      )
      SELECT $1, $2, $3, $4, now() + interval '2 days', now() + interval '2 days' + interval '2 hours',
        'pending'::public.booking_status, 100, 'EGP'
      `,
      [IDS.customer, IDS.provider, serviceId, IDS.address],
    );
    await db.exec("COMMIT");
    return { ok: true };
  } catch (error) {
    await db.exec("ROLLBACK");
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}