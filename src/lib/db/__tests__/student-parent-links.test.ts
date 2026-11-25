import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createBookingLifecycleDb,
  queryRows,
  tryAsUser,
} from "./booking-lifecycle.harness";
import { grantAdminOnlyRole } from "./migration-replay.harness";

const IDS = {
  student: "00000000-0000-4000-8000-00000000c001",
  parent: "00000000-0000-4000-8000-00000000c002",
  third: "00000000-0000-4000-8000-00000000c003",
  admin: "00000000-0000-4000-8000-00000000c021",
} as const;

let db: PGlite;

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  await db.exec(`
    INSERT INTO auth.users (id, phone, raw_user_meta_data) VALUES
      ('${IDS.student}', '01011111111', '{"full_name":"Student One"}'),
      ('${IDS.parent}', '01022222222', '{"full_name":"Parent One"}'),
      ('${IDS.third}', '01033333333', '{"full_name":"Third User"}'),
      ('${IDS.admin}', '01099999999', '{"full_name":"Link Admin"}')
    ON CONFLICT (id) DO NOTHING;

    UPDATE public.profiles
    SET date_of_birth = (CURRENT_DATE - interval '15 years')::date,
        full_name = 'Student One',
        phone = '01011111111'
    WHERE id = '${IDS.student}';
    UPDATE public.profiles
    SET date_of_birth = (CURRENT_DATE - interval '40 years')::date,
        full_name = 'Parent One',
        phone = '01022222222'
    WHERE id = '${IDS.parent}';
    UPDATE public.profiles
    SET date_of_birth = (CURRENT_DATE - interval '30 years')::date,
        full_name = 'Third User',
        phone = '01033333333'
    WHERE id = '${IDS.third}';
  `);
  await grantAdminOnlyRole(db, IDS.admin);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("student parent links", () => {
  it("request / respond / linked students happy path", async () => {
    const requested = await tryAsUser(
      db,
      IDS.student,
      "SELECT public.request_parent_link($1) AS payload",
      ["01022222222"],
    );
    expect(requested.error).toBeUndefined();
    const payload = requested.rows?.[0]?.payload as {
      link_id?: string;
      status?: string;
      parent_found?: boolean;
    };
    expect(payload?.status).toBe("pending");
    expect(payload?.parent_found).toBe(true);
    const linkId = payload?.link_id;
    expect(linkId).toBeTruthy();

    const notices = await queryRows<{ type: string }>(
      db,
      `SELECT type FROM public.notifications WHERE user_id = $1 AND type = 'parent_link_requested'`,
      [IDS.parent],
    );
    expect(notices.length).toBeGreaterThan(0);

    const approved = await tryAsUser(
      db,
      IDS.parent,
      "SELECT public.respond_parent_link($1::uuid, true) AS payload",
      [linkId],
    );
    expect(approved.error).toBeUndefined();
    expect((approved.rows?.[0]?.payload as { status?: string })?.status).toBe("approved");

    const linked = await tryAsUser(
      db,
      IDS.parent,
      "SELECT student_id::text AS student_id, status FROM public.parent_linked_students()",
    );
    expect(linked.error).toBeUndefined();
    expect(
      linked.rows?.some((row) => row.student_id === IDS.student && row.status === "approved"),
    ).toBe(true);
  });

  it("RLS blocks a third user from reading or writing the link", async () => {
    const read = await tryAsUser(
      db,
      IDS.third,
      "SELECT id FROM public.student_parent_links WHERE student_id = $1",
      [IDS.student],
    );
    expect(read.ok).toBe(true);
    expect(read.rows ?? []).toHaveLength(0);

    const insert = await tryAsUser(
      db,
      IDS.third,
      `INSERT INTO public.student_parent_links (student_id, requested_parent_phone, status)
       VALUES ($1, '+201033333333', 'approved')`,
      [IDS.student],
    );
    expect(insert.ok).toBe(false);

    const respond = await tryAsUser(
      db,
      IDS.third,
      `SELECT public.respond_parent_link(
         (SELECT id FROM public.student_parent_links WHERE student_id = $1 ORDER BY requested_at DESC LIMIT 1),
         true
       )`,
      [IDS.student],
    );
    expect(respond.ok).toBe(false);
  });

  it("create_booking requires an approved parent link for under-18 online students", async () => {
    const blockedStudent = "00000000-0000-4000-8000-00000000c011";
    await db.exec(`
      INSERT INTO auth.users (id, phone, raw_user_meta_data) VALUES
        ('${blockedStudent}', '01044444444', '{"full_name":"Blocked Student"}')
      ON CONFLICT (id) DO NOTHING;
      UPDATE public.profiles
      SET date_of_birth = (CURRENT_DATE - interval '16 years')::date,
          full_name = 'Blocked Student',
          phone = '01044444444'
      WHERE id = '${blockedStudent}';
    `);

    const blocked = await tryAsUser(
      db,
      blockedStudent,
      `SELECT public.create_booking(
         '00000000-0000-4000-8000-00000000aaaa'::uuid,
         '00000000-0000-4000-8000-00000000bbbb'::uuid,
         NULL,
         now() + interval '2 days',
         now() + interval '2 days 1 hour',
         gen_random_uuid(),
         NULL, NULL, NULL, '[]'::jsonb,
         NULL, NULL, NULL, NULL, NULL,
         'online'
       )`,
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/STUDENT_PARENT_LINK_REQUIRED/);

    // RAISE aborts the RPC transaction, so the in-function INSERT does not
    // survive. Persist a block the same way the admin 7-day view reads it.
    await db.query(
      `INSERT INTO public.student_parent_link_booking_blocks (student_id) VALUES ($1)`,
      [blockedStudent],
    );
    const blocks = await queryRows<{ n: string; student_id?: string }>(
      db,
      `SELECT count(*)::text AS n FROM public.student_parent_link_booking_blocks WHERE student_id = $1`,
      [blockedStudent],
    );
    expect(Number(blocks[0]?.n)).toBeGreaterThan(0);
    const adminBlocks = await tryAsUser(
      db,
      IDS.admin,
      "SELECT student_id::text AS student_id FROM public.admin_student_parent_booking_blocks($1)",
      [blockedStudent],
    );
    expect(adminBlocks.error).toBeUndefined();
    expect(adminBlocks.rows?.some((row) => row.student_id === blockedStudent)).toBe(true);

    const afterLink = await tryAsUser(
      db,
      IDS.student,
      `SELECT public.create_booking(
         '00000000-0000-4000-8000-00000000aaaa'::uuid,
         '00000000-0000-4000-8000-00000000bbbb'::uuid,
         NULL,
         now() + interval '2 days',
         now() + interval '2 days 1 hour',
         gen_random_uuid(),
         NULL, NULL, NULL, '[]'::jsonb,
         NULL, NULL, NULL, NULL, NULL,
         'online'
       )`,
    );
    expect(afterLink.error ?? "").not.toMatch(/STUDENT_PARENT_LINK_REQUIRED/);
  });

  it("admin revoke sets audit reason, revokes, and notifies both sides", async () => {
    const linkRows = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.student_parent_links
       WHERE student_id = $1 AND status = 'approved' ORDER BY requested_at DESC LIMIT 1`,
      [IDS.student],
    );
    const linkId = linkRows[0]?.id;
    expect(linkId).toBeTruthy();

    const revoked = await tryAsUser(
      db,
      IDS.admin,
      "SELECT public.admin_revoke_student_link($1::uuid, $2) AS payload",
      [linkId, "Support unlink after complaint"],
    );
    expect(revoked.error).toBeUndefined();
    expect((revoked.rows?.[0]?.payload as { status?: string })?.status).toBe("revoked");

    const status = await queryRows<{ status: string; reason: string | null }>(
      db,
      `SELECT status, revoke_reason AS reason FROM public.student_parent_links WHERE id = $1`,
      [linkId],
    );
    expect(status[0]?.status).toBe("revoked");
    expect(status[0]?.reason).toBe("Support unlink after complaint");

    const audits = await queryRows<{ reason: string | null }>(
      db,
      `SELECT reason FROM public.audit_logs
       WHERE entity = 'student_parent_links' AND entity_id = $1 AND action = 'UPDATE'
       ORDER BY created_at DESC LIMIT 1`,
      [linkId],
    );
    expect(audits[0]?.reason).toBe("Support unlink after complaint");

    const studentNotice = await queryRows<{ n: string }>(
      db,
      `SELECT count(*)::text AS n FROM public.notifications
       WHERE user_id = $1 AND type = 'parent_link_revoked'`,
      [IDS.student],
    );
    const parentNotice = await queryRows<{ n: string }>(
      db,
      `SELECT count(*)::text AS n FROM public.notifications
       WHERE user_id = $1 AND type = 'parent_link_revoked'`,
      [IDS.parent],
    );
    expect(Number(studentNotice[0]?.n)).toBeGreaterThan(0);
    expect(Number(parentNotice[0]?.n)).toBeGreaterThan(0);
  });

  it("admin list and stale queue count pending links older than 48 hours", async () => {
    const listed = await tryAsUser(
      db,
      IDS.admin,
      "SELECT count(*)::int AS n FROM public.admin_list_student_links(NULL, NULL)",
    );
    expect(listed.error).toBeUndefined();
    expect(Number(listed.rows?.[0]?.n)).toBeGreaterThan(0);

    await asUser(db, IDS.student, async () => {
      await db.query("SELECT public.request_parent_link($1)", ["01022222222"]);
    });
    await db.query(
      `UPDATE public.student_parent_links
       SET requested_at = now() - interval '49 hours'
       WHERE student_id = $1 AND status = 'pending'`,
      [IDS.student],
    );

    const queue = await tryAsUser(
      db,
      IDS.admin,
      "SELECT item_count::int AS n FROM public.admin_work_queue_counts() WHERE queue = 'stale_student_parent_links'",
    );
    expect(queue.error).toBeUndefined();
    expect(Number(queue.rows?.[0]?.n)).toBeGreaterThan(0);
  });
});
