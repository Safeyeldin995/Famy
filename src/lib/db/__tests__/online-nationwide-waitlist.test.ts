import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asServiceRole,
  asUser,
  createProviderLifecycleDb,
  IDS,
  queryRows,
  seedDraftProvider,
  tryAsAnon,
  tryAsUser,
} from "./provider-lifecycle.harness";

let db: PGlite;

beforeAll(async () => {
  db = await createProviderLifecycleDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("BEGIN");
});

afterEach(async () => {
  await db.exec("ROLLBACK");
});

async function closeOnline(codes: string[]) {
  await asServiceRole(db, async () => {
    await queryRows(
      db,
      `UPDATE public.settings SET value = jsonb_build_object('closed_governorates', $1::jsonb)
        WHERE key = 'online_availability'`,
      [JSON.stringify(codes)],
    );
  });
}

describe("online lessons for all of Egypt (20261126100000)", () => {
  it("seeds online as open everywhere", async () => {
    const rows = await queryRows<{ value: unknown }>(
      db,
      `SELECT value FROM public.settings WHERE key = 'online_availability'`,
    );
    expect(rows[0]?.value).toEqual({ closed_governorates: [] });
    const open = await queryRows<{ a: boolean; b: boolean }>(
      db,
      `SELECT public.online_open_for_governorate('sohag') AS a,
              public.online_open_for_governorate(NULL) AS b`,
    );
    expect(open[0]).toEqual({ a: true, b: true });
  });

  it("lets a customer set a valid governorate only", async () => {
    await seedDraftProvider(db);
    const ok = await tryAsUser(db, IDS.customer, `SELECT public.set_my_governorate('Asyut ')`);
    expect(ok.ok).toBe(true);
    const row = await queryRows<{ governorate: string }>(
      db,
      `SELECT governorate FROM public.profiles WHERE id = $1`,
      [IDS.customer],
    );
    expect(row[0]?.governorate).toBe("asyut");

    const bad = await tryAsUser(db, IDS.customer, `SELECT public.set_my_governorate('atlantis')`);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/invalid_governorate/);

    const anon = await tryAsAnon(db, `SELECT public.set_my_governorate('giza')`);
    expect(anon.ok).toBe(false);
  });

  it("closes online bookings only for the closed governorate", async () => {
    await seedDraftProvider(db);
    await asUser(db, IDS.customer, async () => {
      await queryRows(db, `SELECT public.set_my_governorate('sohag')`);
    });
    await closeOnline(["sohag"]);

    // Exercise the booking trigger body on a stand-in table with the columns it reads.
    await db.exec(`
      CREATE TEMP TABLE booking_probe (customer_id uuid, service_mode text);
      CREATE TRIGGER probe_online_region BEFORE INSERT ON booking_probe
        FOR EACH ROW EXECUTE FUNCTION public.tg_bookings_online_region_open();
    `);
    await db.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true)");

    await db.exec("SAVEPOINT probe_closed");
    await expect(
      db.query(`INSERT INTO booking_probe VALUES ($1, 'online')`, [IDS.customer]),
    ).rejects.toThrow(/BOOKING_ONLINE_REGION_CLOSED/);
    await db.exec("ROLLBACK TO SAVEPOINT probe_closed");

    // In-person bookings are unaffected.
    await db.query(`INSERT INTO booking_probe VALUES ($1, 'in_person')`, [IDS.customer]);

    // Another governorate is still open.
    await asUser(db, IDS.customer, async () => {
      await queryRows(db, `SELECT public.set_my_governorate('giza')`);
    });
    await db.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true)");
    await db.query(`INSERT INTO booking_probe VALUES ($1, 'online')`, [IDS.customer]);

    const trigger = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM pg_trigger
        WHERE tgname = 'trg_bookings_online_region_open'
          AND tgrelid = 'public.bookings'::regclass`,
    );
    expect(trigger[0]?.n).toBe(1);
  });

  it("lets an applicant choose online only before approval", async () => {
    await seedDraftProvider(db);
    const ok = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_update_offering_mode('online')`,
    );
    expect(ok.ok).toBe(true);
    const row = await queryRows<{ offering_mode: string }>(
      db,
      `SELECT offering_mode FROM public.providers WHERE id = $1`,
      [IDS.provider],
    );
    expect(row[0]?.offering_mode).toBe("online");

    await asUser(db, IDS.providerUser, async () => {
      await queryRows(db, `SELECT public.set_my_governorate('minya')`);
    });
    const gov = await queryRows<{ governorate: string }>(
      db,
      `SELECT governorate FROM public.providers WHERE id = $1`,
      [IDS.provider],
    );
    expect(gov[0]?.governorate).toBe("minya");
  });

  it("records 'tell me when you arrive' by governorate and service", async () => {
    const seed = await seedDraftProvider(db);
    const ok = await tryAsUser(
      db,
      IDS.customer,
      `INSERT INTO public.area_requests (governorate, service_id) VALUES ('aswan', $1)`,
      [seed.serviceId],
    );
    expect(ok.ok).toBe(true);

    // A pin still works; a row with neither a pin nor a governorate does not.
    const pin = await tryAsUser(
      db,
      IDS.customer,
      `INSERT INTO public.area_requests (lat, lng) VALUES (30.1, 31.2)`,
    );
    expect(pin.ok).toBe(true);
    const empty = await tryAsUser(
      db,
      IDS.customer,
      `INSERT INTO public.area_requests (service_id) VALUES ($1)`,
      [seed.serviceId],
    );
    expect(empty.ok).toBe(false);
    const halfPin = await tryAsUser(
      db,
      IDS.customer,
      `INSERT INTO public.area_requests (lat, governorate) VALUES (30.1, 'giza')`,
    );
    expect(halfPin.ok).toBe(false);

    const denied = await tryAsUser(db, IDS.customer, `SELECT * FROM public.admin_area_request_summary()`);
    expect(denied.ok).toBe(false);

    const summary = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT governorate, service_id, request_count::int AS n, customer_count::int AS c
         FROM public.admin_area_request_summary()
        WHERE governorate = 'aswan'`,
    );
    expect(summary.ok).toBe(true);
    expect(summary.rows).toEqual([
      { governorate: "aswan", service_id: seed.serviceId, n: 1, c: 1 },
    ]);
  });

  it("keeps the new helpers away from anon where they write or read private data", async () => {
    const grants = await queryRows<{ set_anon: boolean; sum_anon: boolean; trg_auth: boolean }>(
      db,
      `SELECT has_function_privilege('anon', 'public.set_my_governorate(text)', 'EXECUTE') AS set_anon,
              has_function_privilege('anon', 'public.admin_area_request_summary()', 'EXECUTE') AS sum_anon,
              has_function_privilege('authenticated', 'public.tg_bookings_online_region_open()', 'EXECUTE') AS trg_auth`,
    );
    expect(grants[0]).toEqual({ set_anon: false, sum_anon: false, trg_auth: false });
  });
});
