import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";

const db = new PGlite();
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
      $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    CREATE FUNCTION public.has_role(uuid,text) RETURNS boolean LANGUAGE sql AS
      $$ SELECT $1 = '${id(3)}'::uuid $$;
    CREATE TABLE family_members (date_of_birth date NOT NULL);
    INSERT INTO family_members VALUES ('2020-05-12');
    CREATE TABLE providers (id uuid, profile_id uuid);
    CREATE TABLE profiles (id uuid, full_name text, avatar_url text, phone text);
    CREATE TABLE bookings (id uuid, customer_id uuid, provider_id uuid, status text, deleted_at timestamptz);
    CREATE TABLE booking_locations (booking_id uuid, area text, city text, zone_name_en text, zone_name_ar text);
    CREATE TABLE booking_family_member_snapshots (booking_id uuid, full_name text, date_of_birth date);
    INSERT INTO providers VALUES ('${id(10)}','${id(2)}');
    INSERT INTO profiles (id, full_name) VALUES ('${id(1)}','Customer'),('${id(2)}','Provider');
    INSERT INTO bookings VALUES ('${id(20)}','${id(1)}','${id(10)}','pending',null);
    INSERT INTO booking_family_member_snapshots VALUES ('${id(20)}','Child',
      (date_trunc('month', now() AT TIME ZONE 'Africa/Cairo') - interval '8 months')::date);
  `);
  const original = readFileSync(
    "supabase/migrations/20261012100000_booking_parties_and_bookable_services.sql",
    "utf8",
  );
  await db.exec(
    original.slice(
      0,
      original.indexOf("CREATE OR REPLACE FUNCTION public.marketplace_provider_bookable_services"),
    ),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261102141426_family_member_estimated_birth_date.sql",
      "utf8",
    ),
  );
});
afterAll(() => db.close());

async function queryAs(user: number) {
  await db.query("SELECT set_config('test.uid', $1, false)", [user ? id(user) : ""]);
  return db.query<{ member_age_months: number | null }>(
    "SELECT * FROM booking_party_profiles_with_member_age($1::uuid[])",
    [[id(20)]],
  );
}

it("preserves existing DOB and marks only future explicit age writes estimated", async () => {
  const { rows } = await db.query(
    "SELECT date_of_birth::text AS dob, date_of_birth_is_estimated AS estimated FROM family_members",
  );
  expect(rows).toEqual([{ dob: "2020-05-12", estimated: false }]);
});
it("returns months only under the original caller/status rules, never DOB", async () => {
  await expect(queryAs(0)).rejects.toThrow("Authentication required");
  expect((await queryAs(4)).rows).toEqual([]);
  expect((await queryAs(1)).rows[0].member_age_months).toBeNull();
  const provider = (await queryAs(2)).rows[0];
  expect(provider.member_age_months).toBe(8);
  expect(provider).not.toHaveProperty("date_of_birth");
  await db.exec("UPDATE bookings SET status='completed'");
  expect((await queryAs(2)).rows[0].member_age_months).toBeNull();
  expect((await queryAs(3)).rows[0].member_age_months).toBe(8);
  await db.exec("UPDATE bookings SET deleted_at=now()");
  expect((await queryAs(3)).rows).toEqual([]);
});
it("inherits the original batch limit", async () => {
  await db.query("SELECT set_config('test.uid', $1, false)", [id(2)]);
  await expect(
    db.query("SELECT * FROM booking_party_profiles_with_member_age($1::uuid[])", [
      Array(201).fill(id(20)),
    ]),
  ).rejects.toThrow("Too many bookings");
});
