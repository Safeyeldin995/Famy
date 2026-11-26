import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  IDS,
  asServiceRole,
  asUser,
  createBookingLifecycleDb,
  queryRows,
  seedLifecycleBooking,
  LIFECYCLE_SLOT_END,
  LIFECYCLE_SLOT_START,
  lifecycleBookingBaseDate,
  tryAsUser,
} from "./booking-lifecycle.harness";
import { cairoDatePlusDays } from "./cairo-stable-booking-date";

// Online lessons for children under 12 booked by their parent (PO decision 26 Nov 2026).
const TEEN_MEMBER_ID = "00000000-0000-0000-0000-000000000612";
const OTHER_CUSTOMER_CHILD_ID = "00000000-0000-0000-0000-000000000613";

async function prepareOnlineTutoring(
  db: PGlite,
  startAt: string,
  endAt: string,
  providerId: string = IDS.provider,
): Promise<{ capabilityId: string; serviceId: string; tax: { subject_code: string; curriculum_code: string; level_code: string } }> {
  const serviceRows = await queryRows<{ id: string }>(
    db,
    `SELECT id FROM public.services WHERE slug = 'school-subject-tutoring' LIMIT 1`,
  );
  const serviceId = serviceRows[0]?.id;
  if (!serviceId) throw new Error("school-subject-tutoring service missing");

  const taxonomy = await queryRows<{
    subject_id: string;
    curriculum_id: string;
    level_id: string;
    subject_code: string;
    curriculum_code: string;
    level_code: string;
  }>(
    db,
    `SELECT ts.id AS subject_id, tc.id AS curriculum_id, tl.id AS level_id,
            ts.code AS subject_code, tc.code AS curriculum_code, tl.code AS level_code
     FROM public.teaching_subjects ts
     JOIN public.teaching_subject_services tss
       ON tss.subject_id = ts.id AND tss.service_id = $1
     CROSS JOIN public.teaching_curricula tc
     CROSS JOIN public.teaching_levels tl
     LIMIT 1`,
    [serviceId],
  );
  const tax = taxonomy[0];
  if (!tax) throw new Error("tutoring taxonomy missing");

  await asServiceRole(db, async () => {
    await db.query(
      `INSERT INTO public.family_members (
         id, customer_id, full_name, relationship, date_of_birth, is_active
       ) VALUES ($1, $2, 'Teen Learner', 'son', DATE '2010-06-01', true)
       ON CONFLICT (id) DO UPDATE SET date_of_birth = EXCLUDED.date_of_birth`,
      [TEEN_MEMBER_ID, IDS.customer],
    );
    await db.query(
      `UPDATE public.providers
       SET offering_mode = 'both', is_verified = true
       WHERE id = $1`,
      [providerId],
    );
    await db.query(
      `INSERT INTO public.provider_teaching_capabilities (
         provider_id, service_id, subject_id, curriculum_id, level_id,
         session_duration_min, session_price, status
       ) VALUES ($1, $2, $3, $4, $5, 120, 400, 'approved')
       ON CONFLICT (provider_id, service_id, subject_id, curriculum_id, level_id)
       DO UPDATE SET status = 'approved'`,
      [providerId, serviceId, tax.subject_id, tax.curriculum_id, tax.level_id],
    );
    await db.query(`SELECT set_config('app.provider_service_request', '1', true)`);
    await db.query(
      `INSERT INTO public.provider_services (provider_id, service_id, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (provider_id, service_id) DO NOTHING`,
      [providerId, serviceId],
    );
  });

  const psRows = await queryRows<{ id: string; status: string }>(
    db,
    `SELECT id, status FROM public.provider_services
     WHERE provider_id = $1 AND service_id = $2 LIMIT 1`,
    [providerId, serviceId],
  );
  const psId = psRows[0]?.id;
  if (!psId) throw new Error("provider service row missing");
  if (psRows[0]?.status !== "approved") {
    await asUser(db, IDS.adminUser, () =>
      db.query(`SELECT public.admin_set_provider_service_status($1, 'approved', NULL)`, [psId]),
    );
  }

  const capRows = await queryRows<{ id: string }>(
    db,
    `SELECT id FROM public.provider_teaching_capabilities
     WHERE provider_id = $1 AND service_id = $2 AND status = 'approved'
     LIMIT 1`,
    [providerId, serviceId],
  );
  const capabilityId = capRows[0]?.id;
  if (!capabilityId) throw new Error("teaching capability missing");

  return { capabilityId, serviceId, tax };
}

let db: PGlite;
let setup: Awaited<ReturnType<typeof prepareOnlineTutoring>>;
let dayOffset = 40;

function nextSlot() {
  dayOffset += 1;
  const slotDate = cairoDatePlusDays(lifecycleBookingBaseDate(), dayOffset);
  return {
    startAt: `${slotDate}T${LIFECYCLE_SLOT_START}:00+02:00`,
    endAt: `${slotDate}T${LIFECYCLE_SLOT_END}:00+02:00`,
  };
}

async function bookOnline(
  userId: string,
  familyMemberId: string | null,
  supervisionMode: string | null,
) {
  const { startAt, endAt } = nextSlot();
  return tryAsUser(
    db,
    userId,
    `SELECT public.create_booking(
       $1::uuid, $2::uuid, NULL,
       $3::timestamptz, $4::timestamptz, $5::uuid,
       $6::uuid, NULL, NULL, '[]'::jsonb,
       $7::uuid, $8, $9, $10, $11, 'online'
     ) AS result`,
    [
      IDS.provider,
      setup.serviceId,
      startAt,
      endAt,
      randomUUID(),
      familyMemberId,
      setup.capabilityId,
      setup.tax.subject_code,
      setup.tax.curriculum_code,
      setup.tax.level_code,
      supervisionMode,
    ],
  );
}

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  await seedLifecycleBooking(db, { status: "pending" });
  const { startAt, endAt } = nextSlot();
  setup = await prepareOnlineTutoring(db, startAt, endAt);
}, 120_000);

afterAll(async () => db?.close());

describe("online lessons: children under 12 booked by a parent", () => {
  it("books a child under 12 when the parent confirms supervision, and stores it", async () => {
    // IDS.childMember was born in 2020 (under 12) and belongs to IDS.customer.
    const res = await bookOnline(IDS.customer, IDS.childMember, "parent_online");
    expect(res.error).toBeUndefined();
    const bookingId = (res.rows?.[0]?.result as { booking_id?: string })?.booking_id;
    expect(bookingId).toBeTruthy();
    const rows = await asServiceRole(db, () =>
      queryRows<{ supervision_mode: string | null; family_member_id: string | null }>(
        db,
        `SELECT supervision_mode, family_member_id FROM public.bookings WHERE id = $1`,
        [bookingId],
      ),
    );
    expect(rows[0]?.supervision_mode).toBe("parent_online");
    expect(rows[0]?.family_member_id).toBe(IDS.childMember);
  });

  it("refuses a child under 12 without the parent's confirmation", async () => {
    const res = await bookOnline(IDS.customer, IDS.childMember, null);
    expect(res.error).toMatch(/BOOKING_PARENT_SUPERVISION_REQUIRED/);
    const wrong = await bookOnline(IDS.customer, IDS.childMember, "cameras");
    expect(wrong.error).toMatch(/BOOKING_PARENT_SUPERVISION_REQUIRED/);
  });

  it("keeps the 12+ rule for a student booking for themselves", async () => {
    await asServiceRole(db, () =>
      db.query(`UPDATE public.profiles SET date_of_birth = DATE '2018-01-01' WHERE id = $1`, [
        IDS.customer,
      ]),
    );
    const res = await bookOnline(IDS.customer, null, "parent_online");
    expect(res.error).toMatch(/BOOKING_ONLINE_AGE_MINIMUM/);
  });

  it("refuses another user's child", async () => {
    await asServiceRole(db, () =>
      db.query(
        `INSERT INTO public.family_members (id, customer_id, full_name, relationship, date_of_birth, is_active)
         VALUES ($1, $2, 'Not Yours', 'son', DATE '2019-03-01', true)
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_CUSTOMER_CHILD_ID, IDS.otherProviderUser],
      ),
    );
    const res = await bookOnline(IDS.customer, OTHER_CUSTOMER_CHILD_ID, "parent_online");
    expect(res.error).toBeDefined();
    expect(res.error).not.toMatch(/BOOKING_PARENT_SUPERVISION_REQUIRED/);
  });

  it("never stores the online parent value on an in-person booking", async () => {
    const service = await queryRows<{ id: string }>(
      db,
      "SELECT id FROM public.services WHERE slug = 'hourly-babysitting' LIMIT 1",
    );
    const { startAt, endAt } = nextSlot();
    const res = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.create_booking(
         $1::uuid, $2::uuid, NULL, $3::timestamptz, $4::timestamptz, $5::uuid,
         $6::uuid, NULL, NULL, '[]'::jsonb, NULL, NULL, NULL, NULL, 'parent_online', 'in_person'
       )`,
      [IDS.provider, service[0]!.id, startAt, endAt, randomUUID(), IDS.childMember],
    );
    expect(res.error).toMatch(/BOOKING_SUPERVISION_REQUIRED/);
  });
});
