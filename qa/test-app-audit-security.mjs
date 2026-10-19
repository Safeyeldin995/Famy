/**
 * Isolated PostgreSQL behavioral regression tests (no network or credentials).
 * Run: node qa/test-app-audit-security.mjs
 * Uses the repository-locked PGlite runtime. The payment/profile SQL is loaded from repository migrations;
 * unrelated Supabase schemas are replaced by minimal local fixture tables.
 * This complements, but does not replace, full Supabase migration replay/E2E.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const read = (name) => fs.readFileSync(`supabase/migrations/${name}`, "utf8");
const section = (sql, from, to) => {
  const start = sql.indexOf(from);
  const end = to ? sql.indexOf(to, start + from.length) : sql.length;
  assert(start >= 0 && end > start, `Missing migration section: ${from}`);
  return sql.slice(start, end);
};
const base = read("20260627001502_ad628300-597e-4e44-a327-c7e10f82290a.sql");
const method = read("20260714120000_configurable_payment_methods.sql");
const pricing = read("20260714180000_authoritative_booking_pricing.sql");
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const customer = uuid(1),
  provider = uuid(2),
  admin = uuid(3),
  stranger = uuid(4);
let passed = 0;
async function check(name, run) {
  await run();
  passed++;
  console.log(`PASS ${name}`);
}
async function actor(role, uid, run, aal = "aal1") {
  await db.exec("BEGIN");
  try {
    await db.exec(`SET LOCAL ROLE ${role}`);
    await db.query(
      "SELECT set_config('request.jwt.claim.role', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.aal', $3, true)",
      [role, uid ?? "", aal],
    );
    const result = await run();
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}
const customerRun = (run) => actor("authenticated", customer, run);
const serviceRun = (run) => actor("service_role", null, run);
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const webhook = (
  tx,
  order,
  success,
  pending,
  amount = 10000,
  currency = "EGP",
  integration = 456,
) =>
  serviceRun(() =>
    one("SELECT public.paymob_apply_transaction_webhook($1,$2,$3,$4,$5,$6,$7,$8) AS result", [
      tx,
      order,
      integration,
      currency,
      success,
      pending,
      amount,
      String(tx),
    ]),
  );

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, phone text, email text, raw_user_meta_data jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
    CREATE TYPE public.app_role AS ENUM ('customer','provider','admin');
    CREATE TYPE public.booking_status AS ENUM ('pending','completed','cancelled');
    CREATE TYPE public.payment_status AS ENUM ('pending','pending_review','authorized','captured','failed','rejected','refunded','partially_refunded');
    CREATE TYPE public.payment_method AS ENUM ('card','wallet','cash','instapay','paymob');
    CREATE TABLE public.providers(id uuid PRIMARY KEY, profile_id uuid NOT NULL);
    CREATE TABLE public.bookings(id uuid PRIMARY KEY, customer_id uuid, provider_id uuid,
      price_total numeric, currency text, status public.booking_status);
    GRANT SELECT ON public.bookings, public.providers TO authenticated;
    GRANT ALL ON public.bookings, public.providers TO service_role;
  `);
  await db.exec(
    section(
      base,
      "CREATE OR REPLACE FUNCTION public.tg_set_updated_at()",
      "-- Auto-create profile",
    ),
  );
  await db.exec(read("20260705224022_customer-suspend.sql"));
  await db.exec(
    section(base, "CREATE TABLE public.payments (", "CREATE TABLE public.transactions ("),
  );
  await db.exec(
    section(
      read("20260628233948_9206359f-ef5f-420d-b612-7c6c7be59bfe.sql"),
      "ALTER TABLE public.payments",
      "-- Storage RLS",
    ),
  );
  await db.exec(
    section(method, "CREATE TABLE IF NOT EXISTS public.payment_methods", "-- At most one row"),
  );
  await db.exec(section(method, "ALTER TABLE public.payments"));
  await db.exec(section(pricing, "CREATE OR REPLACE FUNCTION public.tg_validate_payment_amount()"));
  await db.exec(read("20260831120000_paymob_online_payments.sql"));
  await db.exec(read("20260831140000_paymob_codereview_hardening.sql"));
  await db.exec(`CREATE TRIGGER trg_validate_payment_capture BEFORE INSERT OR UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.tg_validate_payment_capture();`);
  const guards = read("20261001110000_security_write_guards.sql");
  await db.exec(section(guards, "-- S3:", "-- S4/S5:"));
  await db.exec(section(guards, "-- S7:", "-- S9:"));
  // Unrelated helpers exist only to replay the actual MFA migration's grants.
  await db.exec(`CREATE FUNCTION check_zone_overlap(jsonb,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION provider_required_documents_approved(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;`);
  await db.exec(read("20261018100000_admin_requires_mfa.sql"));
  await db.exec(read("20261018120000_oauth_contact_phone.sql"));
  const protectedDefinitions = () =>
    db.query(`SELECT proname, pg_get_functiondef(oid) AS definition FROM pg_proc
    WHERE pronamespace='public'::regnamespace AND proname IN ('has_role','handle_new_user','tg_guard_profile_admin_fields') ORDER BY proname`);
  const before = await protectedDefinitions();
  await db.exec(read("20261019120050_app_audit_security.sql"));
  await check("MFA, phone guard, and signup functions are unchanged", async () =>
    assert.deepEqual((await protectedDefinitions()).rows, before.rows),
  );
  await db.exec(`
    INSERT INTO auth.users(id) VALUES ('${customer}'),('${provider}'),('${admin}'),('${stranger}');
    INSERT INTO public.profiles(id, is_suspended) VALUES ('${customer}',true),('${provider}',false),('${admin}',false),('${stranger}',false);
    INSERT INTO public.user_roles(user_id, role) VALUES ('${customer}','customer'),('${provider}','provider'),('${admin}','admin');
    INSERT INTO public.providers VALUES ('${uuid(10)}','${provider}');
    INSERT INTO public.payment_methods(id,code,name_en,name_ar,method_type,is_active) VALUES
      ('${uuid(20)}','cash_on_delivery','Cash','Cash','cash',true),
      ('${uuid(21)}','instapay','Transfer','Transfer','manual_transfer',true),
      ('${uuid(22)}','paymob','Paymob','Paymob','online',true);
    INSERT INTO public.bookings SELECT ('00000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,
      '${customer}'::uuid,'${uuid(10)}'::uuid,100,'EGP','completed'::public.booking_status FROM generate_series(100,110) i;
  `);
  await check("customer cannot undo suspension", () =>
    assert.rejects(
      customerRun(() => db.query("UPDATE profiles SET is_suspended=false WHERE id=$1", [customer])),
      /Suspension status can only be changed by an admin/,
    ),
  );
  await check("ordinary self profile edits still work", () =>
    customerRun(() => db.query("UPDATE profiles SET full_name='Updated' WHERE id=$1", [customer])),
  );
  await check("administrator can unsuspend", () =>
    actor(
      "authenticated",
      admin,
      () => db.query("UPDATE profiles SET is_suspended=false WHERE id=$1", [customer]),
      "aal2",
    ),
  );
  await check("admin without MFA has no admin role and cannot suspend", async () => {
    await actor("authenticated", admin, async () => {
      assert.equal((await one("SELECT has_role(auth.uid(), 'admin') AS allowed")).allowed, false);
      const result = await db.query(
        "UPDATE profiles SET is_suspended=true WHERE id=$1 RETURNING id",
        [customer],
      );
      assert.equal(result.rows.length, 0); // RLS hides the other account before the trigger.
    });
    assert.equal(
      (await one("SELECT is_suspended FROM profiles WHERE id=$1", [customer])).is_suspended,
      false,
    );
  });
  await check("direct phone and verification writes are blocked", async () => {
    for (const assignment of ["phone='201000000001'", "phone_verified=false"])
      await assert.rejects(
        customerRun(() => db.query(`UPDATE profiles SET ${assignment} WHERE id=$1`, [customer])),
        /Phone can only be changed through verification/,
      );
  });
  await check("OAuth contact RPC keeps phone unverified", async () => {
    await customerRun(() => db.query("SELECT set_my_contact_phone('01000000001')"));
    assert.deepEqual(
      await one("SELECT phone, phone_verified FROM profiles WHERE id=$1", [customer]),
      { phone: "201000000001", phone_verified: false },
    );
  });
  await check("verified signup takes over unverified phone and preserves signup role", async () => {
    await db.exec(
      "CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()",
    );
    await db.query(
      "INSERT INTO auth.users(id,phone,raw_user_meta_data) VALUES($1,'201000000001',$2)",
      [uuid(5), { signup_role: "provider", full_name: "Fixture" }],
    );
    assert.equal((await one("SELECT phone FROM profiles WHERE id=$1", [customer])).phone, null);
    assert.equal(
      (await one("SELECT phone_verified FROM profiles WHERE id=$1", [uuid(5)])).phone_verified,
      true,
    );
    assert.equal(
      (await one("SELECT role FROM user_roles WHERE user_id=$1", [uuid(5)])).role,
      "provider",
    );
  });
  const insert = (id, booking, methodId, extra = "") =>
    customerRun(() =>
      db.exec(`
    INSERT INTO payments(id, booking_id, customer_id, payment_method_id, amount, currency, status, metadata)
    VALUES('${uuid(id)}','${uuid(booking)}','${customer}','${uuid(methodId)}',100,'EGP','captured','{"paymob_checkout_url":"untrusted"}') ${extra}`),
    );
  await check("customer cannot initialize a captured payment or gateway metadata", async () => {
    await insert(200, 100, 20);
    const p = await one("SELECT * FROM payments WHERE id=$1", [uuid(200)]);
    assert.equal(p.status, "pending");
    assert.deepEqual(p.metadata, {});
    assert.equal(p.captured_at, null);
  });
  await check("duplicate active payment initialization is rejected", () =>
    assert.rejects(insert(201, 100, 20), /already exists/),
  );
  await insert(202, 101, 21);
  await check("manual transfer initializes as pending_review", async () =>
    assert.equal(
      (await one("SELECT status FROM payments WHERE id=$1", [uuid(202)])).status,
      "pending_review",
    ),
  );
  await check("customer can upload proof for its booking", () =>
    customerRun(() =>
      db.query("UPDATE payments SET proof_path=$1 WHERE id=$2", [
        `${uuid(101)}/receipt.png`,
        uuid(202),
      ]),
    ),
  );
  await check("customer cannot replace payment metadata", () =>
    assert.rejects(
      customerRun(() =>
        db.query(
          "UPDATE payments SET metadata='{}'::jsonb || '{\"attack\":true}'::jsonb WHERE id=$1",
          [uuid(202)],
        ),
      ),
      /only upload/,
    ),
  );
  await check("customer cannot point proof at another booking", () =>
    assert.rejects(
      customerRun(() =>
        db.query("UPDATE payments SET proof_path=$1 WHERE id=$2", [
          `${uuid(102)}/receipt.png`,
          uuid(202),
        ]),
      ),
      /must belong/,
    ),
  );
  await check("provider cannot rewrite the payment method snapshot", () =>
    assert.rejects(
      actor("authenticated", provider, () =>
        db.query("UPDATE payments SET payment_method_type='cash' WHERE id=$1", [uuid(202)]),
      ),
      /Invalid manual/,
    ),
  );
  await check(
    "provider may capture a completed manual payment with server review identity",
    async () => {
      await actor("authenticated", provider, () =>
        db.query("UPDATE payments SET status='captured', reviewed_by=$1 WHERE id=$2", [
          stranger,
          uuid(200),
        ]),
      );
      assert.equal(
        (await one("SELECT reviewed_by FROM payments WHERE id=$1", [uuid(200)])).reviewed_by,
        provider,
      );
    },
  );
  await check("captured payment cannot be downgraded by provider", () =>
    assert.rejects(
      actor("authenticated", provider, () =>
        db.query("UPDATE payments SET status='rejected' WHERE id=$1", [uuid(200)]),
      ),
      /Invalid manual/,
    ),
  );
  await insert(203, 102, 22);
  await check("provider cannot manually capture an online payment", () =>
    assert.rejects(
      actor("authenticated", provider, () =>
        db.query("UPDATE payments SET status='captured' WHERE id=$1", [uuid(203)]),
      ),
      /payment gateway/,
    ),
  );
  await check("admin cannot manually capture an online payment", () =>
    assert.rejects(
      actor(
        "authenticated",
        admin,
        () => db.query("UPDATE payments SET status='captured' WHERE id=$1", [uuid(203)]),
        "aal2",
      ),
      /payment gateway/,
    ),
  );
  await check("authenticated users cannot call gateway settlement RPC", () =>
    assert.rejects(
      customerRun(() =>
        db.query("SELECT paymob_apply_transaction_webhook(1,789,456,'EGP',true,false,10000,'1')"),
      ),
      /permission denied/,
    ),
  );
  await check("unknown signed order cannot select an arbitrary payment", () =>
    assert.rejects(webhook(1, 789, true, false), /mapping not found/),
  );
  await check("trusted checkout mapping can only be written server-side", async () => {
    const sql = "SELECT paymob_store_checkout_intention($1,$2,$3,$4,$5)";
    const args = [uuid(203), "intent-1", "https://example.test/checkout", 789, 456];
    await assert.rejects(
      customerRun(() => db.query(sql, args)),
      /permission denied/,
    );
    await serviceRun(() => db.query(sql, args));
  });
  await check("currency, amount and integration mismatches are rejected", async () => {
    await assert.rejects(webhook(1, 789, true, false, 9999), /does not match/);
    await assert.rejects(webhook(1, 789, true, false, 10000, "USD"), /does not match/);
    await assert.rejects(webhook(1, 789, true, false, 10000, "EGP", 999), /does not match/);
  });
  await check("pending -> success with the SAME transaction id captures payment", async () => {
    await webhook(1, 789, false, true);
    assert.equal(
      (await one("SELECT status FROM payments WHERE id=$1", [uuid(203)])).status,
      "pending",
    );
    await webhook(1, 789, true, false);
    assert.equal(
      (await one("SELECT status FROM payments WHERE id=$1", [uuid(203)])).status,
      "captured",
    );
    assert.equal(
      (await one("SELECT outcome FROM paymob_webhook_events WHERE paymob_transaction_id=1"))
        .outcome,
      "captured",
    );
  });
  await check("duplicate success and late pending/failure cannot downgrade capture", async () => {
    assert.equal((await webhook(1, 789, true, false)).result.duplicate, true);
    await webhook(1, 789, false, true);
    await webhook(2, 789, false, false);
    assert.equal(
      (await one("SELECT status FROM payments WHERE id=$1", [uuid(203)])).status,
      "captured",
    );
  });
  await insert(204, 103, 22);
  await serviceRun(() =>
    db.query("SELECT paymob_store_checkout_intention($1,$2,$3,$4,$5)", [
      uuid(204),
      "intent-2",
      "https://example.test/checkout2",
      790,
      456,
    ]),
  );
  await check("transaction cannot be replayed against a second trusted order", () =>
    assert.rejects(webhook(1, 790, true, false), /another payment/),
  );
  await check("pending -> rejection and distinct successful retry behave correctly", async () => {
    await webhook(3, 790, false, true);
    await webhook(3, 790, false, false);
    assert.equal(
      (await one("SELECT status FROM payments WHERE id=$1", [uuid(204)])).status,
      "rejected",
    );
    await webhook(4, 790, true, false);
    assert.equal(
      (await one("SELECT status FROM payments WHERE id=$1", [uuid(204)])).status,
      "captured",
    );
  });
  await insert(205, 104, 22);
  await serviceRun(() =>
    db.query("UPDATE payments SET payment_method_type=NULL, payment_method_code=NULL WHERE id=$1", [
      uuid(205),
    ]),
  );
  await check("legacy Paymob rows cannot be manually captured", () =>
    assert.rejects(
      actor("authenticated", provider, () =>
        db.query("UPDATE payments SET status='captured' WHERE id=$1", [uuid(205)]),
      ),
      /payment gateway/,
    ),
  );
  await insert(206, 105, 22);
  await serviceRun(() =>
    db.query("UPDATE payments SET metadata=$1 WHERE id=$2", [
      { paymob_checkout_url: "https://example.test/legacy", paymob_intention_id: "legacy" },
      uuid(206),
    ]),
  );
  await check("legacy checkout without trusted mapping fails closed", () =>
    assert.rejects(
      serviceRun(() => db.query("SELECT paymob_reserve_checkout($1)", [uuid(206)])),
      /trusted order reconciliation/,
    ),
  );
  await insert(207, 106, 20);
  await serviceRun(() => db.query("UPDATE bookings SET status='pending' WHERE id=$1", [uuid(106)]));
  await check("manual capture still requires booking completion", () =>
    assert.rejects(
      actor("authenticated", provider, () =>
        db.query("UPDATE payments SET status='captured' WHERE id=$1", [uuid(207)]),
      ),
      /cannot be captured until/,
    ),
  );
  await check("unsafe old RPC signatures no longer exist", async () => {
    assert.equal(
      (
        await one(
          "SELECT to_regprocedure('paymob_apply_transaction_webhook(bigint,uuid,boolean,boolean,bigint,text,jsonb)') AS old",
        )
      ).old,
      null,
    );
  });
  await check("overlapping eight-argument webhook is removed", async () => {
    assert.equal(
      (
        await one(
          "SELECT to_regprocedure('paymob_apply_transaction_webhook(bigint,uuid,boolean,boolean,bigint,text,jsonb,text)') AS old",
        )
      ).old,
      null,
    );
  });
  console.log(`PostgreSQL security checks: ${passed} passed`);
} catch (error) {
  console.error(`PostgreSQL security check failed after ${passed} checks: ${error.message}`);
  if (error.position) console.error(`SQL position: ${error.position}`);
  if (error.where) console.error(error.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
