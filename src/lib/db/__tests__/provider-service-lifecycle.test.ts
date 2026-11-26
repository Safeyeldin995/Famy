import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  approveProviderApplication,
  asUser,
  createProviderLifecycleDb,
  fillOnboardingSections,
  IDS,
  queryRows,
  searchMarketplace,
  seedDraftProvider,
  submitOnboarding,
  tryAsUser,
} from "./provider-lifecycle.harness";

let db: PGlite;
let serviceId: string;

beforeAll(async () => {
  db = await createProviderLifecycleDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("BEGIN");
  const seed = await seedDraftProvider(db);
  serviceId = seed.serviceId;
  await fillOnboardingSections(db, IDS.zone, serviceId);
  await submitOnboarding(db);
  await approveProviderApplication(db);
});

afterEach(async () => {
  await db.exec("ROLLBACK");
});

describe("provider service pause and remove", () => {
  it("pauses and resumes an approved service; paused services drop out of marketplace", async () => {
    const visibleBefore = await searchMarketplace(db, IDS.customer, IDS.addressInZone);
    expect(visibleBefore.some((r) => r.id === IDS.provider)).toBe(true);

    await asUser(db, IDS.providerUser, async () => {
      await queryRows(
        db,
        `SELECT public.provider_set_service_active($1::uuid, false) AS result`,
        [serviceId],
      );
    });

    const paused = await queryRows<{ status: string }>(
      db,
      `SELECT status FROM public.provider_services WHERE provider_id = $1 AND service_id = $2`,
      [IDS.provider, serviceId],
    );
    expect(paused[0]?.status).toBe("paused");

    const visiblePaused = await searchMarketplace(db, IDS.customer, IDS.addressInZone);
    expect(visiblePaused.some((r) => r.id === IDS.provider)).toBe(false);

    await asUser(db, IDS.providerUser, async () => {
      await queryRows(
        db,
        `SELECT public.provider_set_service_active($1::uuid, true) AS result`,
        [serviceId],
      );
    });

    const active = await queryRows<{ status: string }>(
      db,
      `SELECT status FROM public.provider_services WHERE provider_id = $1 AND service_id = $2`,
      [IDS.provider, serviceId],
    );
    expect(active[0]?.status).toBe("approved");
  });

  it("resuming with flagged_for_review returns the service to pending", async () => {
    await asUser(db, IDS.providerUser, async () => {
      await queryRows(
        db,
        `SELECT public.provider_set_service_active($1::uuid, false)`,
        [serviceId],
      );
    });
    await db.exec(
      `UPDATE public.provider_services SET flagged_for_review = true WHERE provider_id = '${IDS.provider}' AND service_id = '${serviceId}'`,
    );

    await asUser(db, IDS.providerUser, async () => {
      await queryRows(
        db,
        `SELECT public.provider_set_service_active($1::uuid, true) AS result`,
        [serviceId],
      );
    });

    const row = await queryRows<{ status: string }>(
      db,
      `SELECT status FROM public.provider_services WHERE provider_id = $1 AND service_id = $2`,
      [IDS.provider, serviceId],
    );
    expect(row[0]?.status).toBe("pending");
  });

  it("remove marks service removed and reports upcoming bookings", async () => {
    const result = await asUser(db, IDS.providerUser, async () =>
      queryRows<{ result: { upcoming_bookings: number; ok: boolean } }>(
        db,
        `SELECT public.provider_remove_service($1::uuid) AS result`,
        [serviceId],
      ),
    );
    expect(result[0]?.result.ok).toBe(true);
    expect(result[0]?.result.upcoming_bookings).toBe(0);

    const row = await queryRows<{ status: string }>(
      db,
      `SELECT status FROM public.provider_services WHERE provider_id = $1 AND service_id = $2`,
      [IDS.provider, serviceId],
    );
    expect(row[0]?.status).toBe("removed");
  });

  it("blocks direct price_override edits while a service is paused", async () => {
    await asUser(db, IDS.providerUser, async () => {
      await queryRows(db, `SELECT public.provider_set_service_active($1::uuid, false)`, [serviceId]);
    });

    const blocked = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.provider_services SET price_override = 999 WHERE provider_id = $1 AND service_id = $2`,
      [IDS.provider, serviceId],
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.error ?? "").toMatch(/provider_request_price_change/i);

    const blockedOnline = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.provider_services SET online_price_override = 888 WHERE provider_id = $1 AND service_id = $2`,
      [IDS.provider, serviceId],
    );
    expect(blockedOnline.ok).toBe(false);
    expect(blockedOnline.error ?? "").toMatch(/online price changes reviewed/i);
  });

  it("rejects provider direct status bump pending to approved", async () => {
    await asUser(db, IDS.adminUser, async () => {
      await queryRows(
        db,
        `UPDATE public.provider_services SET status = 'pending' WHERE provider_id = $1 AND service_id = $2`,
        [IDS.provider, serviceId],
      );
    });

    const blocked = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.provider_services SET status = 'approved' WHERE provider_id = $1 AND service_id = $2`,
      [IDS.provider, serviceId],
    );
    expect(blocked.ok).toBe(false);

    const row = await queryRows<{ status: string }>(
      db,
      `SELECT status FROM public.provider_services WHERE provider_id = $1 AND service_id = $2`,
      [IDS.provider, serviceId],
    );
    expect(row[0]?.status).toBe("pending");
  });

  it("re-requests a removed service into pending review", async () => {
    await asUser(db, IDS.providerUser, async () => {
      await queryRows(db, `SELECT public.provider_remove_service($1::uuid)`, [serviceId]);
    });

    const payload = JSON.stringify({
      age_group_capabilities: [{ age_group_code: "preschool" }],
    });
    const requested = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_request_service($1::uuid, $2::jsonb, gen_random_uuid())`,
      [serviceId, payload],
    );
    expect(requested.ok, requested.error).toBe(true);

    const row = await queryRows<{ status: string }>(
      db,
      `SELECT status FROM public.provider_services WHERE provider_id = $1 AND service_id = $2`,
      [IDS.provider, serviceId],
    );
    expect(row[0]?.status).toBe("pending");
  });

  it("rejects pause/remove from another provider", async () => {
    const deniedPause = await tryAsUser(
      db,
      IDS.otherProviderUser,
      `SELECT public.provider_set_service_active($1::uuid, false)`,
      [serviceId],
    );
    expect(deniedPause.ok).toBe(false);

    const deniedRemove = await tryAsUser(
      db,
      IDS.otherProviderUser,
      `SELECT public.provider_remove_service($1::uuid)`,
      [serviceId],
    );
    expect(deniedRemove.ok).toBe(false);
  });
});