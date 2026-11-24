import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const PROVIDER_USER = "22222222-2222-4222-8222-222222222222";
const PROVIDER_ID = "33333333-3333-4333-8333-333333333333";
const SERVICE_ID = "44444444-4444-4444-8444-444444444444";
const CATEGORY_ID = "55555555-5555-4555-8555-555555555555";
const PS_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const priceChangeMigration = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/20261104120000_provider_price_change_review.sql",
    import.meta.url,
  ),
);
const onlineMigration = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/20261124130000_provider_online_lesson_settings.sql",
    import.meta.url,
  ),
);

async function readyDatabase() {
  const db = new PGlite();
  await db.exec(
    [
      "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;",
      "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;",
      "CREATE FUNCTION public.has_role(p_uid uuid, p_role text) RETURNS boolean LANGUAGE sql STABLE AS $$",
      "  SELECT (p_role = 'admin' AND p_uid = '11111111-1111-4111-8111-111111111111'::uuid)",
      "      OR (p_role = 'provider' AND p_uid = '22222222-2222-4222-8222-222222222222'::uuid)",
      " $$;",
      "CREATE TABLE public.providers (id uuid PRIMARY KEY, profile_id uuid NOT NULL, onboarding_status text NOT NULL, resubmitted_at timestamptz, is_verified boolean NOT NULL DEFAULT false);",
      "CREATE TABLE public.categories (id uuid PRIMARY KEY, online_allowed boolean NOT NULL DEFAULT true, slug text);",
      "CREATE TABLE public.provider_teaching_capabilities (id uuid PRIMARY KEY, provider_id uuid NOT NULL, service_id uuid NOT NULL, subject_id uuid NOT NULL, curriculum_id uuid NOT NULL, level_id uuid NOT NULL, session_duration_min int NOT NULL, session_price integer NOT NULL, status text NOT NULL);",
      "CREATE TABLE public.provider_documents (id uuid PRIMARY KEY, provider_id uuid NOT NULL, status text NOT NULL);",
      "CREATE TABLE public.disputes (id uuid PRIMARY KEY, status text NOT NULL);",
      "CREATE TABLE public.support_tickets (id uuid PRIMARY KEY, status text NOT NULL);",
      "CREATE TABLE public.bookings (id uuid PRIMARY KEY, status text NOT NULL);",
      "CREATE TABLE public.payments (id uuid PRIMARY KEY, status text NOT NULL);",
      "CREATE TABLE public.services (id uuid PRIMARY KEY, name_en text, name_ar text, is_active boolean NOT NULL DEFAULT true, provider_pricing_allowed boolean NOT NULL DEFAULT true, minimum_price numeric, maximum_price numeric, category_id uuid, online_allowed boolean NOT NULL DEFAULT false);",
      "CREATE TABLE public.provider_services (",
      "  id uuid PRIMARY KEY, provider_id uuid NOT NULL, service_id uuid NOT NULL, status text NOT NULL,",
      "  price_override numeric, pending_price_override numeric, price_change_requested_at timestamptz, price_change_reason text,",
      "  online_price_override numeric, pending_online_price_override numeric, online_price_change_requested_at timestamptz, online_price_change_reason text",
      ");",
      "CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, type text, category text, title text, body text, title_en text, title_ar text, body_en text, body_ar text, payload jsonb, deep_link text);",
      "CREATE FUNCTION public.admin_provider_identity_ids() RETURNS TABLE(provider_id uuid) LANGUAGE sql STABLE AS $$ SELECT id FROM public.providers $$;",
      `INSERT INTO public.categories VALUES ('${CATEGORY_ID}', true, 'cleaning');`,
      `INSERT INTO public.providers VALUES ('${PROVIDER_ID}', '${PROVIDER_USER}', 'APPROVED', NULL, false);`,
      `INSERT INTO public.services VALUES ('${SERVICE_ID}', 'Cleaning', 'تنظيف', true, true, 100, 1000, '${CATEGORY_ID}', true);`,
      `INSERT INTO public.provider_services VALUES ('${PS_ID}', '${PROVIDER_ID}', '${SERVICE_ID}', 'approved', 300, NULL, NULL, NULL, 280, NULL, NULL, NULL);`,
    ].join("\n"),
  );
  await db.exec(readFileSync(priceChangeMigration, "utf8"));
  await db.exec(readFileSync(onlineMigration, "utf8"));
  return db;
}

describe("admin_review_online_price_change migration", () => {
  let db: PGlite | undefined;
  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("approves and rejects online price change requests", async () => {
    db = await readyDatabase();
    await db.query(`SELECT set_config('request.jwt.claim.sub', '${PROVIDER_USER}', false);`);
    await db.query(`SELECT public.provider_request_online_price_change('${SERVICE_ID}', 320)`);
    let row = (
      await db.query<{
        online_price_override: number;
        pending_online_price_override: number | null;
      }>(`SELECT online_price_override, pending_online_price_override FROM public.provider_services`)
    ).rows[0];
    expect(Number(row.online_price_override)).toBe(280);
    expect(Number(row.pending_online_price_override)).toBe(320);

    await db.query(`SELECT set_config('request.jwt.claim.sub', '${ADMIN}', false);`);
    await db.query(`SELECT public.admin_review_online_price_change('${PS_ID}', 'approved', NULL)`);
    row = (
      await db.query<{
        online_price_override: number;
        pending_online_price_override: number | null;
      }>(`SELECT online_price_override, pending_online_price_override FROM public.provider_services`)
    ).rows[0];
    expect(Number(row.online_price_override)).toBe(320);
    expect(row.pending_online_price_override).toBeNull();

    await db.query(`SELECT set_config('request.jwt.claim.sub', '${PROVIDER_USER}', false);`);
    await db.query(`SELECT public.provider_request_online_price_change('${SERVICE_ID}', 340)`);
    await db.query(`SELECT set_config('request.jwt.claim.sub', '${ADMIN}', false);`);
    await db.query(
      `SELECT public.admin_review_online_price_change('${PS_ID}', 'rejected', 'Too high for now')`,
    );
    const rejected = (
      await db.query<{
        online_price_override: number;
        online_price_change_reason: string | null;
      }>(`SELECT online_price_override, online_price_change_reason FROM public.provider_services`)
    ).rows[0];
    expect(Number(rejected.online_price_override)).toBe(320);
    expect(rejected.online_price_change_reason).toBe("Too high for now");
  });
});