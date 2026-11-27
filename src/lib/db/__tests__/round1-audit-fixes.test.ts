import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asServiceRole,
  asUser,
  IDS,
  queryRows,
  seedLifecycleBooking,
  tryAsAnon,
  tryAsUser,
} from "./booking-lifecycle.harness";
import { createMigrationReplayDb, replayAllMigrations } from "./migration-replay.harness";

/**
 * Round-1 audit fixes (#555, #557, #559). The replay emulates Supabase's default
 * privileges (ALL on new tables/views, EXECUTE on new functions for anon and
 * authenticated), so a missing REVOKE shows up here the way it does in Production.
 */
let db: PGlite;

beforeAll(async () => {
  db = await createMigrationReplayDb();
  await db.exec(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  `);
  await replayAllMigrations(db);
  await db.exec(
    "ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb DEFAULT '{}'::jsonb",
  );
  await seedLifecycleBooking(db);
}, 300_000);

afterAll(async () => {
  await db?.close();
});

describe("#555 lesson issue party view is read-only", () => {
  it("runs as the caller and grants clients SELECT only", async () => {
    const opts = await queryRows<{ opts: string[] | null }>(
      db,
      `SELECT c.reloptions AS opts FROM pg_class c
        WHERE c.oid = 'public.online_lesson_issue_reports_party'::regclass`,
    );
    expect(opts[0]?.opts ?? []).toContain("security_invoker=true");

    const writable = await queryRows<{ view: string; role: string; priv: string }>(
      db,
      `SELECT c.relname AS view, r.role, p.priv
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
         CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(priv)
        WHERE n.nspname = 'public' AND c.relkind = 'v'
          AND c.relname IN ('online_lesson_issue_reports_party', 'admin_identity_conflicts')
          AND has_table_privilege(r.role, c.oid, p.priv)`,
    );
    expect(writable).toEqual([]);
  });

  it("refuses insert, update and delete through the view for a party and a non-party", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    await asServiceRole(db, () =>
      db.query(
        `INSERT INTO public.online_lesson_issue_reports (
           booking_id, reported_by, reporter_role, category, description, admin_notes
         ) VALUES ($1, $2, 'customer', 'connection', 'Seeded report', 'internal-only')`,
        [bookingId, IDS.customer],
      ),
    );

    for (const user of [IDS.customer, IDS.providerUser, IDS.otherProviderUser]) {
      const ins = await tryAsUser(
        db,
        user,
        `INSERT INTO public.online_lesson_issue_reports_party
           (booking_id, reported_by, reporter_role, category, description)
         VALUES ($1, $2, 'customer', 'connection', 'via view')`,
        [bookingId, user],
      );
      expect(ins.ok).toBe(false);
      const upd = await tryAsUser(
        db,
        user,
        `UPDATE public.online_lesson_issue_reports_party SET status = 'resolved' WHERE booking_id = $1`,
        [bookingId],
      );
      expect(upd.ok).toBe(false);
      const del = await tryAsUser(
        db,
        user,
        `DELETE FROM public.online_lesson_issue_reports_party WHERE booking_id = $1`,
        [bookingId],
      );
      expect(del.ok).toBe(false);
    }
    const anonIns = await tryAsAnon(
      db,
      `INSERT INTO public.online_lesson_issue_reports_party (booking_id, reported_by, reporter_role, category, description)
       VALUES ($1, $2, 'customer', 'connection', 'anon')`,
      [bookingId, IDS.customer],
    );
    expect(anonIns.ok).toBe(false);

    const rows = await queryRows<{ status: string; n: string }>(
      db,
      `SELECT status, count(*)::text AS n FROM public.online_lesson_issue_reports
        WHERE booking_id = $1 GROUP BY status`,
      [bookingId],
    );
    expect(rows).toEqual([{ status: "open", n: "1" }]);
  });

  it("still lets the parties read their reports, and only theirs", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    await asServiceRole(db, () =>
      db.query(
        `INSERT INTO public.online_lesson_issue_reports (
           booking_id, reported_by, reporter_role, category, description, admin_notes
         ) VALUES ($1, $2, 'customer', 'connection', 'Readable report', 'internal-only')`,
        [bookingId, IDS.customer],
      ),
    );
    const sql = `SELECT * FROM public.online_lesson_issue_reports_party WHERE booking_id = $1`;
    const customer = await tryAsUser(db, IDS.customer, sql, [bookingId]);
    expect(customer.error).toBeUndefined();
    expect(customer.rows).toHaveLength(1);
    expect(customer.rows?.[0]).not.toHaveProperty("admin_notes");
    expect(customer.rows?.[0]).not.toHaveProperty("resolved_by");

    const provider = await tryAsUser(db, IDS.providerUser, sql, [bookingId]);
    expect(provider.rows).toHaveLength(1);

    const outsider = await tryAsUser(db, IDS.otherProviderUser, sql, [bookingId]);
    expect(outsider.error).toBeUndefined();
    expect(outsider.rows).toHaveLength(0);
  });
});

describe("#557 provider wallet history hides the admin note", () => {
  it("records the transfer reference in its own column the provider can read", async () => {
    await asUser(db, IDS.adminUser, () =>
      db.query(
        `SELECT public.admin_provider_ledger_adjustment($1::uuid, 'credit', 500, 'opening balance', NULL)`,
        [IDS.provider],
      ),
    );
    await asUser(db, IDS.adminUser, () =>
      db.query(
        `SELECT public.admin_record_provider_payout($1::uuid, 200, ' IP-777 ', 'weekly payout', 'admin-only remark')`,
        [IDS.provider],
      ),
    );

    const stored = await queryRows<{ reference: string | null; note: string | null }>(
      db,
      `SELECT reference, note FROM public.provider_ledger_entries
        WHERE provider_id = $1 AND kind = 'payout_sent'`,
      [IDS.provider],
    );
    expect(stored).toEqual([{ reference: "IP-777", note: "ref:IP-777 admin-only remark" }]);

    const mine = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT id, kind, direction, amount, payment_method, booking_id, reference, created_at
         FROM public.provider_ledger_entries WHERE provider_id = $1 AND kind = 'payout_sent'`,
      [IDS.provider],
    );
    expect(mine.error).toBeUndefined();
    expect(mine.rows?.map((r) => r.reference)).toEqual(["IP-777"]);

    const note = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT note FROM public.provider_ledger_entries WHERE provider_id = $1`,
      [IDS.provider],
    );
    expect(note.ok).toBe(false);

    const other = await tryAsUser(
      db,
      IDS.otherProviderUser,
      `SELECT reference FROM public.provider_ledger_entries WHERE provider_id = $1`,
      [IDS.provider],
    );
    expect(other.rows ?? []).toHaveLength(0);

    const admin = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT reference FROM public.provider_ledger_entries WHERE provider_id = $1 AND kind = 'payout_sent'`,
      [IDS.provider],
    );
    expect(admin.rows?.map((r) => r.reference)).toEqual(["IP-777"]);
  });

  it("does not stamp a reference on other ledger rows in the same transaction", async () => {
    const rows = await queryRows<{ kind: string; reference: string | null }>(
      db,
      `SELECT kind, reference FROM public.provider_ledger_entries
        WHERE provider_id = $1 AND kind = 'adjustment'`,
      [IDS.provider],
    );
    expect(rows.every((r) => r.reference === null)).toBe(true);
  });
});

describe("#559 function hygiene", () => {
  it("pins search_path on the six flagged functions", async () => {
    const rows = await queryRows<{ sig: string; cfg: string[] | null }>(
      db,
      `SELECT p.oid::regprocedure::text AS sig, p.proconfig AS cfg
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN (
          'admin_mask_phone', 'famy_normalize_parent_email', 'famy_profile_phone_digits',
          'famy_valid_parent_email', 'online_session_refund_reference', 'payment_checkout_funded_total'
        )`,
    );
    expect(rows).toHaveLength(6);
    for (const r of rows) expect(r.cfg ?? []).toContain("search_path=public");
  });

  it("keeps the notification trigger functions away from API roles", async () => {
    const rows = await queryRows<{ sig: string; auth: boolean; anon: boolean }>(
      db,
      `SELECT p.oid::regprocedure::text AS sig,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN (
          'tg_booking_review_request_notify', 'tg_customer_wallet_credit_notify',
          'tg_payment_status_notify', 'tg_provider_ledger_set_reference'
        )`,
    );
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.auth || r.anon)).toEqual([]);
  });
});

describe("#560 guests browse online tutors", () => {
  it("lets anon call the guest tutor search but not the customer search", async () => {
    const guest = await tryAsAnon(db, "SELECT * FROM public.guest_search_online_tutors()");
    expect(guest.error).toBeUndefined();
    const customerOnly = await tryAsAnon(
      db,
      "SELECT * FROM public.search_marketplace_providers(NULL, NULL, 'online')",
    );
    expect(customerOnly.ok).toBe(false);
  });

  it("returns tutoring cards only", async () => {
    const rows = await queryRows<{ category_slug: string }>(
      db,
      "SELECT DISTINCT category_slug FROM public.guest_search_online_tutors()",
    );
    expect(rows.every((r) => r.category_slug === "tutoring")).toBe(true);
  });
});
