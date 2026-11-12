import type { PGlite } from "@electric-sql/pglite";
import { cairoDatePlusDays, stableCairoBookingBaseDate } from "./cairo-stable-booking-date";
import { createMigrationReplayDb, replayAllMigrations } from "./migration-replay.harness";

/** Fixed Cairo local times — daytime slot that stays inside 00:00–23:59 availability rules. */
export const LIFECYCLE_SLOT_START = "10:00";
export const LIFECYCLE_SLOT_END = "12:00";
export const LIFECYCLE_RESCHEDULE_START = "14:00";
export const LIFECYCLE_RESCHEDULE_END = "16:00";

const PAYMENT_CASH_ID = "00000000-0000-0000-0000-000000000901";
const PAYMENT_PAYMOB_ID = "00000000-0000-0000-0000-000000000902";

export const IDS = {
  customer: "00000000-0000-0000-0000-000000000001",
  providerUser: "00000000-0000-0000-0000-000000000011",
  otherProviderUser: "00000000-0000-0000-0000-000000000012",
  adminUser: "00000000-0000-0000-0000-000000000021",
  provider: "00000000-0000-0000-0000-000000000111",
  otherProvider: "00000000-0000-0000-0000-000000000112",
  zone: "00000000-0000-0000-0000-000000000411",
  address: "00000000-0000-0000-0000-000000000511",
  childMember: "00000000-0000-0000-0000-000000000611",
} as const;

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "on_the_way"
  | "arrived"
  | "arrival_confirmed"
  | "in_progress"
  | "completion_requested"
  | "completed"
  | "cancelled"
  | "no_show"
  | "disputed";

export async function queryRows<T extends Record<string, unknown>>(
  db: PGlite,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const result = params ? await db.query<T>(sql, params) : await db.query<T>(sql);
  return result.rows;
}

export async function createBookingLifecycleDb(): Promise<PGlite> {
  const db = await createMigrationReplayDb();
  await replayAllMigrations(db);
  await db.exec(
    "ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb DEFAULT '{}'::jsonb",
  );
  return db;
}

/** Inserts marketplace + booking fixture; returns booking id (pending, slot in the past for time-window steps). */
export async function seedLifecycleBooking(
  db: PGlite,
  opts?: { providerId?: string; customerId?: string; status?: BookingStatus },
): Promise<{ bookingId: string; serviceId: string }> {
  const providerId = opts?.providerId ?? IDS.provider;
  const customerId = opts?.customerId ?? IDS.customer;
  const status = opts?.status ?? "pending";

  const serviceRows = await queryRows<{ id: string }>(
    db,
    `SELECT id FROM public.services WHERE slug = 'hourly-babysitting' LIMIT 1`,
  );
  const serviceId = serviceRows[0]?.id;
  if (!serviceId) {
    throw new Error("expected seeded babysitting service hourly-babysitting after migration replay");
  }

  const fixtureReady = await queryRows<{ ok: number }>(
    db,
  `SELECT 1 AS ok FROM public.providers WHERE id = $1 AND onboarding_status = 'APPROVED' LIMIT 1`,
    [providerId],
  );

  if (!fixtureReady.length) {
  await db.exec(`
    INSERT INTO auth.users (id, raw_user_meta_data) VALUES
      ('${customerId}', '{"full_name":"Lifecycle Customer"}'),
      ('${IDS.providerUser}', '{"signup_role":"provider","full_name":"Lifecycle Provider"}'),
      ('${IDS.otherProviderUser}', '{"signup_role":"provider","full_name":"Other Provider"}'),
      ('${IDS.adminUser}', '{"full_name":"Lifecycle Admin"}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role) VALUES
      ('${IDS.adminUser}', 'admin')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.providers (
      id, profile_id, hourly_rate, onboarding_status, is_active, vacation_mode,
      min_notice_hours, max_advance_days, buffer_minutes, bio_en, bio_ar
    ) VALUES
      ('${providerId}', '${IDS.providerUser}', 150, 'DRAFT', true, false, 0, 365, 0, 'Bio', 'سيرة'),
      ('${IDS.otherProvider}', '${IDS.otherProviderUser}', 150, 'DRAFT', true, false, 0, 365, 0, 'Bio', 'سيرة')
    ON CONFLICT (id) DO UPDATE SET
      is_active = true, vacation_mode = false, min_notice_hours = 0, max_advance_days = 365;

    INSERT INTO public.zones (id, name_en, name_ar, is_active, boundary_type, center_lat, center_lng, radius_km, travel_fee)
    VALUES ('${IDS.zone}', 'Lifecycle Zone', 'منطقة', true, 'circle', 30.05, 31.25, 25, 0)
    ON CONFLICT (id) DO UPDATE SET is_active = true;

    INSERT INTO public.zone_providers (zone_id, provider_id) VALUES
      ('${IDS.zone}', '${providerId}'), ('${IDS.zone}', '${IDS.otherProvider}')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.zone_services (zone_id, service_id) VALUES ('${IDS.zone}', '${serviceId}')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.provider_age_group_capabilities (provider_id, age_group_code) VALUES
      ('${providerId}', 'toddler'), ('${providerId}', 'preschool'), ('${providerId}', 'school_age'),
      ('${IDS.otherProvider}', 'toddler'), ('${IDS.otherProvider}', 'preschool'), ('${IDS.otherProvider}', 'school_age')
    ON CONFLICT DO NOTHING;
    UPDATE public.providers SET max_children_per_booking = 3
    WHERE id IN ('${providerId}', '${IDS.otherProvider}');

    INSERT INTO public.provider_services (provider_id, service_id, status, price_override) VALUES
      ('${providerId}', '${serviceId}', 'pending', NULL),
      ('${IDS.otherProvider}', '${serviceId}', 'pending', NULL)
    ON CONFLICT (provider_id, service_id) DO NOTHING;

    INSERT INTO public.addresses (id, user_id, label, line1, city, lat, lng, is_default) VALUES
      ('${IDS.address}', '${customerId}', 'home', 'Lifecycle test address', 'Cairo', 30.05, 31.25, true)
    ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, lat = 30.05, lng = 31.25;

    INSERT INTO public.family_members (id, customer_id, full_name, relationship, date_of_birth, is_active) VALUES
      ('${IDS.childMember}', '${customerId}', 'Test Child', 'daughter', DATE '2020-06-01', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.availability_rules (provider_id, weekday, start_time, end_time)
    SELECT '${providerId}', day, '00:00'::time, '23:59'::time FROM generate_series(0, 6) AS day
    ON CONFLICT DO NOTHING;

    INSERT INTO public.availability_rules (provider_id, weekday, start_time, end_time)
    SELECT '${IDS.otherProvider}', day, '00:00'::time, '23:59'::time FROM generate_series(0, 6) AS day
    ON CONFLICT DO NOTHING;
  `);

  await asUser(db, IDS.adminUser, () =>
    db.exec(`
      UPDATE public.provider_services SET status = 'approved'
      WHERE provider_id IN ('${providerId}', '${IDS.otherProvider}') AND service_id = '${serviceId}';
    `),
  );

  await db.exec(`
    SELECT set_config('app.onboarding_status_transition', '1', true);
    UPDATE public.providers
    SET onboarding_status = 'APPROVED', is_verified = true, is_active = true
    WHERE id IN ('${providerId}', '${IDS.otherProvider}');
  `);
  }

  const slotOffsetRows = await queryRows<{ n: number }>(
    db,
    `SELECT count(*)::int AS n FROM public.bookings WHERE provider_id = $1`,
    [providerId],
  );
  const slotDays = slotOffsetRows[0]?.n ?? 0;
  const slotDate = cairoDatePlusDays(lifecycleBookingBaseDate(), slotDays);

  const created = await asUser(db, customerId, () =>
    queryRows<{ result: { booking_id: string } }>(
      db,
      `
        SELECT public.create_booking(
          $1::uuid, $2::uuid, $3::uuid,
          ($5::date + $6::time) AT TIME ZONE 'Africa/Cairo',
          ($5::date + $7::time) AT TIME ZONE 'Africa/Cairo',
          gen_random_uuid(),
          $4::uuid,
          NULL, NULL, '[]'::jsonb, NULL, NULL, NULL, NULL,
          'adult_present'
        ) AS result
      `,
      [
        providerId,
        serviceId,
        IDS.address,
        IDS.childMember,
        slotDate,
        LIFECYCLE_SLOT_START,
        LIFECYCLE_SLOT_END,
      ],
    ),
  );
  const bookingId = created[0]?.result?.booking_id as string | undefined;

  if (bookingId) {
    await asServiceRole(db, () =>
      db.exec(`
        UPDATE public.bookings
        SET start_at = now() - interval '45 minutes',
            end_at = now() + interval '75 minutes'
            ${status === "pending" ? "" : `, status = '${status}'::public.booking_status`}
        WHERE id = '${bookingId}';
      `),
    );
  }

  const bookingRows = bookingId ? [{ id: bookingId }] : [];
  if (!bookingId) throw new Error("failed to seed booking");
  return { bookingId, serviceId };
}

export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec("BEGIN");
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await db.query("SELECT set_config('request.jwt.claim.aal', 'aal2', true)");
    await db.exec("SET LOCAL ROLE authenticated");
    const result = await fn();
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

export async function asServiceRole<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec("BEGIN");
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', '', true)");
    await db.query("SELECT set_config('request.jwt.claim.role', 'service_role', true)");
    await db.exec("SET LOCAL ROLE service_role");
    const result = await fn();
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK");
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
): Promise<{ ok: boolean; error?: string }> {
  await db.exec("BEGIN");
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', '', true)");
    await db.exec("SET LOCAL ROLE anon");
    if (params) await db.query(sql, params);
    else await db.query(sql);
    await db.exec("COMMIT");
    return { ok: true };
  } catch (error) {
    await db.exec("ROLLBACK");
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function updateBookingStatus(
  db: PGlite,
  userId: string,
  bookingId: string,
  status: BookingStatus,
  extra?: { no_show_party?: "customer" | "provider" },
): Promise<{ ok: boolean; error?: string }> {
  const extraSql = extra?.no_show_party
    ? `, no_show_party = '${extra.no_show_party}'`
    : "";
  const result = await tryAsUser(
    db,
    userId,
    `UPDATE public.bookings SET status = $1::public.booking_status${extraSql} WHERE id = $2 RETURNING status::text AS status`,
    [status, bookingId],
  );
  if (result.ok && (!result.rows || result.rows.length === 0)) {
    return { ok: false, error: "update matched no rows" };
  }
  return result;
}

export async function bookingStatus(db: PGlite, bookingId: string): Promise<string | undefined> {
  const rows = await queryRows<{ status: string }>(
    db,
    `SELECT status::text AS status FROM public.bookings WHERE id = $1`,
    [bookingId],
  );
  return rows[0]?.status;
}

export async function cancellationReasonFor(
  db: PGlite,
  actor: "customer" | "provider",
  statuses: string[],
): Promise<string> {
  const rows = await queryRows<{ id: string }>(
    db,
    `
      SELECT id FROM public.cancellation_reasons
      WHERE is_active
        AND actor_type IN ($1, 'any')
        AND applicable_statuses && $2::text[]::public.booking_status[]
      ORDER BY display_order
      LIMIT 1
    `,
    [actor, statuses],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`no cancellation reason for ${actor} / ${statuses.join(",")}`);
  return id;
}

/** Walks the standard happy-path lifecycle through to completed. */
/** Backdate session start so completion can be requested (service role; trigger skips when auth.uid() is null). */
export async function allowCompletionForBooking(db: PGlite, bookingId: string): Promise<void> {
  await asServiceRole(db, async () => {
    const rows = await queryRows<{ duration: string }>(
      db,
      `SELECT (end_at - start_at)::text AS duration FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    const duration = rows[0]?.duration ?? "2 hours";
    await db.exec(`
      UPDATE public.bookings
      SET session_started_at = now() - interval '${duration}'
      WHERE id = '${bookingId}';
    `);
  });
}

export async function completeHappyPath(db: PGlite, bookingId: string): Promise<void> {
  const steps: Array<{ user: string; status: BookingStatus }> = [
    { user: IDS.providerUser, status: "confirmed" },
    { user: IDS.providerUser, status: "on_the_way" },
    { user: IDS.providerUser, status: "arrived" },
    { user: IDS.customer, status: "in_progress" },
    { user: IDS.providerUser, status: "completion_requested" },
    { user: IDS.customer, status: "completed" },
  ];
  for (const step of steps) {
    if (step.status === "completion_requested") {
      await allowCompletionForBooking(db, bookingId);
    }
    const result = await updateBookingStatus(db, step.user, bookingId, step.status);
    if (!result.ok) {
      throw new Error(`transition to ${step.status} failed: ${result.error}`);
    }
  }
}

export function lifecycleBookingBaseDate(now = new Date()): string {
  return stableCairoBookingBaseDate(now);
}

export function lifecycleRescheduleTargetDate(fromBookingStart: string): string {
  const rows = fromBookingStart.match(/^(\d{4}-\d{2}-\d{2})/);
  const ymd = rows?.[1];
  if (!ymd) {
    return cairoDatePlusDays(lifecycleBookingBaseDate(), 3);
  }
  return cairoDatePlusDays(ymd, 2);
}

/** Sets booking to a mid-lifecycle status for negative transition tests. */
export async function setBookingStatusAsSystem(
  db: PGlite,
  bookingId: string,
  status: BookingStatus,
): Promise<void> {
  await asServiceRole(db, () =>
    db.exec(`
      UPDATE public.bookings
      SET status = '${status}'::public.booking_status
      WHERE id = '${bookingId}';
    `),
  );
}

export async function seedPaymentsForBooking(
  db: PGlite,
  bookingId: string,
  customerId: string = IDS.customer,
): Promise<{ cashId: string; paymobId: string }> {
  const bookingRows = await queryRows<{ price_total: string }>(
    db,
    `SELECT price_total::text FROM public.bookings WHERE id = $1`,
    [bookingId],
  );
  const amount = bookingRows[0]?.price_total ?? "200";

  const methods = await queryRows<{ code: string; id: string }>(
    db,
    `SELECT code, id FROM public.payment_methods WHERE code IN ('cash_on_delivery', 'paymob')`,
  );
  const cashMethod = methods.find((m) => m.code === "cash_on_delivery")?.id;
  const paymobMethod = methods.find((m) => m.code === "paymob")?.id;
  if (!cashMethod || !paymobMethod) {
    throw new Error("expected payment_methods cash_on_delivery and paymob after migration replay");
  }

  await asServiceRole(db, () =>
    db.exec(`
      UPDATE public.payment_methods SET is_active = true
      WHERE code IN ('cash_on_delivery', 'paymob');
    `),
  );

  await asServiceRole(db, async () => {
    await db.query(
      `
        INSERT INTO public.payments (
          id, booking_id, customer_id, amount, status, payment_method_id, metadata
        ) VALUES
          ($1::uuid, $2::uuid, $3::uuid, $7::numeric, 'pending', $4::uuid, '{}'::jsonb),
          ($5::uuid, $2::uuid, $3::uuid, $7::numeric, 'pending', $6::uuid, jsonb_build_object('paymob_order_id', '999001'))
        ON CONFLICT (id) DO UPDATE SET
          booking_id = EXCLUDED.booking_id,
          status = 'pending',
          payment_method_id = EXCLUDED.payment_method_id
      `,
      [PAYMENT_CASH_ID, bookingId, customerId, cashMethod, PAYMENT_PAYMOB_ID, paymobMethod, amount],
    );
  });
  return { cashId: PAYMENT_CASH_ID, paymobId: PAYMENT_PAYMOB_ID };
}

export async function paymentStatus(db: PGlite, paymentId: string): Promise<string | undefined> {
  const rows = await queryRows<{ status: string }>(
    db,
    `SELECT status::text AS status FROM public.payments WHERE id = $1`,
    [paymentId],
  );
  return rows[0]?.status;
}

export async function assertTransitionRejected(
  db: PGlite,
  userId: string,
  bookingId: string,
  toStatus: BookingStatus,
  pattern: RegExp,
  label: string,
): Promise<void> {
  const before = await bookingStatus(db, bookingId);
  expectRejected(await updateBookingStatus(db, userId, bookingId, toStatus), pattern, label);
  const after = await bookingStatus(db, bookingId);
  if (after !== before) {
    throw new Error(`${label}: expected status ${before}, got ${after}`);
  }
}

export function expectRejected(
  result: { ok: boolean; error?: string },
  pattern: RegExp,
  label: string,
): void {
  if (result.ok) {
    throw new Error(`${label} should be rejected but succeeded`);
  }
  if (!pattern.test(result.error ?? "")) {
    throw new Error(`${label}: expected error matching ${pattern}, got: ${result.error}`);
  }
}
