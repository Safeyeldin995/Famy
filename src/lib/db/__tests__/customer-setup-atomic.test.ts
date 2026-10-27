import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../../../../supabase/migrations/20261027100644_customer_setup_atomic_save.sql",
    import.meta.url,
  ),
  "utf8",
);
const contactMigration = readFileSync(
  new URL(
    "../../../../supabase/migrations/20261018120000_oauth_contact_phone.sql",
    import.meta.url,
  ),
  "utf8",
);
const contactRpc = contactMigration.slice(
  contactMigration.indexOf("CREATE OR REPLACE FUNCTION public.set_my_contact_phone"),
);
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const address = { street: "Test street", city: "Giza", area: "Sheikh Zayed", lat: 30, lng: 31 };
let db: PGlite;

describe("customer setup transaction with owner RLS", () => {
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA public, auth TO authenticated;
      CREATE TABLE auth.users(id uuid PRIMARY KEY, phone text);
      CREATE TABLE public.profiles(id uuid PRIMARY KEY, full_name text, phone text, phone_verified boolean);
      CREATE TABLE public.addresses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
        label text, line1 text NOT NULL, line2 text, city text NOT NULL, area text, street text, compound text,
        building text CHECK (building <> 'reject'), floor text, apartment text, landmark text, access_notes text,
        lat double precision, lng double precision, is_default boolean DEFAULT false, created_at timestamptz DEFAULT now());
      ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;
      CREATE POLICY owner ON public.profiles FOR ALL TO authenticated USING(id = auth.uid()) WITH CHECK(id = auth.uid());
      CREATE POLICY owner ON public.addresses FOR ALL TO authenticated USING(user_id = auth.uid()) WITH CHECK(user_id = auth.uid());
      GRANT SELECT, UPDATE ON public.profiles TO authenticated;
      GRANT SELECT, INSERT, UPDATE ON public.addresses TO authenticated;
      INSERT INTO public.profiles(id, full_name) VALUES ('${owner}', 'Old'), ('${other}', 'Other');
      INSERT INTO auth.users VALUES ('${owner}', NULL), ('${other}', NULL);
    `);
    await db.exec(contactRpc);
    await db.exec(migration);
    await db.exec(`SET ROLE authenticated; SELECT set_config('test.uid', '${owner}', false);`);
  });
  afterEach(async () => {
    await db?.close();
  });
  const save = (data = address, id: string | null = null) =>
    db.query<{ id: string }>("SELECT public.save_customer_setup($1, $2::jsonb, $3::uuid) AS id", [
      "New name",
      JSON.stringify(data),
      id,
    ]);
  it("saves both rows and a retry updates the same address", async () => {
    const first = await save();
    expect((await save()).rows[0].id).toBe(first.rows[0].id);
    expect((await db.query("SELECT full_name FROM public.profiles")).rows).toEqual([
      { full_name: "New name" },
    ]);
    expect((await db.query("SELECT * FROM public.addresses")).rows).toHaveLength(1);
  });
  it("rolls the name back when an address constraint fails", async () => {
    await expect(save({ ...address, building: "reject" } as typeof address)).rejects.toThrow();
    expect((await db.query("SELECT full_name FROM public.profiles")).rows).toEqual([
      { full_name: "Old" },
    ]);
    expect((await db.query("SELECT * FROM public.addresses")).rows).toHaveLength(0);
  });
  it("uses the real contact-phone RPC and rolls its update back on address failure", async () => {
    await expect(
      db.query("SELECT public.save_customer_setup($1,$2::jsonb,NULL,$3)", [
        "New",
        JSON.stringify({ ...address, building: "reject" }),
        "01000000000",
      ]),
    ).rejects.toThrow();
    expect((await db.query("SELECT phone, full_name FROM profiles")).rows).toEqual([
      { phone: null, full_name: "Old" },
    ]);
    await db.query("SELECT public.save_customer_setup($1,$2::jsonb,NULL,$3)", [
      "New",
      JSON.stringify(address),
      "01000000000",
    ]);
    expect((await db.query("SELECT phone_verified FROM profiles")).rows).toEqual([
      { phone_verified: false },
    ]);
  });
  it("does not bypass the verified-phone guard", async () => {
    await db.exec(
      `RESET ROLE; UPDATE auth.users SET phone = 'verified' WHERE id = '${owner}'; SET ROLE authenticated;`,
    );
    await expect(
      db.query("SELECT public.save_customer_setup($1,$2::jsonb,NULL,$3)", [
        "New",
        JSON.stringify(address),
        "01000000000",
      ]),
    ).rejects.toThrow(/PHONE_ALREADY_VERIFIED/);
    expect((await db.query("SELECT full_name FROM profiles")).rows).toEqual([{ full_name: "Old" }]);
  });
  it("rejects another owner's address without changing the name", async () => {
    await db.exec(
      `RESET ROLE; INSERT INTO public.addresses(id, user_id, line1, city) VALUES ('${other}', '${other}', 'Private', 'Giza'); SET ROLE authenticated;`,
    );
    await expect(save(address, other)).rejects.toThrow(/address_not_found/);
    expect((await db.query("SELECT full_name FROM public.profiles")).rows).toEqual([
      { full_name: "Old" },
    ]);
  });
  it("fails closed for missing coordinates and an anonymous caller", async () => {
    await expect(save({ ...address, lat: null } as unknown as typeof address)).rejects.toThrow(
      /invalid_address_coordinates/,
    );
    await db.exec("SELECT set_config('test.uid', '', false)");
    await expect(save()).rejects.toThrow(/not_authenticated/);
    await db.exec("SET ROLE anon");
    await expect(save()).rejects.toThrow(/permission denied/);
  });
});
