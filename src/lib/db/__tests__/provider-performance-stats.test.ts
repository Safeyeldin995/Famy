import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  IDS,
  asServiceRole,
  asUser,
  createProviderLifecycleDb,
  queryRows,
  seedDraftProvider,
} from "./provider-lifecycle.harness";

let db: PGlite;

beforeAll(async () => {
  db = await createProviderLifecycleDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("BEGIN");
  await seedDraftProvider(db);
  await db.exec(`
    INSERT INTO public.user_roles (user_id, role) VALUES ('${IDS.providerUser}', 'provider')
    ON CONFLICT DO NOTHING;
  `);
});

afterEach(async () => {
  await db.exec("ROLLBACK");
});

describe("provider_performance_stats", () => {
  it("returns stats for the calling provider", async () => {
    const rows = await asUser(db, IDS.providerUser, () =>
      queryRows<{ provider_performance_stats: unknown }>(
        db,
        `SELECT public.provider_performance_stats(30) AS provider_performance_stats`,
      ),
    );
    const stats = rows[0]?.provider_performance_stats as Record<string, unknown>;
    expect(stats).toMatchObject({ days: 30, rating_count: expect.any(Number) });
  });

  it("blocks non-admin from admin_provider_performance_stats", async () => {
    await expect(
      asUser(db, IDS.providerUser, () =>
        db.query(`SELECT public.admin_provider_performance_stats($1::uuid, 30)`, [IDS.provider]),
      ),
    ).rejects.toThrow(/Admin authorization/i);
  });

  it("creates provider warning with notification", async () => {
    const before = await queryRows<{ c: number }>(
      db,
      `SELECT count(*)::int AS c FROM public.provider_warnings WHERE provider_id = $1`,
      [IDS.provider],
    );
    await asUser(db, IDS.adminUser, () =>
      db.query(`SELECT public.admin_create_provider_warning($1::uuid, $2)`, [
        IDS.provider,
        "Follow up on cancellations",
      ]),
    );
    const after = await queryRows<{ c: number }>(
      db,
      `SELECT count(*)::int AS c FROM public.provider_warnings WHERE provider_id = $1`,
      [IDS.provider],
    );
    expect(after[0]?.c).toBe((before[0]?.c ?? 0) + 1);
    const notifs = await queryRows<{ c: number }>(
      db,
      `SELECT count(*)::int AS c FROM public.notifications WHERE user_id = $1 AND type = 'provider_warning'`,
      [IDS.providerUser],
    );
    expect(notifs[0]?.c).toBeGreaterThan(0);
  });
});

describe("admin_expiring_provider_documents", () => {
  const expiringDocId = "00000000-0000-0000-0000-00000000a901";

  it("returns expiring rows for admin and denies provider callers", async () => {
    await asServiceRole(db, async () => {
      await db.query(
        `INSERT INTO public.provider_documents (id, provider_id, type, storage_path, status, expires_at)
         VALUES ($1, $2, 'id_card_front', 'synthetic/expiring.jpg', 'approved', now() + interval '7 days')`,
        [expiringDocId, IDS.provider],
      );
    });

    const rows = await asUser(db, IDS.adminUser, () =>
      queryRows<{
        document_id: string;
        provider_id: string;
        document_type: string;
        expires_at: string;
        full_name: string | null;
      }>(db, `SELECT * FROM public.admin_expiring_provider_documents(30)`),
    );
    expect(rows.some((row) => row.document_id === expiringDocId && row.provider_id === IDS.provider)).toBe(
      true,
    );

    await expect(
      asUser(db, IDS.providerUser, () => db.query(`SELECT * FROM public.admin_expiring_provider_documents(30)`)),
    ).rejects.toThrow(/Admin authorization/i);
  });
});