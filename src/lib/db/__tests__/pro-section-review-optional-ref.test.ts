import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const PROVIDER = "33333333-3333-4333-8333-333333333333";
const PROFILE = "22222222-2222-4222-8222-222222222222";

const workQueueMigration = readFileSync(
  fileURLToPath(
    new URL("../../../../supabase/migrations/20261013130000_admin_work_queue_and_approve_all.sql", import.meta.url),
  ),
  "utf8",
);
const sectionFixMigration = readFileSync(
  fileURLToPath(
    new URL("../../../../supabase/migrations/20261022130000_pro_section_review_needs_changes.sql", import.meta.url),
  ),
  "utf8",
);

async function readyDatabase() {
  const db = new PGlite();
  await db.query("SELECT set_config('request.jwt.claim.aal', 'aal2', false)");
  await db.exec(
    [
      "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;",
      "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;",
      "CREATE FUNCTION public.has_role(p_uid uuid, p_role text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT p_role = 'admin' AND p_uid = '11111111-1111-4111-8111-111111111111'::uuid $$;",
      "CREATE TABLE public.providers (id uuid PRIMARY KEY, profile_id uuid NOT NULL, onboarding_status text NOT NULL, resubmitted_at timestamptz);",
      "CREATE TABLE public.provider_references (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_id uuid NOT NULL, full_name text NOT NULL, relationship text NOT NULL, phone text NOT NULL, notes text, sort_order int NOT NULL DEFAULT 0);",
      "CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, channel text NOT NULL DEFAULT 'in_app', type text NOT NULL, category text NOT NULL DEFAULT 'system', title text NOT NULL, body text, title_en text, title_ar text, body_en text, body_ar text, payload jsonb NOT NULL DEFAULT '{}'::jsonb, deep_link text, created_at timestamptz NOT NULL DEFAULT now());",
      "CREATE TABLE public.provider_services (id uuid PRIMARY KEY, provider_id uuid NOT NULL, service_id uuid NOT NULL, status text NOT NULL);",
      "CREATE TABLE public.provider_teaching_capabilities (id uuid PRIMARY KEY, provider_id uuid NOT NULL, service_id uuid NOT NULL, subject_id uuid NOT NULL, curriculum_id uuid NOT NULL, level_id uuid NOT NULL, session_duration_min int NOT NULL, session_price integer NOT NULL, status text NOT NULL);",
      "CREATE TABLE public.provider_documents (id uuid PRIMARY KEY, provider_id uuid NOT NULL, status text NOT NULL);",
      "CREATE TABLE public.disputes (id uuid PRIMARY KEY, status text NOT NULL);",
      "CREATE TABLE public.support_tickets (id uuid PRIMARY KEY, status text NOT NULL);",
      "CREATE TABLE public.bookings (id uuid PRIMARY KEY, status text NOT NULL);",
      "CREATE TABLE public.payments (id uuid PRIMARY KEY, status text NOT NULL);",
      "CREATE FUNCTION public.admin_provider_identity_ids() RETURNS TABLE(provider_id uuid) LANGUAGE sql STABLE AS $$ SELECT id FROM public.providers $$;",
      "CREATE FUNCTION public.admin_set_provider_service_status(p_id uuid, p_status text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN UPDATE public.provider_services SET status = p_status WHERE id = p_id; END; $$;",
      "CREATE FUNCTION public.admin_review_teaching_group(p_ids uuid[], p_status text, p_note text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN UPDATE public.provider_teaching_capabilities SET status = p_status WHERE id = ANY(p_ids); END; $$;",
      `CREATE FUNCTION public.admin_provider_onboarding_action(p_id uuid, p_action text, p_reason_code text, p_reason_public text, p_internal text)
       RETURNS void LANGUAGE plpgsql AS $$
       BEGIN
         IF p_action = 'request_changes' THEN
           UPDATE public.providers SET onboarding_status = 'NEEDS_CHANGES' WHERE id = p_id;
           RETURN;
         END IF;
         IF p_action = 'approve' THEN
           UPDATE public.providers SET onboarding_status = 'APPROVED' WHERE id = p_id;
           RETURN;
         END IF;
       END; $$;`,
    ].join("\n"),
  );
  await db.exec(workQueueMigration);
  await db.exec(sectionFixMigration);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [ADMIN]);
  await db.query(
    "INSERT INTO public.providers (id, profile_id, onboarding_status) VALUES ($1, $2, 'UNDER_REVIEW')",
    [PROVIDER, PROFILE],
  );
  await db.query(
    `INSERT INTO public.provider_references (provider_id, full_name, relationship, phone, sort_order)
     VALUES ($1, 'First Ref', 'former_client', '+201011122233', 0),
            ($1, 'Second Ref', 'neighbor', '+201022233344', 1)`,
    [PROVIDER],
  );
  return db;
}

describe("admin_review_provider_section optional reference", () => {
  let db: PGlite | undefined;
  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("moves the application to NEEDS_CHANGES when a required section is rejected", async () => {
    db = await readyDatabase();
    await db.query(
      "SELECT public.admin_review_provider_section($1, 'references', 'rejected', 'Required reference invalid')",
      [PROVIDER],
    );
    expect(
      (await db.query<{ onboarding_status: string }>("SELECT onboarding_status FROM public.providers")).rows[0]
        .onboarding_status,
    ).toBe("NEEDS_CHANGES");
    const note = await db.query<{ body_ar: string }>(
      "SELECT body_ar FROM public.notifications ORDER BY created_at DESC LIMIT 1",
    );
    expect(note.rows[0]?.body_ar).toContain("الاشخاص اللي نسألهم عن شغلك");
    expect(note.rows[0]?.body_ar).not.toContain("references");
  });

  it("keeps UNDER_REVIEW and allows approve when optional reference is rejected only", async () => {
    db = await readyDatabase();
    await db.query(
      "SELECT public.admin_review_provider_section($1, 'references', 'rejected_optional', 'Optional reference note')",
      [PROVIDER],
    );
    expect(
      (await db.query<{ onboarding_status: string }>("SELECT onboarding_status FROM public.providers")).rows[0]
        .onboarding_status,
    ).toBe("UNDER_REVIEW");
    await db.query("SELECT public.admin_approve_provider_application_all($1)", [PROVIDER]);
    expect(
      (await db.query<{ onboarding_status: string }>("SELECT onboarding_status FROM public.providers")).rows[0]
        .onboarding_status,
    ).toBe("APPROVED");
  });
});
