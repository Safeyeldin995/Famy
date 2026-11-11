import type { PGlite } from "@electric-sql/pglite";
import { cairoDatePlusDays, stableCairoBookingBaseDate } from "./cairo-stable-booking-date";
import { createMigrationReplayDb, replayAllMigrations } from "./migration-replay.harness";

export const IDS = {
  customer: "00000000-0000-0000-0000-00000000a001",
  providerUser: "00000000-0000-0000-0000-00000000a011",
  otherProviderUser: "00000000-0000-0000-0000-00000000a012",
  adminUser: "00000000-0000-0000-0000-00000000a021",
  adminProviderUser: "00000000-0000-0000-0000-00000000a031",
  provider: "00000000-0000-0000-0000-00000000a111",
  adminOwnedProvider: "00000000-0000-0000-0000-00000000a131",
  zone: "00000000-0000-0000-0000-00000000a411",
  otherZone: "00000000-0000-0000-0000-00000000a412",
  addressInZone: "00000000-0000-0000-0000-00000000a511",
  addressOutOfZone: "00000000-0000-0000-0000-00000000a512",
  childMember: "00000000-0000-0000-0000-00000000a611",
} as const;

export type LifecycleSeed = {
  serviceId: string;
  providerServiceId: string;
  tutoringServiceId: string;
};

export async function queryRows<T extends Record<string, unknown>>(
  db: PGlite,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const result = params ? await db.query<T>(sql, params) : await db.query<T>(sql);
  return result.rows;
}

export async function createProviderLifecycleDb(): Promise<PGlite> {
  const db = await createMigrationReplayDb();
  await replayAllMigrations(db);
  await db.exec(
    "ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb DEFAULT '{}'::jsonb",
  );
  return db;
}

export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec("SAVEPOINT provider_lifecycle_user");
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await db.query("SELECT set_config('request.jwt.claim.aal', 'aal2', true)");
    await db.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true)");
    await db.exec("SET LOCAL ROLE authenticated");
    const result = await fn();
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub', '', true)");
    await db.query("SELECT set_config('request.jwt.claim.role', '', true)");
    await db.exec("RELEASE SAVEPOINT provider_lifecycle_user");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK TO SAVEPOINT provider_lifecycle_user");
    await db.exec("RELEASE SAVEPOINT provider_lifecycle_user");
    throw error;
  }
}

export async function asServiceRole<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec("SAVEPOINT provider_lifecycle_service");
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', '', true)");
    await db.query("SELECT set_config('request.jwt.claim.role', 'service_role', true)");
    await db.exec("SET LOCAL ROLE service_role");
    const result = await fn();
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.role', '', true)");
    await db.exec("RELEASE SAVEPOINT provider_lifecycle_service");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK TO SAVEPOINT provider_lifecycle_service");
    await db.query("SELECT set_config('request.jwt.claim.role', '', true)");
    await db.exec("RELEASE SAVEPOINT provider_lifecycle_service");
    throw error;
  }
}

export async function tryAsUser(
  db: PGlite,
  userId: string,
  sql: string,
  params?: unknown[],
): Promise<{ ok: boolean; error?: string; rows?: Record<string, unknown>[] }> {
  try {
    const rows = await asUser(db, userId, async () => queryRows(db, sql, params));
    return { ok: true, rows };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function tryAsAnon(
  db: PGlite,
  sql: string,
  params?: unknown[],
): Promise<{ ok: boolean; error?: string; rows?: Record<string, unknown>[] }> {
  await db.exec("SAVEPOINT provider_lifecycle_anon");
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', '', true)");
    await db.exec("SET LOCAL ROLE anon");
    if (params) await db.query(sql, params);
    else await db.query(sql);
    await db.exec("RESET ROLE");
    await db.exec("RELEASE SAVEPOINT provider_lifecycle_anon");
    return { ok: true };
  } catch (error) {
    await db.exec("ROLLBACK TO SAVEPOINT provider_lifecycle_anon");
    await db.exec("RELEASE SAVEPOINT provider_lifecycle_anon");
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function notificationCount(db: PGlite, userId: string): Promise<number> {
  const rows = await queryRows<{ n: number }>(
    db,
    `SELECT count(*)::int AS n FROM public.notifications WHERE user_id = $1`,
    [userId],
  );
  return rows[0]?.n ?? 0;
}

export async function searchMarketplace(
  db: PGlite,
  customerId: string,
  addressId: string,
): Promise<{ id: string; full_name: string | null }[]> {
  return asUser(db, customerId, async () =>
    queryRows<{ id: string; full_name: string | null }>(
      db,
      `SELECT id, full_name FROM public.search_marketplace_providers(NULL, $1::uuid)`,
      [addressId],
    ),
  );
}

/** Seeds identities, zone, address, and a DRAFT babysitting provider (transaction-local). */
export async function seedDraftProvider(db: PGlite): Promise<LifecycleSeed> {
  const serviceRows = await queryRows<{ id: string }>(
    db,
    `SELECT id FROM public.services WHERE slug = 'hourly-babysitting' LIMIT 1`,
  );
  const tutoringRows = await queryRows<{ id: string }>(
    db,
    `SELECT id FROM public.services WHERE slug = 'homework-support' LIMIT 1`,
  );
  const serviceId = serviceRows[0]?.id;
  const tutoringServiceId = tutoringRows[0]?.id;
  if (!serviceId || !tutoringServiceId) {
    throw new Error("expected babysitting and tutoring services after migration replay");
  }

  await db.exec(`
    INSERT INTO auth.users (id, raw_user_meta_data) VALUES
      ('${IDS.customer}', '{"full_name":"Lifecycle Customer"}'),
      ('${IDS.providerUser}', '{"signup_role":"provider","full_name":"Lifecycle Provider"}'),
      ('${IDS.adminUser}', '{"full_name":"Lifecycle Admin"}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role) VALUES
      ('${IDS.customer}', 'customer'),
      ('${IDS.adminUser}', 'admin')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.providers (
      id, profile_id, hourly_rate, onboarding_status, bio_en, bio_ar, years_experience
    ) VALUES (
      '${IDS.provider}', '${IDS.providerUser}', 150, 'DRAFT', 'Bio EN', 'سيرة', 3
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.provider_onboarding_details (provider_id) VALUES ('${IDS.provider}')
    ON CONFLICT (provider_id) DO NOTHING;

    INSERT INTO public.zones (
      id, name_en, name_ar, is_active, boundary_type, center_lat, center_lng, radius_km, travel_fee
    ) VALUES
      ('${IDS.zone}', 'Lifecycle Zone', 'منطقة', true, 'circle', 30.05, 31.25, 25, 0),
      ('${IDS.otherZone}', 'Other Zone', 'منطقة أخرى', true, 'circle', 29.9, 30.9, 10, 0)
    ON CONFLICT (id) DO UPDATE SET is_active = true;

    INSERT INTO public.zone_services (zone_id, service_id)
    SELECT '${IDS.zone}', s.id
    FROM public.services s
    WHERE s.slug IN ('hourly-babysitting', 'homework-support', 'overnight-babysitting')
    ON CONFLICT DO NOTHING;
    INSERT INTO public.zone_services (zone_id, service_id)
    SELECT '${IDS.otherZone}', s.id FROM public.services s WHERE s.slug = 'hourly-babysitting'
    ON CONFLICT DO NOTHING;

    INSERT INTO public.zone_providers (provider_id, zone_id) VALUES ('${IDS.provider}', '${IDS.zone}')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.provider_services (provider_id, service_id, status) VALUES
      ('${IDS.provider}', '${serviceId}', 'pending')
    ON CONFLICT (provider_id, service_id) DO UPDATE SET status = 'pending', price_override = NULL;

    INSERT INTO public.addresses (id, user_id, label, line1, city, lat, lng, is_default) VALUES
      ('${IDS.addressInZone}', '${IDS.customer}', 'home', 'In zone', 'Cairo', 30.05, 31.25, true),
      ('${IDS.addressOutOfZone}', '${IDS.customer}', 'other', 'Out of zone', 'Cairo', 29.9, 30.9, false)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.family_members (id, customer_id, full_name, relationship, date_of_birth, is_active) VALUES
      ('${IDS.childMember}', '${IDS.customer}', 'Child', 'daughter', DATE '2020-06-01', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.availability_rules (provider_id, weekday, start_time, end_time)
    SELECT '${IDS.provider}', day, '00:00'::time, '24:00'::time FROM generate_series(0, 6) AS day
    ON CONFLICT DO NOTHING;
  `);

  const psRows = await queryRows<{ id: string }>(
    db,
    `SELECT id FROM public.provider_services WHERE provider_id = $1 AND service_id = $2`,
    [IDS.provider, serviceId],
  );
  const providerServiceId = psRows[0]?.id;
  if (!providerServiceId) throw new Error("provider_services row missing");

  return { serviceId, providerServiceId, tutoringServiceId };
}

export async function fillOnboardingSections(
  db: PGlite,
  zoneId: string,
  serviceId: string,
): Promise<void> {
  const personal = JSON.stringify({
    legal_name: "Lifecycle Provider",
    date_of_birth: "1990-05-01",
    governorate: "Cairo",
    area: "Maadi",
    full_address: "Test address 9",
    phone: "01001234567",
  });
  const experience = JSON.stringify({
    bio_ar: "خبرة في رعاية الأطفال",
    years_experience: 3,
    max_children_per_booking: 2,
    age_group_capabilities: [{ code: "preschool" }, { code: "school_age" }],
  });
  const references = JSON.stringify({
    references: [{ full_name: "Reference One", relationship: "Work", phone: "01009876543" }],
  });
  const coverage = JSON.stringify({ zone_ids: [zoneId] });
  const services = JSON.stringify({ service_ids: [serviceId] });
  const review = JSON.stringify({ confirmed: true });

  await db.exec(
    `UPDATE public.profiles SET phone = '01001234567' WHERE id = '${IDS.providerUser}'`,
  );

  await asUser(db, IDS.providerUser, async () => {
    for (const [section, payload] of [
      ["personal", personal],
      ["experience", experience],
      ["references", references],
      ["coverage", coverage],
      ["services", services],
      ["review", review],
    ] as const) {
      await queryRows(db, `SELECT public.provider_save_onboarding_section($1::text, $2::jsonb)`, [
        section,
        payload,
      ]);
    }
    await queryRows(
      db,
      `SELECT public.provider_prepare_document_upload('id_card_front','image/jpeg',1024)`,
    );
    await queryRows(
      db,
      `SELECT public.provider_prepare_document_upload('id_card_back','image/jpeg',1024)`,
    );
    await queryRows(db, `SELECT public.provider_finalize_document_upload($1, 'id_card_front')`, [
      `${IDS.provider}/id_card_front-test.jpg`,
    ]);
    await queryRows(db, `SELECT public.provider_finalize_document_upload($1, 'id_card_back')`, [
      `${IDS.provider}/id_card_back-test.jpg`,
    ]);
    await queryRows(
      db,
      `SELECT public.provider_prepare_document_upload('profile_photo','image/jpeg',1024)`,
    );
    await queryRows(db, `SELECT public.provider_finalize_document_upload($1, 'profile_photo')`, [
      `${IDS.provider}/profile_photo-test.jpg`,
    ]);
    await db.exec(
      `UPDATE public.profiles SET avatar_url = '${IDS.provider}/profile_photo-test.jpg' WHERE id = '${IDS.providerUser}'`,
    );
  });
}

export async function submitOnboarding(
  db: PGlite,
): Promise<{ ok: boolean; errors?: Record<string, string> }> {
  const rows = await asUser(db, IDS.providerUser, async () =>
    queryRows<{ result: { ok: boolean; errors?: Record<string, string> } }>(
      db,
      `SELECT public.provider_submit_onboarding() AS result`,
    ),
  );
  return rows[0]?.result ?? { ok: false };
}

export async function approveIdentityDocuments(db: PGlite): Promise<void> {
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
    for (const ps of await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.provider_services WHERE provider_id = $1 AND status = 'pending'`,
      [IDS.provider],
    )) {
      await queryRows(db, `SELECT public.admin_set_provider_service_status($1, 'approved', NULL)`, [
        ps.id,
      ]);
    }
  });
}

export async function approveProviderApplication(db: PGlite): Promise<void> {
  await approveIdentityDocuments(db);
  await asUser(db, IDS.adminUser, async () => {
    await queryRows(
      db,
      `SELECT public.admin_provider_onboarding_action($1, 'approve', NULL, NULL, NULL)`,
      [IDS.provider],
    );
  });
}

/** Submitted application owned by a user who is both admin and provider (self-approval guard). */
export async function seedAdminOwnSubmittedApplication(db: PGlite, serviceId: string): Promise<void> {
  await db.exec(`
    INSERT INTO auth.users (id, raw_user_meta_data) VALUES
      ('${IDS.adminProviderUser}', '{"signup_role":"provider","full_name":"Admin Provider Twin"}')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES ('${IDS.adminProviderUser}', 'admin')
    ON CONFLICT DO NOTHING;
    INSERT INTO public.providers (id, profile_id, hourly_rate, onboarding_status)
    VALUES ('${IDS.adminOwnedProvider}', '${IDS.adminProviderUser}', 150, 'SUBMITTED')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.provider_services (provider_id, service_id, status)
    VALUES ('${IDS.adminOwnedProvider}', '${serviceId}', 'pending')
    ON CONFLICT (provider_id, service_id) DO UPDATE SET status = 'pending';
  `);
}

export const OVERNIGHT_CREATE_BOOKING_SQL = `
  SELECT public.create_booking(
    $1::uuid, $2::uuid, $3::uuid,
    (SELECT (($4::date + time '18:00') AT TIME ZONE 'Africa/Cairo')),
    (SELECT (($4::date + time '18:00') AT TIME ZONE 'Africa/Cairo') + interval '6 hours'),
    gen_random_uuid(), $5::uuid, NULL, NULL, '[]'::jsonb, NULL, NULL, NULL, NULL, 'adult_present'
  )
`;

/** Two-hour babysitting slot on a stable Cairo calendar date (avoids `now() + interval` flake). */
export const HOURLY_CREATE_BOOKING_SQL = `
  SELECT public.create_booking(
    $1::uuid, $2::uuid, $3::uuid,
    (SELECT (($4::date + time '10:00') AT TIME ZONE 'Africa/Cairo')),
    (SELECT (($4::date + time '10:00') AT TIME ZONE 'Africa/Cairo') + interval '2 hours'),
    gen_random_uuid(), $5::uuid, NULL, NULL, '[]'::jsonb, NULL, NULL, NULL, NULL, 'adult_present'
  ) AS result
`;

export function lifecycleBookingDates() {
  const base = stableCairoBookingBaseDate();
  return {
    first: base,
    second: cairoDatePlusDays(base, 1),
    third: cairoDatePlusDays(base, 2),
  };
}
