import { afterEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  ACCOUNT_DELETION_MIGRATION,
  IDS,
  asServiceRole,
  asUser,
  createAccountDeletionDb,
  queryRows,
  readMigration,
  runSqlExpectError,
} from "./account-deletion.harness";

describe("account deletion migration", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("defines check and anonymize RPCs with expected grants", () => {
    const sql = readMigration(ACCOUNT_DELETION_MIGRATION);
    expect(sql).toContain("account_deletion_check");
    expect(sql).toContain("anonymize_account");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.account_deletion_check() TO authenticated");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.anonymize_account(uuid) TO service_role");
    expect(sql).not.toMatch(/has_role\s*\(\s*v_uid\s*,\s*'admin'/);
    expect(sql).toContain("FROM public.user_roles WHERE user_id = v_uid AND role = 'admin'");
  });

  it("blocks deletion for admins and active bookings", async () => {
    db = await createAccountDeletionDb();

    const adminCheck = await asUser(db, IDS.admin, async () =>
      queryRows<{ account_deletion_check: { ok: boolean; reason?: string } }>(
        db!,
        `SELECT public.account_deletion_check() AS account_deletion_check`,
      ),
    );
    expect(adminCheck[0]?.account_deletion_check).toEqual({ ok: false, reason: "admin" });

    await db.exec(`
      INSERT INTO public.bookings (id, customer_id, provider_id, service_id, status)
      VALUES ('00000000-0000-0000-0000-000000000901', '${IDS.customer}', '${IDS.provider}', '${IDS.service}', 'pending');
    `);

    const customerCheck = await asUser(db, IDS.customer, async () =>
      queryRows<{ account_deletion_check: { ok: boolean; reason?: string } }>(
        db!,
        `SELECT public.account_deletion_check() AS account_deletion_check`,
      ),
    );
    expect(customerCheck[0]?.account_deletion_check).toEqual({ ok: false, reason: "active_bookings" });
  });

  it("allows a customer with no active bookings", async () => {
    db = await createAccountDeletionDb();
    const customerCheck = await asUser(db, IDS.customer, async () =>
      queryRows<{ account_deletion_check: { ok: boolean } }>(
        db!,
        `SELECT public.account_deletion_check() AS account_deletion_check`,
      ),
    );
    expect(customerCheck[0]?.account_deletion_check).toEqual({ ok: true });
  });

  it("blocks anonymize_account for admin users under service_role", async () => {
    db = await createAccountDeletionDb();
    await asServiceRole(db, async () =>
      runSqlExpectError(
        db!,
        `SELECT public.anonymize_account('${IDS.admin}'::uuid)`,
        /account_deletion_blocked/,
      ),
    );
  });

  it("anonymizes profile data and related rows without deleting bookings", async () => {
    db = await createAccountDeletionDb();
    const bookingId = "00000000-0000-0000-0000-000000000902";
    await db.exec(`
      INSERT INTO public.bookings (id, customer_id, provider_id, service_id, status)
      VALUES ('${bookingId}', '${IDS.customer}', '${IDS.provider}', '${IDS.service}', 'completed');
    `);

    const payload = await asServiceRole(db, async () =>
      queryRows<{ anonymize_account: { storage_paths: unknown[] } }>(
        db!,
        `SELECT public.anonymize_account('${IDS.customer}'::uuid) AS anonymize_account`,
      ),
    );

    const paths = payload[0]?.anonymize_account.storage_paths ?? [];
    expect(paths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bucket: "avatars", path: "user/avatar.jpg" }),
      ]),
    );

    const profile = await queryRows<{
      full_name: string;
      phone: string | null;
      avatar_url: string | null;
      deleted_at: string | null;
    }>(db, `SELECT full_name, phone, avatar_url, deleted_at::text FROM public.profiles WHERE id = $1`, [
      IDS.customer,
    ]);
    expect(profile[0]?.full_name).toBe("Deleted user");
    expect(profile[0]?.phone).toBeNull();
    expect(profile[0]?.avatar_url).toBeNull();
    expect(profile[0]?.deleted_at).not.toBeNull();

    const counts = await queryRows<{ addresses: string; family: string; tokens: string }>(
      db,
      `SELECT
        (SELECT count(*)::text FROM public.addresses WHERE user_id = '${IDS.customer}') AS addresses,
        (SELECT count(*)::text FROM public.family_members WHERE customer_id = '${IDS.customer}') AS family,
        (SELECT count(*)::text FROM public.device_push_tokens WHERE user_id = '${IDS.customer}') AS tokens`,
    );
    expect(counts[0]).toEqual({ addresses: "0", family: "0", tokens: "0" });

    const booking = await queryRows<{ id: string }>(
      db,
      `SELECT id::text FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    expect(booking).toHaveLength(1);

    const audit = await queryRows<{ action: string; reason: string }>(
      db,
      `SELECT action, reason FROM public.audit_logs WHERE entity_id = $1`,
      [IDS.customer],
    );
    expect(audit[0]?.action).toBe("account_anonymized");
    expect(audit[0]?.reason).toBe("self_service_account_deletion");
  });
});
