import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readMigration } from "./monitoring-privilege-harness";
import {
  CLOSED_BETA_MIGRATION,
  createClosedBetaGatesDb,
  runSqlExpectError,
  seedCategoryService,
  seedEligibleProvider,
} from "./closed-beta-gates.harness";

describe("closed beta marketplace and booking gates", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("keeps PR #67-owned function bodies additive-only in the migration", () => {
    const sql = readMigration(CLOSED_BETA_MIGRATION);
    expect(sql).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.marketplace_eligibility_internal\s*\(/i,
    );
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.tg_validate_booking_service\s*\(/i);
    expect(sql).toContain("trg_closed_beta_booking_gate");
    expect(sql).toContain("assert_babysitting_requires_owned_child");
  });

  it("rejects out-of-scope services via assert_closed_beta_service_bookable", async () => {
    db = await createClosedBetaGatesDb();
    const tutoring = await seedCategoryService(db, "tutoring", "homework-support");
    const cleaning = await seedCategoryService(db, "home-cleaning", "deep-clean");

    await expect(
      db.query(`SELECT public.assert_closed_beta_service_bookable($1::uuid)`, [tutoring.serviceId]),
    ).resolves.toBeDefined();

    await runSqlExpectError(
      db,
      `SELECT public.assert_closed_beta_service_bookable($1::uuid)`,
      [cleaning.serviceId],
      /BOOKING_SERVICE_UNAVAILABLE.*closed beta/i,
    );
  });

  it("requires an owned child for babysitting but allows tutoring without family_member_id", async () => {
    db = await createClosedBetaGatesDb();
    const babysitting = await seedCategoryService(db, "babysitting", "evening-care");
    const tutoring = await seedCategoryService(db, "tutoring", "math-tutor");
    const childId = "00000000-0000-0000-0000-0000000000aa";

    await runSqlExpectError(
      db,
      `SELECT public.assert_babysitting_requires_owned_child($1::uuid, NULL::uuid)`,
      [babysitting.serviceId],
      /Babysitting requires an owned child family member/i,
    );

    await expect(
      db.query(`SELECT public.assert_babysitting_requires_owned_child($1::uuid, $2::uuid)`, [
        babysitting.serviceId,
        childId,
      ]),
    ).resolves.toBeDefined();

    await expect(
      db.query(`SELECT public.assert_babysitting_requires_owned_child($1::uuid, NULL::uuid)`, [
        tutoring.serviceId,
      ]),
    ).resolves.toBeDefined();
  });

  it("enforces closed-beta booking gates through the bookings trigger", async () => {
    db = await createClosedBetaGatesDb();
    const babysitting = await seedCategoryService(db, "babysitting", "weekend-care");
    const tutoring = await seedCategoryService(db, "tutoring", "reading-help");
    const cleaning = await seedCategoryService(db, "home-cleaning", "standard-clean");
    const childId = "00000000-0000-0000-0000-0000000000bb";

    await expect(
      db.query(`INSERT INTO public.bookings (service_id) VALUES ($1::uuid)`, [tutoring.serviceId]),
    ).resolves.toBeDefined();

    await expect(
      db.query(
        `INSERT INTO public.bookings (service_id, family_member_id) VALUES ($1::uuid, $2::uuid)`,
        [babysitting.serviceId, childId],
      ),
    ).resolves.toBeDefined();

    await runSqlExpectError(
      db,
      `INSERT INTO public.bookings (service_id) VALUES ($1::uuid)`,
      [babysitting.serviceId],
      /Babysitting requires an owned child family member/i,
    );

    await runSqlExpectError(
      db,
      `INSERT INTO public.bookings (service_id) VALUES ($1::uuid)`,
      [cleaning.serviceId],
      /closed beta/i,
    );
  });

  it("filters search_marketplace_providers to babysitting and tutoring only", async () => {
    db = await createClosedBetaGatesDb();
    const customerId = "00000000-0000-0000-0000-000000000001";
    const addressId = "00000000-0000-0000-0000-000000000002";

    await db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'customer')`, [
      customerId,
    ]);
    await db.query(
      `
        INSERT INTO public.addresses (id, user_id, is_default)
        VALUES ($1, $2, true)
      `,
      [addressId, customerId],
    );

    const tutoring = await seedCategoryService(db, "tutoring", "science-tutor");
    const babysitting = await seedCategoryService(db, "babysitting", "after-school");
    const cleaning = await seedCategoryService(db, "home-cleaning", "move-out-clean");

    const tutoringProviderId = await seedEligibleProvider(
      db,
      "00000000-0000-0000-0000-000000000010",
      "Tutor Provider",
      tutoring.serviceId,
    );
    const babysittingProviderId = await seedEligibleProvider(
      db,
      "00000000-0000-0000-0000-000000000011",
      "Babysitter Provider",
      babysitting.serviceId,
    );
    const cleaningProviderId = await seedEligibleProvider(
      db,
      "00000000-0000-0000-0000-000000000012",
      "Cleaning Provider",
      cleaning.serviceId,
    );

    await db.exec("BEGIN");
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [customerId]);
    const rows = await db.query<{ category_slug: string; full_name: string }>(
      `SELECT category_slug, full_name FROM public.search_marketplace_providers(NULL, $1::uuid)`,
      [addressId],
    );
    await db.exec("ROLLBACK");

    const slugs = rows.rows.map((row) => row.category_slug).sort();
    expect(slugs).toEqual(["babysitting", "tutoring"]);
    expect(rows.rows.some((row) => row.full_name === "Cleaning Provider")).toBe(false);
    expect(new Set(rows.rows.map((row) => row.full_name))).toEqual(
      new Set(["Tutor Provider", "Babysitter Provider"]),
    );
    expect([tutoring.serviceId, babysitting.serviceId, cleaning.serviceId].length).toBe(3);
    expect([tutoringProviderId, babysittingProviderId, cleaningProviderId].length).toBe(3);
  });
});
