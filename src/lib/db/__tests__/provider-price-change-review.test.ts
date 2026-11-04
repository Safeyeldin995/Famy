import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const PROVIDER_USER = "22222222-2222-4222-8222-222222222222";
const PROVIDER_ID = "33333333-3333-4333-8333-333333333333";
const SERVICE_ID = "44444444-4444-4444-8444-444444444444";
const PS_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const migrationPath = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/20261104120000_provider_price_change_review.sql",
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
      "CREATE TABLE public.providers (id uuid PRIMARY KEY, profile_id uuid NOT NULL, onboarding_status text NOT NULL, resubmitted_at timestamptz);",
      "CREATE TABLE public.provider_teaching_capabilities (id uuid PRIMARY KEY, provider_id uuid NOT NULL, service_id uuid NOT NULL, subject_id uuid NOT NULL, curriculum_id uuid NOT NULL, level_id uuid NOT NULL, session_duration_min int NOT NULL, session_price integer NOT NULL, status text NOT NULL);",
      "CREATE TABLE public.provider_documents (id uuid PRIMARY KEY, provider_id uuid NOT NULL, status text NOT NULL);",
      "CREATE TABLE public.disputes (id uuid PRIMARY KEY, status text NOT NULL);",
      "CREATE TABLE public.support_tickets (id uuid PRIMARY KEY, status text NOT NULL);",
      "CREATE TABLE public.bookings (id uuid PRIMARY KEY, status text NOT NULL);",
      "CREATE TABLE public.payments (id uuid PRIMARY KEY, status text NOT NULL);",
      "CREATE TABLE public.services (id uuid PRIMARY KEY, name_en text, name_ar text, is_active boolean NOT NULL DEFAULT true, provider_pricing_allowed boolean NOT NULL DEFAULT true, minimum_price numeric, maximum_price numeric);",
      "CREATE TABLE public.provider_services (",
      "  id uuid PRIMARY KEY, provider_id uuid NOT NULL, service_id uuid NOT NULL, status text NOT NULL,",
      "  price_override numeric, pending_price_override numeric, price_change_requested_at timestamptz, price_change_reason text",
      ");",
      "CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, type text, category text, title text, body text, title_en text, title_ar text, body_en text, body_ar text, payload jsonb, deep_link text);",
      "CREATE FUNCTION public.admin_provider_identity_ids() RETURNS TABLE(provider_id uuid) LANGUAGE sql STABLE AS $$ SELECT id FROM public.providers $$;",
      "CREATE OR REPLACE FUNCTION public.tg_validate_provider_price() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;",
      "CREATE TRIGGER trg_validate_provider_price BEFORE INSERT OR UPDATE OF price_override ON public.provider_services FOR EACH ROW EXECUTE FUNCTION public.tg_validate_provider_price();",
      `INSERT INTO public.providers VALUES ('${PROVIDER_ID}', '${PROVIDER_USER}', 'APPROVED');`,
      `INSERT INTO public.services VALUES ('${SERVICE_ID}', 'Cleaning', 'تنظيف', true, true, 100, 1000);`,
      `INSERT INTO public.provider_services VALUES ('${PS_ID}', '${PROVIDER_ID}', '${SERVICE_ID}', 'approved', 300, NULL, NULL, NULL);`,
    ].join("\n"),
  );
  await db.exec(readFileSync(migrationPath, "utf8"));
  return db;
}

describe("provider price change review migration", () => {
  let db: PGlite | undefined;
  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("blocks direct price_override updates for approved providers", async () => {
    db = await readyDatabase();
    await db.query(`SELECT set_config('request.jwt.claim.sub', '${PROVIDER_USER}', false);`);
    await expect(
      db.query(
        `UPDATE public.provider_services SET price_override = 350 WHERE id = '${PS_ID}'`,
      ),
    ).rejects.toThrow(/provider_request_price_change/);
  });

  it("requests, approves, rejects, and cancels price changes", async () => {
    db = await readyDatabase();
    await db.query(`SELECT set_config('request.jwt.claim.sub', '${PROVIDER_USER}', false);`);
    await db.query(`SELECT public.provider_request_price_change('${SERVICE_ID}', 350)`);
    let row = (
      await db.query<{
        price_override: number;
        pending_price_override: number | null;
      }>(`SELECT price_override, pending_price_override FROM public.provider_services`)
    ).rows[0];
    expect(Number(row.price_override)).toBe(300);
    expect(Number(row.pending_price_override)).toBe(350);

    await db.query(`SELECT public.provider_request_price_change('${SERVICE_ID}', 350)`);
    await db.query(`SELECT public.provider_cancel_price_change('${SERVICE_ID}')`);
    row = (
      await db.query<{
        price_override: number;
        pending_price_override: number | null;
      }>(`SELECT price_override, pending_price_override FROM public.provider_services`)
    ).rows[0];
    expect(row.pending_price_override).toBeNull();

    await db.query(`SELECT public.provider_request_price_change('${SERVICE_ID}', 400)`);
    await db.query(`SELECT set_config('request.jwt.claim.sub', '${ADMIN}', false);`);
    await db.query(
      `SELECT public.admin_review_price_change('${PS_ID}', 'approved', NULL)`,
    );
    row = (
      await db.query<{ price_override: number; pending_price_override: number | null }>(
        `SELECT price_override, pending_price_override FROM public.provider_services`,
      )
    ).rows[0];
    expect(Number(row.price_override)).toBe(400);
    expect(row.pending_price_override).toBeNull();

    await db.query(`SELECT set_config('request.jwt.claim.sub', '${PROVIDER_USER}', false);`);
    await db.query(`SELECT public.provider_request_price_change('${SERVICE_ID}', 450)`);
    await db.query(`SELECT set_config('request.jwt.claim.sub', '${ADMIN}', false);`);
    await db.query(
      `SELECT public.admin_review_price_change('${PS_ID}', 'rejected', 'Too high for now')`,
    );
    const rejected = (
      await db.query<{ price_override: number; price_change_reason: string | null }>(
        `SELECT price_override, price_change_reason FROM public.provider_services`,
      )
    ).rows[0];
    expect(Number(rejected.price_override)).toBe(400);
    expect(rejected.price_change_reason).toBe("Too high for now");
  });

  it("counts price_change_requests in admin work queue", async () => {
    db = await readyDatabase();
    await db.query(`SELECT set_config('request.jwt.claim.sub', '${PROVIDER_USER}', false);`);
    await db.query(`SELECT public.provider_request_price_change('${SERVICE_ID}', 360)`);
    await db.query(`SELECT set_config('request.jwt.claim.sub', '${ADMIN}', false);`);
    const counts = Object.fromEntries(
      (
        await db.query<{ queue: string; item_count: number }>(
          "SELECT * FROM public.admin_work_queue_counts()",
        )
      ).rows.map((r) => [r.queue, Number(r.item_count)]),
    );
    expect(counts.price_change_requests).toBe(1);
    expect(Object.keys(counts)).toHaveLength(10);
  });
});
