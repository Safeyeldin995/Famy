import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createDisposableDb, queryRows, readMigration } from "./monitoring-privilege-harness";

const ORIGINAL = "20260929082421_marketplace_babysitting_bookability.sql";
const MIGRATION = "20261004130000_tutoring_eligibility_price.sql";
const PROVIDER = "00000000-0000-0000-0000-000000000001";
const OTHER_PROVIDER = "00000000-0000-0000-0000-000000000002";
const TUTORING = "00000000-0000-0000-0000-000000000003";
const CLEANING = "00000000-0000-0000-0000-000000000004";
const PRICE_REASON = "No approved teaching subject with a valid session price";

// Minimal schema for executing the tracked SQL function, not a replacement for it.
const SCHEMA = `
CREATE TABLE public.providers (
  id uuid PRIMARY KEY, profile_id uuid, hourly_rate numeric,
  is_active boolean DEFAULT true, deleted_at timestamptz,
  vacation_mode boolean DEFAULT false, onboarding_status text DEFAULT 'APPROVED',
  is_verified boolean DEFAULT true, max_children_per_booking int
);
CREATE TABLE public.categories (id uuid PRIMARY KEY, slug text);
CREATE TABLE public.services (
  id uuid PRIMARY KEY, category_id uuid, name_en text, name_ar text,
  is_active boolean DEFAULT true, minimum_price numeric, maximum_price numeric
);
CREATE TABLE public.provider_services (provider_id uuid, service_id uuid, status text, price_override numeric);
CREATE TABLE public.provider_teaching_capabilities (provider_id uuid, service_id uuid, status text, session_price int);
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE TABLE public.service_requirements (id uuid, service_id uuid, is_active boolean, required_for_provider_approval boolean, evidence_required boolean);
CREATE TABLE public.provider_requirement_fulfillments (provider_id uuid, requirement_id uuid, status text, evidence_storage_path text);
CREATE TABLE public.zones (id uuid, is_active boolean, boundary_type text, polygon jsonb, center_lat float8, center_lng float8, radius_km float8);
CREATE TABLE public.zone_services (zone_id uuid, service_id uuid);
CREATE TABLE public.zone_providers (zone_id uuid, provider_id uuid);
CREATE TABLE public.addresses (id uuid, lat float8, lng float8);
CREATE TABLE public.availability_rules (provider_id uuid, start_time time, end_time time);
CREATE TABLE public.provider_incidents (provider_id uuid, status text, severity text);
CREATE TABLE public.provider_age_group_capabilities (provider_id uuid);
CREATE FUNCTION public.point_in_polygon(float8, float8, jsonb) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;

INSERT INTO public.providers (id, profile_id, hourly_rate) VALUES ('${PROVIDER}', '${PROVIDER}', 1);
INSERT INTO public.user_roles VALUES ('${PROVIDER}', 'provider');
INSERT INTO public.categories VALUES ('${TUTORING}', 'tutoring'), ('${CLEANING}', 'home-cleaning');
INSERT INTO public.services (id, category_id, name_en, name_ar, minimum_price, maximum_price)
VALUES ('${TUTORING}', '${TUTORING}', 'Tutoring', 'تدريس', 300, 1500),
       ('${CLEANING}', '${CLEANING}', 'Cleaning', 'تنظيف', 300, 1500);
INSERT INTO public.provider_services VALUES ('${PROVIDER}', '${TUTORING}', 'approved', 999), ('${PROVIDER}', '${CLEANING}', 'approved', 700);
INSERT INTO public.zones (id, is_active) VALUES ('${PROVIDER}', true);
INSERT INTO public.zone_services VALUES ('${PROVIDER}', '${TUTORING}'), ('${PROVIDER}', '${CLEANING}');
INSERT INTO public.zone_providers VALUES ('${PROVIDER}', '${PROVIDER}');
INSERT INTO public.availability_rules VALUES ('${PROVIDER}', '08:00', '20:00');
`;

type Eligibility = {
  price_valid: boolean;
  effective_price: string | number | null;
  is_eligible: boolean;
  failure_reasons: string[];
};

describe("tutoring eligibility session price", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await createDisposableDb();
    await db.exec(SCHEMA);
    await db.exec(readMigration(MIGRATION));
  });
  afterEach(async () => {
    await db?.close();
  });

  async function eligibility(serviceId = TUTORING) {
    const rows = await queryRows<Eligibility>(
      db,
      `SELECT * FROM public.marketplace_eligibility_internal($1, $2, NULL)`,
      [PROVIDER, serviceId],
    );
    return rows[0]!;
  }
  async function capability(
    status: string,
    price: number,
    providerId = PROVIDER,
    serviceId = TUTORING,
  ) {
    await db.query(`INSERT INTO public.provider_teaching_capabilities VALUES ($1, $2, $3, $4)`, [
      providerId,
      serviceId,
      status,
      price,
    ]);
  }

  it("uses the lowest approved in-range price with hourly_rate = 1 and ignores the override", async () => {
    await capability("approved", 600);
    await capability("approved", 500);
    await capability("pending", 350);
    await capability("approved", 2000);
    await capability("approved", 300, OTHER_PROVIDER);
    await capability("approved", 300, PROVIDER, CLEANING);
    const row = await eligibility();
    expect(row.price_valid).toBe(true);
    expect(Number(row.effective_price)).toBe(500);
    expect(row.is_eligible).toBe(true);
    expect(row.failure_reasons).toEqual([]);
    await capability("approved", 300);
    expect(Number((await eligibility()).effective_price)).toBe(300);
  });

  it.each(["pending", "rejected", "below minimum", "above maximum", "absent"])(
    "fails closed with %s capabilities and returns the tutoring-specific reason",
    async (kind) => {
      if (kind !== "absent")
        await capability(
          kind === "pending" || kind === "rejected" ? kind : "approved",
          kind === "below minimum" ? 299 : kind === "above maximum" ? 1501 : 500,
        );
      const row = await eligibility();
      expect(row.price_valid).toBe(false);
      expect(row.effective_price).toBeNull();
      expect(row.is_eligible).toBe(false);
      expect(row.failure_reasons).toContain(PRICE_REASON);
      expect(row.failure_reasons).not.toContain(
        "Provider price is missing or outside Admin limits",
      );
    },
  );

  it("accepts the inclusive maximum and preserves the other eligibility gates", async () => {
    await capability("approved", 1500);
    expect((await eligibility()).price_valid).toBe(true);
    await db.exec(`DELETE FROM public.availability_rules; DELETE FROM public.zone_services;`);
    const row = await eligibility();
    expect(row.price_valid).toBe(true);
    expect(row.is_eligible).toBe(false);
    expect(row.failure_reasons).toContain("Provider has no valid availability");
    expect(row.failure_reasons).toContain("Active Provider and Service zone coverage is missing");
  });

  it("keeps non-tutoring results identical to the previous function across pricing cases", async () => {
    const cases = [
      [700, 1],
      [null, 800],
      [null, 1],
      [2000, 800],
      [300, 1],
      [1500, 1],
    ];
    const before: Eligibility[] = [];
    await db.exec(readMigration(ORIGINAL));
    for (const [override, hourly] of cases) {
      await db.query(
        `UPDATE public.provider_services SET price_override = $1 WHERE service_id = $2`,
        [override, CLEANING],
      );
      await db.query(`UPDATE public.providers SET hourly_rate = $1`, [hourly]);
      before.push(await eligibility(CLEANING));
    }
    await db.exec(readMigration(MIGRATION));
    await capability("approved", 500, PROVIDER, CLEANING);
    for (const [index, [override, hourly]] of cases.entries()) {
      await db.query(
        `UPDATE public.provider_services SET price_override = $1 WHERE service_id = $2`,
        [override, CLEANING],
      );
      await db.query(`UPDATE public.providers SET hourly_rate = $1`, [hourly]);
      expect(await eligibility(CLEANING)).toEqual(before[index]);
    }
  });
});
