import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  approveProviderApplication,
  asServiceRole,
  asUser,
  createProviderLifecycleDb,
  fillOnboardingSections,
  IDS,
  queryRows,
  seedDraftProvider,
  submitOnboarding,
  tryAsUser,
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
});

afterEach(async () => {
  await db.exec("ROLLBACK");
});

describe("provider online lesson settings (#403)", () => {
  it("lets unverified providers switch offering_mode back to in_person", async () => {
    const seed = await seedDraftProvider(db);
    await db.exec(`
      INSERT INTO public.provider_services (provider_id, service_id, status)
      VALUES ('${IDS.provider}', '${seed.tutoringServiceId}', 'pending')
      ON CONFLICT (provider_id, service_id) DO NOTHING;
    `);
    const payload = JSON.stringify({ service_ids: [seed.serviceId, seed.tutoringServiceId] });
    await asUser(db, IDS.providerUser, async () => {
      await queryRows(db, `SELECT public.provider_save_onboarding_section('services', $1::jsonb)`, [
        payload,
      ]);
    });
    await fillOnboardingSections(db, IDS.zone, seed.serviceId);
    await submitOnboarding(db);
    await approveProviderApplication(db);
    await asServiceRole(db, async () => {
      await queryRows(
        db,
        `UPDATE public.providers SET offering_mode = 'both', is_verified = false WHERE id = $1`,
        [IDS.provider],
      );
      await queryRows(
        db,
        `UPDATE public.provider_services SET status = 'approved' WHERE provider_id = $1 AND service_id = $2`,
        [IDS.provider, seed.tutoringServiceId],
      );
    });
    const ok = await tryAsUser(db, IDS.providerUser, `SELECT public.provider_update_offering_mode('in_person')`);
    expect(ok.ok).toBe(true);
    const row = await queryRows<{ offering_mode: string }>(
      db,
      `SELECT offering_mode FROM public.providers WHERE id = $1`,
      [IDS.provider],
    );
    expect(row[0]?.offering_mode).toBe("in_person");
  });

  it("rejects offering_mode online for approved but unverified providers", async () => {
    // Applicants (DRAFT / NEEDS_CHANGES) may pick online; see online-nationwide-waitlist.test.ts.
    const seed = await seedDraftProvider(db);
    await fillOnboardingSections(db, IDS.zone, seed.serviceId);
    await submitOnboarding(db);
    await approveProviderApplication(db);
    await asServiceRole(db, async () => {
      await queryRows(db, `UPDATE public.providers SET is_verified = false WHERE id = $1`, [
        IDS.provider,
      ]);
    });
    const attempt = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_update_offering_mode('online')`,
    );
    expect(attempt.ok).toBe(false);
    expect(attempt.error).toMatch(/verified approved providers/i);
  });

  it("blocks a provider without approved online services", async () => {
    const seed = await seedDraftProvider(db);
    await fillOnboardingSections(db, IDS.zone, seed.serviceId);
    await submitOnboarding(db);
    await approveProviderApplication(db);
    await asServiceRole(db, async () => {
      await queryRows(
        db,
        `UPDATE public.providers SET is_verified = true WHERE id = $1`,
        [IDS.provider],
      );
    });
    const attempt = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_update_offering_mode('both')`,
    );
    expect(attempt.ok).toBe(false);
    expect(attempt.error).toMatch(/online lessons first/i);
  });

  it("allows verified provider with approved online_allowed service to set both", async () => {
    const seed = await seedDraftProvider(db);
    await db.exec(`
      INSERT INTO public.provider_services (provider_id, service_id, status)
      VALUES ('${IDS.provider}', '${seed.tutoringServiceId}', 'pending')
      ON CONFLICT (provider_id, service_id) DO NOTHING;
    `);
    const payload = JSON.stringify({ service_ids: [seed.serviceId, seed.tutoringServiceId] });
    await asUser(db, IDS.providerUser, async () => {
      await queryRows(db, `SELECT public.provider_save_onboarding_section('services', $1::jsonb)`, [
        payload,
      ]);
    });
    await fillOnboardingSections(db, IDS.zone, seed.serviceId);
    await submitOnboarding(db);
    await approveProviderApplication(db);
    await asServiceRole(db, async () => {
      await queryRows(
        db,
        `UPDATE public.providers SET is_verified = true WHERE id = $1`,
        [IDS.provider],
      );
    });

    const ok = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_update_offering_mode('both')`,
    );
    expect(ok.ok).toBe(true);
    const row = await queryRows<{ offering_mode: string }>(
      db,
      `SELECT offering_mode FROM public.providers WHERE id = $1`,
      [IDS.provider],
    );
    expect(row[0]?.offering_mode).toBe("both");
  });
});