import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  approveProviderApplication,
  asServiceRole,
  asUser,
  createProviderLifecycleDb,
  fillOnboardingSections,
  IDS,
  notificationCount,
  HOURLY_CREATE_BOOKING_SQL,
  lifecycleBookingDates,
  OVERNIGHT_CREATE_BOOKING_SQL,
  queryRows,
  searchMarketplace,
  seedAdminOwnSubmittedApplication,
  seedDraftProvider,
  submitOnboarding,
  tryAsAnon,
  tryAsUser,
} from "./provider-lifecycle.harness";
import { stableCairoBookingBaseDate } from "./cairo-stable-booking-date";

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

describe("provider lifecycle (migration replay)", () => {
  it("onboarding: draft → submit → needs changes → resubmit → approve", async () => {
    const seed = await seedDraftProvider(db);
    expect(
      (await searchMarketplace(db, IDS.customer, IDS.addressInZone)).some(
        (r) => r.id === IDS.provider,
      ),
    ).toBe(false);

    await fillOnboardingSections(db, IDS.zone, seed.serviceId);
    const firstSubmit = await submitOnboarding(db);
    expect(firstSubmit.ok).toBe(true);

    const afterSubmit = await queryRows<{ onboarding_status: string }>(
      db,
      `SELECT onboarding_status::text AS onboarding_status FROM public.providers WHERE id = $1`,
      [IDS.provider],
    );
    expect(afterSubmit[0]?.onboarding_status).toBe("SUBMITTED");

    const beforeChangeNotice = await notificationCount(db, IDS.providerUser);
    await asUser(db, IDS.adminUser, async () => {
      await queryRows(
        db,
        `SELECT public.admin_provider_onboarding_action($1, 'request_changes', 'missing_info', 'Update your bio')`,
        [IDS.provider],
      );
    });
    expect(await notificationCount(db, IDS.providerUser)).toBe(beforeChangeNotice + 1);

    const needsChanges = await queryRows<{ onboarding_status: string }>(
      db,
      `SELECT onboarding_status::text AS onboarding_status FROM public.providers WHERE id = $1`,
      [IDS.provider],
    );
    expect(needsChanges[0]?.onboarding_status).toBe("NEEDS_CHANGES");

    await asUser(db, IDS.providerUser, async () => {
      await queryRows(
        db,
        `SELECT public.provider_save_onboarding_section('experience', $1::jsonb)`,
        [
          JSON.stringify({
            bio_ar: "سيرة محدثة",
            years_experience: 4,
            max_children_per_booking: 2,
            age_group_capabilities: [{ code: "preschool" }, { code: "school_age" }],
          }),
        ],
      );
    });
    const resubmit = await submitOnboarding(db);
    expect(resubmit.ok).toBe(true);

    await approveProviderApplication(db);
    const approved = await queryRows<{ onboarding_status: string; is_verified: boolean }>(
      db,
      `SELECT onboarding_status::text AS onboarding_status, is_verified FROM public.providers WHERE id = $1`,
      [IDS.provider],
    );
    expect(approved[0]?.onboarding_status).toBe("APPROVED");
    expect(approved[0]?.is_verified).toBe(true);

    const visible = await searchMarketplace(db, IDS.customer, IDS.addressInZone);
    expect(visible.some((row) => row.id === IDS.provider)).toBe(true);
    const hiddenOutOfZone = await searchMarketplace(db, IDS.customer, IDS.addressOutOfZone);
    expect(hiddenOutOfZone.some((row) => row.id === IDS.provider)).toBe(false);
  });

  it("rejection removes the provider from marketplace discovery", async () => {
    const seed = await seedDraftProvider(db);
    await fillOnboardingSections(db, IDS.zone, seed.serviceId);
    await submitOnboarding(db);

    const rejectNotice = await notificationCount(db, IDS.providerUser);
    await asUser(db, IDS.adminUser, async () => {
      await queryRows(
        db,
        `SELECT public.admin_provider_onboarding_action($1, 'reject', 'policy', 'Cannot serve now')`,
        [IDS.provider],
      );
    });
    expect(await notificationCount(db, IDS.providerUser)).toBe(rejectNotice + 1);
    expect(
      (await searchMarketplace(db, IDS.customer, IDS.addressInZone)).some(
        (r) => r.id === IDS.provider,
      ),
    ).toBe(false);
  });

  it("suspension hides discovery while existing bookings stay intact", async () => {
    const seed = await seedDraftProvider(db);
    await fillOnboardingSections(db, IDS.zone, seed.serviceId);
    await submitOnboarding(db);
    await approveProviderApplication(db);

    const dates = lifecycleBookingDates();
    const booking = await asUser(db, IDS.customer, async () =>
      queryRows<{ result: { booking_id: string } }>(db, HOURLY_CREATE_BOOKING_SQL, [
        IDS.provider,
        seed.serviceId,
        IDS.addressInZone,
        dates.first,
        IDS.childMember,
      ]),
    );
    const bookingId = booking[0]?.result?.booking_id;
    expect(bookingId).toBeTruthy();

    await asUser(db, IDS.adminUser, async () => {
      await queryRows(
        db,
        `SELECT public.admin_provider_onboarding_action($1, 'suspend', 'conduct', 'Paused temporarily')`,
        [IDS.provider],
      );
    });
    expect(
      (await searchMarketplace(db, IDS.customer, IDS.addressInZone)).some(
        (r) => r.id === IDS.provider,
      ),
    ).toBe(false);
    expect(
      (
        await queryRows<{ status: string }>(
          db,
          `SELECT status::text AS status FROM public.bookings WHERE id = $1`,
          [bookingId],
        )
      )[0]?.status,
    ).toBe("pending");
  });

  it("document access: provider own, admin all, customer and anon denied", async () => {
    const seed = await seedDraftProvider(db);
    await fillOnboardingSections(db, IDS.zone, seed.serviceId);

    const providerDocs = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT id, storage_path FROM public.provider_documents WHERE provider_id = $1`,
      [IDS.provider],
    );
    expect(providerDocs.ok).toBe(true);
    expect((providerDocs.rows ?? []).length).toBeGreaterThanOrEqual(2);

    const adminDocs = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT id FROM public.provider_documents WHERE provider_id = $1`,
      [IDS.provider],
    );
    expect(adminDocs.ok).toBe(true);
    expect((adminDocs.rows ?? []).length).toBeGreaterThanOrEqual(2);

    const customerDocs = await tryAsUser(
      db,
      IDS.customer,
      `SELECT id FROM public.provider_documents WHERE provider_id = $1`,
      [IDS.provider],
    );
    expect(customerDocs.ok).toBe(true);
    expect(customerDocs.rows ?? []).toHaveLength(0);

    const anonRead = await tryAsAnon(db, `SELECT id FROM public.provider_documents LIMIT 1`);
    expect(anonRead.ok).toBe(false);
  });

  it("service request is bookable only after admin approval", async () => {
    const seed = await seedDraftProvider(db);
    await fillOnboardingSections(db, IDS.zone, seed.serviceId);
    await submitOnboarding(db);
    await approveProviderApplication(db);

    const extraServiceId = (
      await queryRows<{ id: string }>(
        db,
        `SELECT id FROM public.services WHERE slug = 'overnight-babysitting' LIMIT 1`,
      )
    )[0]?.id;
    expect(extraServiceId).toBeTruthy();

    const requestPayload = JSON.stringify({
      age_group_capabilities: [{ age_group_code: "preschool" }],
    });

    const requested = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_request_service($1::uuid, $2::jsonb, gen_random_uuid())`,
      [extraServiceId, requestPayload],
    );
    expect(requested.ok, requested.error).toBe(true);

    const pendingPs = await queryRows<{ id: string; status: string }>(
      db,
      `SELECT id, status FROM public.provider_services WHERE provider_id = $1 AND service_id = $2`,
      [IDS.provider, extraServiceId],
    );
    expect(pendingPs[0]?.status).toBe("pending");

    const bookingDate = stableCairoBookingBaseDate();
    const blockedBooking = await tryAsUser(
      db,
      IDS.customer,
      OVERNIGHT_CREATE_BOOKING_SQL,
      [IDS.provider, extraServiceId, IDS.addressInZone, bookingDate, IDS.childMember],
    );
    expect(blockedBooking.ok, blockedBooking.error).toBe(false);

    await asUser(db, IDS.adminUser, async () => {
      await queryRows(db, `SELECT public.admin_set_provider_service_status($1, 'approved', NULL)`, [
        pendingPs[0]!.id,
      ]);
    });
    const serviceApprovedNotices = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.notifications WHERE user_id = $1 AND type = 'provider_service_approved'`,
      [IDS.providerUser],
    );
    expect(serviceApprovedNotices.length).toBeGreaterThanOrEqual(1);

    expect(
      (
        await queryRows<{ status: string }>(
          db,
          `SELECT status FROM public.provider_services WHERE provider_id = $1 AND service_id = $2`,
          [IDS.provider, extraServiceId],
        )
      )[0]?.status,
    ).toBe("approved");

    const allowedBooking = await tryAsUser(
      db,
      IDS.customer,
      OVERNIGHT_CREATE_BOOKING_SQL,
      [IDS.provider, extraServiceId, IDS.addressInZone, bookingDate, IDS.childMember],
    );
    expect(allowedBooking.ok, allowedBooking.error).toBe(true);
  });

  it("price change approval affects only new bookings", async () => {
    const seed = await seedDraftProvider(db);
    await asServiceRole(db, async () => {
      await db.exec(`
        UPDATE public.services
        SET provider_pricing_allowed = true, minimum_price = 100, maximum_price = 500
        WHERE id = '${seed.serviceId}';
        UPDATE public.provider_services
        SET price_override = 250
        WHERE provider_id = '${IDS.provider}' AND service_id = '${seed.serviceId}';
      `);
    });
    await fillOnboardingSections(db, IDS.zone, seed.serviceId);
    await submitOnboarding(db);
    await approveProviderApplication(db);

    const dates = lifecycleBookingDates();
    const firstBooking = await asUser(db, IDS.customer, async () =>
      queryRows<{ result: { booking_id: string } }>(db, HOURLY_CREATE_BOOKING_SQL, [
        IDS.provider,
        seed.serviceId,
        IDS.addressInZone,
        dates.first,
        IDS.childMember,
      ]),
    );
    const firstBookingId = firstBooking[0]?.result?.booking_id;
    const beforePrice = (
      await queryRows<{ price_total: string; price_commission_amount: string }>(
        db,
        `SELECT price_total::text, price_commission_amount::text FROM public.bookings WHERE id = $1`,
        [firstBookingId],
      )
    )[0];

    await asUser(db, IDS.providerUser, async () => {
      await queryRows(db, `SELECT public.provider_request_price_change($1::uuid, 320)`, [
        seed.serviceId,
      ]);
    });
    await asUser(db, IDS.adminUser, async () => {
      await queryRows(db, `SELECT public.admin_review_price_change($1, 'approved', NULL)`, [
        seed.providerServiceId,
      ]);
    });

    await asUser(db, IDS.customer, async () =>
      queryRows(db, HOURLY_CREATE_BOOKING_SQL, [
        IDS.provider,
        seed.serviceId,
        IDS.addressInZone,
        dates.second,
        IDS.childMember,
      ]),
    );

    const afterRows = await queryRows<{ id: string; price_total: string }>(
      db,
      `SELECT id, price_total::text AS price_total FROM public.bookings WHERE provider_id = $1 ORDER BY created_at`,
      [IDS.provider],
    );
    expect(afterRows).toHaveLength(2);
    const oldRow = afterRows.find((r) => r.id === firstBookingId);
    const newRow = afterRows.find((r) => r.id !== firstBookingId);
    expect(oldRow?.price_total).toBe(beforePrice?.price_total);
    expect(Number(newRow?.price_total)).toBeGreaterThan(Number(oldRow?.price_total));
    const oldCommission = (
      await queryRows<{ price_commission_amount: string | null }>(
        db,
        `SELECT price_commission_amount::text FROM public.bookings WHERE id = $1`,
        [firstBookingId],
      )
    )[0]?.price_commission_amount;
    expect(oldCommission).toBe(beforePrice?.price_commission_amount ?? null);
  });

  it("admin approve-all only approves pending pieces", async () => {
    const seed = await seedDraftProvider(db);
    await fillOnboardingSections(db, IDS.zone, seed.serviceId);
    await submitOnboarding(db);

    await asUser(db, IDS.adminUser, async () => {
      await queryRows(db, `SELECT public.admin_set_provider_service_status($1, 'approved', NULL)`, [
        seed.providerServiceId,
      ]);
    });

    const secondService = (
      await queryRows<{ id: string }>(
        db,
        `SELECT id FROM public.services WHERE slug = 'overnight-babysitting' LIMIT 1`,
      )
    )[0]?.id;
    expect(secondService).toBeTruthy();

    const pendingPs = await asUser(db, IDS.providerUser, async () =>
      queryRows<{ id: string }>(
        db,
        `
          INSERT INTO public.provider_services (provider_id, service_id, status)
          VALUES ($1, $2, 'pending')
          ON CONFLICT (provider_id, service_id) DO UPDATE SET status = 'pending'
          RETURNING id
        `,
        [IDS.provider, secondService],
      ),
    );

    await asUser(db, IDS.adminUser, async () => {
      await queryRows(db, `SELECT set_config('app.onboarding_status_transition', '1', true)`);
      await queryRows(
        db,
        `UPDATE public.providers SET onboarding_status = 'UNDER_REVIEW' WHERE id = $1`,
        [IDS.provider],
      );
    });

    const docs = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.provider_documents WHERE provider_id = $1 AND type IN ('id_card_front', 'id_card_back')`,
      [IDS.provider],
    );
    await asUser(db, IDS.adminUser, async () => {
      for (const doc of docs) {
        await queryRows(
          db,
          `SELECT public.admin_review_provider_document($1, 'approved'::public.verification_status, NULL)`,
          [doc.id],
        );
      }
    });

    const result = await asUser(db, IDS.adminUser, async () =>
      queryRows<{ result: { approved_services: number } }>(
        db,
        `SELECT public.admin_approve_provider_application_all($1) AS result`,
        [IDS.provider],
      ),
    );
    expect(result[0]?.result?.approved_services).toBe(1);

    const statuses = await queryRows<{ service_id: string; status: string }>(
      db,
      `SELECT service_id::text, status FROM public.provider_services WHERE provider_id = $1 ORDER BY service_id`,
      [IDS.provider],
    );
    const primary = statuses.find((s) => s.service_id === seed.serviceId);
    const extra = statuses.find((s) => s.service_id === secondService);
    expect(primary?.status).toBe("approved");
    expect(extra?.status).toBe("approved");
    expect(pendingPs[0]?.id).toBeTruthy();
  });

  it("negative cases: no self-approval, guarded columns, admin-only RPCs, anon blocked", async () => {
    const seed = await seedDraftProvider(db);
    await fillOnboardingSections(db, IDS.zone, seed.serviceId);
    await submitOnboarding(db);
    expect(
      (
        await queryRows<{ onboarding_status: string }>(
          db,
          `SELECT onboarding_status::text AS onboarding_status FROM public.providers WHERE id = $1`,
          [IDS.provider],
        )
      )[0]?.onboarding_status,
    ).toBe("SUBMITTED");

    const nonAdminApprove = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.admin_provider_onboarding_action($1, 'approve', NULL, NULL, NULL)`,
      [IDS.provider],
    );
    expect(nonAdminApprove.ok).toBe(false);

    await seedAdminOwnSubmittedApplication(db, seed.serviceId);
    const selfApproveAll = await tryAsUser(
      db,
      IDS.adminProviderUser,
      `SELECT public.admin_approve_provider_application_all($1)`,
      [IDS.adminOwnedProvider],
    );
    expect(selfApproveAll.ok).toBe(false);
    expect(selfApproveAll.error ?? "").toMatch(/cannot approve their own/i);

    const commissionTamper = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.provider_services SET price_override = 999 WHERE provider_id = $1 AND service_id = $2`,
      [IDS.provider, seed.serviceId],
    );
    expect(commissionTamper.ok).toBe(false);

    const providerRpc = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.admin_set_provider_service_status($1, 'approved', NULL)`,
      [seed.providerServiceId],
    );
    expect(providerRpc.ok).toBe(false);

    const anonSubmit = await tryAsAnon(db, `SELECT public.provider_submit_onboarding()`);
    expect(anonSubmit.ok).toBe(false);
  });

  it("emits exactly one provider notification per admin onboarding decision", async () => {
    const seed = await seedDraftProvider(db);
    await fillOnboardingSections(db, IDS.zone, seed.serviceId);
    await submitOnboarding(db);

    let baseline = await notificationCount(db, IDS.providerUser);
    await asUser(db, IDS.adminUser, async () => {
      await queryRows(
        db,
        `SELECT public.admin_provider_onboarding_action($1, 'request_changes', 'docs', 'Fix documents')`,
        [IDS.provider],
      );
    });
    expect(await notificationCount(db, IDS.providerUser)).toBe(baseline + 1);
    baseline += 1;

    await asUser(db, IDS.providerUser, async () => {
      await queryRows(db, `SELECT public.provider_save_onboarding_section('review', $1::jsonb)`, [
        JSON.stringify({ confirmed: true }),
      ]);
    });
    await submitOnboarding(db);

    await approveProviderApplication(db);
    expect(await notificationCount(db, IDS.providerUser)).toBe(baseline + 1);
  });
});
