import { afterEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  IDS,
  asUser,
  createPushDb,
  queryRows,
} from "./push-notifications.harness";

const SAMPLE_TOKEN = "ExponentPushToken[abcdefghijklmnopqrst]";

describe("push token registration and notification outbox", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("binds the same device token to the last signed-in user", async () => {
    db = await createPushDb();

    await asUser(db, IDS.userA, async () => {
      await db!.query(`SELECT public.register_device_push_token($1, 'android')`, [SAMPLE_TOKEN]);
    });
    let owners = await queryRows<{ user_id: string; revoked_at: string | null }>(
      db,
      `SELECT user_id, revoked_at::text FROM public.device_push_tokens WHERE token = $1`,
      [SAMPLE_TOKEN],
    );
    expect(owners).toHaveLength(1);
    expect(owners[0]?.user_id).toBe(IDS.userA);
    expect(owners[0]?.revoked_at).toBeNull();

    await asUser(db, IDS.userB, async () => {
      await db!.query(`SELECT public.register_device_push_token($1, 'android')`, [SAMPLE_TOKEN]);
    });
    owners = await queryRows<{ user_id: string; revoked_at: string | null }>(
      db,
      `SELECT user_id, revoked_at::text FROM public.device_push_tokens WHERE token = $1`,
      [SAMPLE_TOKEN],
    );
    expect(owners).toHaveLength(1);
    expect(owners[0]?.user_id).toBe(IDS.userB);
  });

  it("enqueues outbox rows once per notification and respects booking_push preference", async () => {
    db = await createPushDb();
    await db.query(
      `INSERT INTO public.notification_preferences (user_id, booking_push) VALUES ($1, false)`,
      [IDS.userA],
    );

    const inserted = await queryRows<{ id: string }>(
      db,
      `INSERT INTO public.notifications (user_id, type, category, title) VALUES ($1, 'booking_confirmed', 'booking', 'Title')
       RETURNING id`,
      [IDS.userA],
    );
    const notificationId = inserted[0]!.id;

    const outbox = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.notification_outbox WHERE notification_id = $1`,
      [notificationId],
    );
    expect(outbox).toHaveLength(0);

    await db.query(`DELETE FROM public.notification_preferences WHERE user_id = $1`, [IDS.userA]);
    const inserted2 = await queryRows<{ id: string }>(
      db,
      `INSERT INTO public.notifications (user_id, type, category, title) VALUES ($1, 'booking_confirmed', 'booking', 'Title 2')
       RETURNING id`,
      [IDS.userA],
    );
    const notificationId2 = inserted2[0]!.id;

    const outbox2 = await queryRows<{ id: string; idempotency_key: string }>(
      db,
      `SELECT id, idempotency_key FROM public.notification_outbox WHERE notification_id = $1`,
      [notificationId2],
    );
    expect(outbox2).toHaveLength(1);
    expect(outbox2[0]?.idempotency_key).toBe(notificationId2);

    await db.query(
      `INSERT INTO public.notification_outbox (idempotency_key, recipient_user_id, notification_id)
       VALUES ($1, $2, $3) ON CONFLICT (idempotency_key) DO NOTHING`,
      [notificationId2, IDS.userA, notificationId2],
    );
    const duplicateCount = await queryRows<{ count: string }>(
      db,
      `SELECT count(*)::text AS count FROM public.notification_outbox WHERE notification_id = $1`,
      [notificationId2],
    );
    expect(duplicateCount[0]?.count).toBe("1");
  });
});
