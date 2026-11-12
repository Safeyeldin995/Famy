import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const OWNER_USER = "22222222-2222-4222-8222-222222222222";
const OTHER_USER = "33333333-3333-4333-8333-333333333333";
const OWNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_PROVIDER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PS_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SERVICE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const migrationPath = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/20261112110000_provider_service_preparation_notes.sql",
    import.meta.url,
  ),
);
const priceMigrationPath = fileURLToPath(
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
      "  SELECT (p_role = 'provider' AND p_uid IN ('22222222-2222-4222-8222-222222222222'::uuid, '33333333-3333-4333-8333-333333333333'::uuid))",
      "      OR (p_role = 'admin' AND p_uid = '11111111-1111-4111-8111-111111111111'::uuid)",
      " $$;",
      "CREATE TABLE public.providers (id uuid PRIMARY KEY, profile_id uuid NOT NULL, onboarding_status text NOT NULL);",
      "CREATE TABLE public.services (id uuid PRIMARY KEY, name_en text, name_ar text, is_active boolean NOT NULL DEFAULT true, provider_pricing_allowed boolean NOT NULL DEFAULT true, minimum_price numeric, maximum_price numeric);",
      "CREATE TABLE public.provider_services (",
      "  id uuid PRIMARY KEY, provider_id uuid NOT NULL, service_id uuid NOT NULL, status text NOT NULL,",
      "  price_override numeric, pending_price_override numeric, price_change_requested_at timestamptz, price_change_reason text",
      ");",
      "ALTER TABLE public.provider_services ENABLE ROW LEVEL SECURITY;",
      `CREATE POLICY ps_provider_manage ON public.provider_services FOR ALL TO authenticated`,
      "  USING (EXISTS (SELECT 1 FROM public.providers p WHERE p.id = provider_services.provider_id AND p.profile_id = auth.uid()))",
      "  WITH CHECK (EXISTS (SELECT 1 FROM public.providers p WHERE p.id = provider_services.provider_id AND p.profile_id = auth.uid()));",
      "CREATE OR REPLACE FUNCTION public.tg_validate_provider_price() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;",
      "CREATE TRIGGER trg_validate_provider_price BEFORE INSERT OR UPDATE OF price_override ON public.provider_services FOR EACH ROW EXECUTE FUNCTION public.tg_validate_provider_price();",
      `INSERT INTO public.providers VALUES ('${OWNER_ID}', '${OWNER_USER}', 'APPROVED'), ('${OTHER_PROVIDER_ID}', '${OTHER_USER}', 'APPROVED');`,
      `INSERT INTO public.services VALUES ('${SERVICE_ID}', 'Cleaning', 'تنظيف', true, true, 100, 1000);`,
      `INSERT INTO public.provider_services VALUES ('${PS_ID}', '${OWNER_ID}', '${SERVICE_ID}', 'approved', 300, NULL, NULL, NULL);`,
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_services TO authenticated;",
      "GRANT SELECT ON public.providers TO authenticated;",
    ].join("\n"),
  );
  await db.exec(readFileSync(priceMigrationPath, "utf8"));
  await db.exec(readFileSync(migrationPath, "utf8"));
  return db;
}

async function asProvider(db: PGlite, userId: string) {
  await db.query(`SELECT set_config('request.jwt.claim.sub', '${userId}', false);`);
  await db.exec("SET ROLE authenticated");
}

describe("provider preparation notes migration", () => {
  let db: PGlite | undefined;
  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("lets a provider update own notes without changing approval status", async () => {
    db = await readyDatabase();
    await asProvider(db, OWNER_USER);
    const row = (
      await db.query<{ status: string; preparation_notes: string | null }>(
        `UPDATE public.provider_services SET preparation_notes = $1 WHERE id = $2 RETURNING status, preparation_notes`,
        ["  كتب الرياضيات  ", PS_ID],
      )
    ).rows[0];
    await db.exec("RESET ROLE");
    expect(row.status).toBe("approved");
    expect(row.preparation_notes).toBe("كتب الرياضيات");
  });

  it("blocks another provider from updating someone else's notes", async () => {
    db = await readyDatabase();
    await asProvider(db, OWNER_USER);
    await db.query(`UPDATE public.provider_services SET preparation_notes = 'mine' WHERE id = $1`, [
      PS_ID,
    ]);
    await db.exec("RESET ROLE");

    await asProvider(db, OTHER_USER);
    const tamper = await db.query(
      `UPDATE public.provider_services SET preparation_notes = 'hijack' WHERE id = $1 RETURNING id`,
      [PS_ID],
    );
    await db.exec("RESET ROLE");
    expect(tamper.rows).toHaveLength(0);

    const stored = (
      await db.query<{ preparation_notes: string | null }>(
        `SELECT preparation_notes FROM public.provider_services WHERE id = $1`,
        [PS_ID],
      )
    ).rows[0];
    expect(stored.preparation_notes).toBe("mine");
  });

  it("enforces the 1000 character limit", async () => {
    db = await readyDatabase();
    await asProvider(db, OWNER_USER);
    await expect(
      db.query(`UPDATE public.provider_services SET preparation_notes = $1 WHERE id = $2`, [
        "x".repeat(1001),
        PS_ID,
      ]),
    ).rejects.toThrow(/check|preparation_notes|length/i);
    await db.exec("RESET ROLE");
  });
});
