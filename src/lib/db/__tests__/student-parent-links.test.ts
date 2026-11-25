import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import {
  createBookingLifecycleDb,
  IDS,
  queryRows,
  seedLifecycleBooking,
  tryAsUser,
} from "./booking-lifecycle.harness";

const STUDENT_ID = "00000000-0000-0000-0000-00000000c101";
const PARENT_ID = "00000000-0000-0000-0000-00000000c102";
const STRANGER_ID = "00000000-0000-0000-0000-00000000c103";

let db: PGlite;

async function seedMinorStudentAndParent() {
  await db.exec(`
    INSERT INTO auth.users (id, raw_user_meta_data) VALUES
      ('${STUDENT_ID}', '{"signup_role":"customer"}'::jsonb),
      ('${PARENT_ID}', '{"signup_role":"customer"}'::jsonb),
      ('${STRANGER_ID}', '{"signup_role":"customer"}'::jsonb)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES
      ('${STUDENT_ID}', 'customer'),
      ('${PARENT_ID}', 'customer'),
      ('${STRANGER_ID}', 'customer')
    ON CONFLICT DO NOTHING;
    UPDATE public.profiles SET
      phone = '201011111111',
      date_of_birth = (CURRENT_DATE - interval '15 years')::date,
      full_name = 'Student Minor'
    WHERE id = '${STUDENT_ID}';
    UPDATE public.profiles SET
      phone = '201022222222',
      date_of_birth = (CURRENT_DATE - interval '40 years')::date,
      full_name = 'Parent Adult'
    WHERE id = '${PARENT_ID}';
    UPDATE public.profiles SET phone = '201033333333' WHERE id = '${STRANGER_ID}';
  `);
}

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  await seedMinorStudentAndParent();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("student_parent_links", () => {
  it("register_parent_guardian_contact creates notified row for unknown parent phone", async () => {
    const result = await tryAsUser(
      db,
      STUDENT_ID,
      `SELECT public.register_parent_guardian_contact($1, $2) AS payload`,
      ["01099998888", "guardian@example.com"],
    );
    expect(result.error).toBeUndefined();
    const payload = result.rows?.[0]?.payload as { status?: string; parent_on_famy?: boolean };
    expect(payload?.status).toBe("notified");
    expect(payload?.parent_on_famy).toBe(false);
  });

  it("register_parent_guardian_contact auto-links when parent exists on Famy", async () => {
    const orphan = "00000000-0000-0000-0000-00000000c199";
    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${orphan}') ON CONFLICT DO NOTHING;
      INSERT INTO public.user_roles (user_id, role) VALUES ('${orphan}', 'customer') ON CONFLICT DO NOTHING;
      UPDATE public.profiles SET date_of_birth = (CURRENT_DATE - interval '14 years')::date WHERE id = '${orphan}';
    `);
    const result = await tryAsUser(
      db,
      orphan,
      `SELECT public.register_parent_guardian_contact($1, $2) AS payload`,
      ["01022222222", "parent.adult@example.com"],
    );
    expect(result.error).toBeUndefined();
    const payload = result.rows?.[0]?.payload as { status?: string; parent_on_famy?: boolean };
    expect(payload?.status).toBe("linked");
    expect(payload?.parent_on_famy).toBe(true);
  });

  it("create_booking succeeds for minor without prior parent link", async () => {
    const anotherStudent = "00000000-0000-0000-0000-00000000c104";
    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${anotherStudent}') ON CONFLICT DO NOTHING;
      INSERT INTO public.user_roles (user_id, role) VALUES ('${anotherStudent}', 'customer') ON CONFLICT DO NOTHING;
      UPDATE public.profiles SET
        date_of_birth = (CURRENT_DATE - interval '16 years')::date
      WHERE id = '${anotherStudent}';
    `);
    const service = await queryRows<{ id: string }>(
      db,
      "SELECT id FROM public.services WHERE slug = 'hourly-babysitting' LIMIT 1",
    );
    const booking = await tryAsUser(
      db,
      anotherStudent,
      `SELECT public.create_booking(
        $1::uuid, $2::uuid, NULL,
        now() + interval '5 days', now() + interval '5 days' + interval '1 hour',
        $3::uuid, NULL, NULL, NULL, '[]'::jsonb, NULL, NULL, NULL, NULL, NULL, 'online'
      )`,
      [IDS.provider, service[0]!.id, randomUUID()],
    );
    expect(booking.error ?? "").not.toMatch(/STUDENT_PARENT_LINK/);
  });

  it("parent_may_pay_student_booking after linked parent", async () => {
    const payStudent = "00000000-0000-0000-0000-00000000c105";
    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${payStudent}') ON CONFLICT DO NOTHING;
      INSERT INTO public.user_roles (user_id, role) VALUES ('${payStudent}', 'customer') ON CONFLICT DO NOTHING;
      UPDATE public.profiles SET
        date_of_birth = (CURRENT_DATE - interval '15 years')::date
      WHERE id = '${payStudent}';
    `);
    const reg = await tryAsUser(
      db,
      payStudent,
      `SELECT public.register_parent_guardian_contact($1, $2)`,
      ["01022222222", "linked.parent@example.com"],
    );
    expect(reg.error).toBeUndefined();

    const { bookingId } = await seedLifecycleBooking(db, {
      customerId: payStudent,
      status: "confirmed",
    });
    const onlineBookingId = randomUUID();
    await db.exec(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.bookings (
        id, customer_id, provider_id, service_id, start_at, end_at, status, service_mode,
        price_subtotal, price_total, currency, idempotency_key
      )
      SELECT '${onlineBookingId}', customer_id, provider_id, service_id, start_at + interval '7 days',
        end_at + interval '7 days', 'confirmed', 'online', price_subtotal, price_total, currency,
        gen_random_uuid()
      FROM public.bookings WHERE id = '${bookingId}';
      SET LOCAL session_replication_role = DEFAULT;
    `);
    const ok = await queryRows<{ ok: boolean }>(
      db,
      `SELECT public.parent_may_pay_student_booking($1::uuid, $2::uuid) AS ok`,
      [PARENT_ID, onlineBookingId],
    );
    expect(ok[0]?.ok).toBe(true);
  });

  it("RLS hides links from unrelated users", async () => {
    const rows = await tryAsUser(
      db,
      STRANGER_ID,
      `SELECT count(*)::text AS c FROM public.student_parent_links`,
    );
    expect(rows.error).toBeUndefined();
    expect(rows.rows?.[0]?.c).toBe("0");
  });

  it("flag_parent_link_by_token flags the link without auth", async () => {
    const flagStudent = "00000000-0000-0000-0000-00000000c106";
    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${flagStudent}') ON CONFLICT DO NOTHING;
      INSERT INTO public.user_roles (user_id, role) VALUES ('${flagStudent}', 'customer') ON CONFLICT DO NOTHING;
      UPDATE public.profiles SET date_of_birth = (CURRENT_DATE - interval '14 years')::date WHERE id = '${flagStudent}';
    `);
    const reg = await tryAsUser(
      db,
      flagStudent,
      `SELECT public.register_parent_guardian_contact($1, $2)`,
      ["01088887777", "flag.parent@example.com"],
    );
    expect(reg.error).toBeUndefined();
    const link = await queryRows<{ flag_token: string }>(
      db,
      `SELECT flag_token FROM public.student_parent_links WHERE student_id = $1 ORDER BY requested_at DESC LIMIT 1`,
      [flagStudent],
    );
    const token = link[0]?.flag_token;
    expect(token).toBeTruthy();
    await db.exec("SET LOCAL ROLE anon");
    await db.query(`SELECT public.flag_parent_link_by_token($1::uuid)`, [token]);
    const row = await queryRows<{ status: string }>(
      db,
      `SELECT status FROM public.student_parent_links WHERE flag_token = $1`,
      [token],
    );
    expect(row[0]?.status).toBe("flagged_not_my_child");
  });
});