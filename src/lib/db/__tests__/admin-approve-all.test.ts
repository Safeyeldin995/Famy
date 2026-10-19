import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "11111111-1111-4111-8111-111111111111";
const PROVIDER = "33333333-3333-4333-8333-333333333333";
const migrationPath = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/20261013130000_admin_work_queue_and_approve_all.sql",
    import.meta.url,
  ),
);

async function readyDatabase() {
  const db = new PGlite();
  // Test sessions act as a fully verified (aal2) login; admin MFA is covered by admin-requires-mfa.test.ts.
  await db.query("SELECT set_config('request.jwt.claim.aal', 'aal2', false)");
  await db.exec(
    [
      "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;",
      "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;",
      "CREATE FUNCTION public.has_role(p_uid uuid, p_role text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT p_role = 'admin' AND p_uid IN ('11111111-1111-4111-8111-111111111111'::uuid, '22222222-2222-4222-8222-222222222222'::uuid) $$;",
      "CREATE TABLE public.providers (id uuid PRIMARY KEY, profile_id uuid NOT NULL, onboarding_status text NOT NULL, resubmitted_at timestamptz);",
      "CREATE FUNCTION public.admin_provider_identity_ids() RETURNS TABLE(provider_id uuid) LANGUAGE sql STABLE AS $$ SELECT id FROM public.providers $$;",
      "CREATE TABLE public.provider_services (id uuid PRIMARY KEY, provider_id uuid NOT NULL, service_id uuid NOT NULL, status text NOT NULL);",
      "CREATE TABLE public.provider_teaching_capabilities (id uuid PRIMARY KEY, provider_id uuid NOT NULL, service_id uuid NOT NULL, subject_id uuid NOT NULL, curriculum_id uuid NOT NULL, level_id uuid NOT NULL, session_duration_min int NOT NULL, session_price integer NOT NULL, status text NOT NULL);",
      "CREATE TABLE public.provider_documents (id uuid PRIMARY KEY, provider_id uuid NOT NULL, status text NOT NULL);",
      "CREATE TABLE public.disputes (id uuid PRIMARY KEY, status text NOT NULL);",
      "CREATE TABLE public.support_tickets (id uuid PRIMARY KEY, status text NOT NULL);",
      "CREATE TABLE public.bookings (id uuid PRIMARY KEY, status text NOT NULL);",
      "CREATE TABLE public.payments (id uuid PRIMARY KEY, status text NOT NULL);",
      "CREATE FUNCTION public.admin_set_provider_service_status(p_id uuid, p_status text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN UPDATE public.provider_services SET status = p_status WHERE id = p_id; END; $$;",
      "CREATE FUNCTION public.admin_review_teaching_group(p_ids uuid[], p_status text, p_note text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN UPDATE public.provider_teaching_capabilities SET status = p_status WHERE id = ANY(p_ids); END; $$;",
      "CREATE FUNCTION public.admin_provider_onboarding_action(p_id uuid, p_action text, p_reason_code text, p_reason_public text, p_internal text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF current_setting('test.fail_app', true) = 'true' THEN RAISE EXCEPTION 'Existing onboarding validation failed.'; END IF; UPDATE public.providers SET onboarding_status = 'APPROVED' WHERE id = p_id; END; $$;",
    ].join("\n"),
  );
  await db.exec(readFileSync(migrationPath, "utf8"));
  await db.exec(
    [
      "SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);",
      "INSERT INTO public.providers VALUES ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'SUBMITTED', NULL);",
      "INSERT INTO public.provider_services VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', 'pending');",
      "INSERT INTO public.provider_documents VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '33333333-3333-4333-8333-333333333333', 'pending');",
      "INSERT INTO public.bookings VALUES ('11111111-1111-4111-8111-111111111112', 'disputed'), ('11111111-1111-4111-8111-111111111113', 'no_show'), ('11111111-1111-4111-8111-111111111114', 'completion_requested');",
      "INSERT INTO public.payments VALUES ('11111111-1111-4111-8111-111111111115', 'pending_review'), ('11111111-1111-4111-8111-111111111116', 'failed');",
      "INSERT INTO public.provider_teaching_capabilities VALUES",
      "('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777', 60, 400, 'pending'),",
      "('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666', '88888888-8888-4888-8888-888888888888', 60, 400, 'pending');",
    ].join("\n"),
  );
  return db;
}

describe("admin work queue and all-in-one approval migration", () => {
  let db: PGlite | undefined;
  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("counts a pending multi-grade teaching group once", async () => {
    db = await readyDatabase();
    const result = await db.query<{ queue: string; item_count: number }>(
      "SELECT * FROM public.admin_work_queue_counts()",
    );
    const counts = Object.fromEntries(
      result.rows.map((row) => [row.queue, Number(row.item_count)]),
    );
    expect(counts.new_applications).toBe(1);
    expect(counts.pending_services).toBe(1);
    expect(counts.pending_teaching_groups).toBe(1);
    expect(counts.pending_documents).toBe(1);
    expect(counts.bookings_needing_action).toBe(2);
    expect(counts.payments_pending_review).toBe(1);
    expect(Object.keys(counts)).toHaveLength(8);
    const queueProviders = await db.query<{ provider_id: string }>(
      "SELECT * FROM public.admin_work_queue_provider_ids('pending_teaching_groups')",
    );
    expect(queueProviders.rows.map((row) => row.provider_id)).toEqual([PROVIDER]);
  });

  it("approves application, service and teaching group in one call", async () => {
    db = await readyDatabase();
    const result = await db.query<{
      result: { approved_services: number; approved_teaching_groups: number };
    }>("SELECT public.admin_approve_provider_application_all($1) AS result", [PROVIDER]);
    expect(result.rows[0].result).toEqual({ approved_services: 1, approved_teaching_groups: 1 });
    expect(
      (
        await db.query<{ onboarding_status: string }>(
          "SELECT onboarding_status FROM public.providers",
        )
      ).rows[0].onboarding_status,
    ).toBe("APPROVED");
    expect(
      (await db.query<{ status: string }>("SELECT status FROM public.provider_services")).rows[0]
        .status,
    ).toBe("approved");
    expect(
      (
        await db.query<{ status: string }>(
          "SELECT status FROM public.provider_teaching_capabilities",
        )
      ).rows.map((row) => row.status),
    ).toEqual(["approved", "approved"]);
  });

  it("blocks self-approval before any writes", async () => {
    db = await readyDatabase();
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [OWNER]);
    await expect(
      db.query("SELECT public.admin_approve_provider_application_all($1)", [PROVIDER]),
    ).rejects.toThrow(/cannot approve their own/);
    expect(
      (await db.query<{ status: string }>("SELECT status FROM public.provider_services")).rows[0]
        .status,
    ).toBe("pending");
  });

  it("rolls back every approval when the existing onboarding action fails", async () => {
    db = await readyDatabase();
    await db.query("SELECT set_config('test.fail_app', 'true', false)");
    await expect(
      db.query("SELECT public.admin_approve_provider_application_all($1)", [PROVIDER]),
    ).rejects.toThrow(/Existing onboarding validation failed/);
    expect(
      (
        await db.query<{ onboarding_status: string }>(
          "SELECT onboarding_status FROM public.providers",
        )
      ).rows[0].onboarding_status,
    ).toBe("SUBMITTED");
    expect(
      (await db.query<{ status: string }>("SELECT status FROM public.provider_services")).rows[0]
        .status,
    ).toBe("pending");
    expect(
      (
        await db.query<{ status: string }>(
          "SELECT status FROM public.provider_teaching_capabilities",
        )
      ).rows.map((row) => row.status),
    ).toEqual(["pending", "pending"]);
  });

  it("clears only the chosen private check without changing application status", async () => {
    db = await readyDatabase();
    await db.query(
      "SELECT public.admin_review_provider_section($1, 'references', 'approved', NULL)",
      [PROVIDER],
    );
    await db.query(
      "SELECT public.admin_review_provider_section($1, 'personal_details', 'approved', NULL)",
      [PROVIDER],
    );
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [OWNER]);
    await expect(
      db.query("SELECT public.admin_review_provider_section($1, 'references', 'clear', NULL)", [
        PROVIDER,
      ]),
    ).rejects.toThrow(/cannot review their own/);
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [ADMIN]);
    await db.query("SELECT public.admin_review_provider_section($1, 'references', 'clear', NULL)", [
      PROVIDER,
    ]);
    expect(
      (await db.query("SELECT section FROM public.provider_admin_section_reviews")).rows,
    ).toEqual([{ section: "personal_details" }]);
    expect((await db.query("SELECT onboarding_status FROM public.providers")).rows[0]).toEqual({
      onboarding_status: "SUBMITTED",
    });
  });

  it("requires a reason and blocks self-review for section decisions", async () => {
    db = await readyDatabase();
    await expect(
      db.query(
        "SELECT public.admin_review_provider_section($1, 'references', 'request_changes', NULL)",
        [PROVIDER],
      ),
    ).rejects.toThrow(/reason is required/);
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [OWNER]);
    await expect(
      db.query("SELECT public.admin_review_provider_section($1, 'references', 'approved', NULL)", [
        PROVIDER,
      ]),
    ).rejects.toThrow(/cannot review their own/);
    expect(
      (
        await db.query<{ n: number }>(
          "SELECT count(*) AS n FROM public.provider_admin_section_reviews",
        )
      ).rows[0].n,
    ).toBe(0);
  });
});
