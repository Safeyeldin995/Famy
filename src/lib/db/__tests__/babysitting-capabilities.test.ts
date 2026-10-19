import { afterEach, describe, expect, it } from "vitest";
import {
  applyBabysittingMigration,
  applySupabaseDefaultPrivileges,
  asUser,
  BABYSITTING_MIGRATION,
  BOOKING_START,
  createDisposableDb,
  functionExecuteAllowed,
  grantPermissiveTableAcls,
  IDS,
  insertBooking,
  publicTablePrivileges,
  queryRows,
  readMigration,
  seedIdentities,
  tablePrivilegeMatrix,
  tryAsUser,
  type PrivilegeRow,
} from "./babysitting-capabilities-harness";
import type { PGlite } from "@electric-sql/pglite";

const MUTATION_PRIVILEGES = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;

function allowedMap(rows: PrivilegeRow[], grantee: string): Record<string, boolean> {
  return Object.fromEntries(
    rows.filter((row) => row.grantee === grantee).map((row) => [row.privilege, row.allowed]),
  );
}

async function attachBookingTrigger(db: PGlite): Promise<void> {
  await db.exec(`
    DROP TRIGGER IF EXISTS trg_validate_booking_service ON public.bookings;
    CREATE TRIGGER trg_validate_booking_service
      BEFORE INSERT ON public.bookings
      FOR EACH ROW EXECUTE FUNCTION public.tg_validate_booking_service();
  `);
}

async function readyDb(): Promise<PGlite> {
  const db = await createDisposableDb();
  await applySupabaseDefaultPrivileges(db);
  await applyBabysittingMigration(db);
  await seedIdentities(db);
  await attachBookingTrigger(db);
  return db;
}

describe("babysitting capabilities phase A", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("does not add client catalogue writes or guessed backfill aliases", () => {
    const sql = readMigration(BABYSITTING_MIGRATION);
    expect(sql).toContain(
      "REVOKE ALL PRIVILEGES ON TABLE public.child_age_groups FROM PUBLIC, anon, authenticated",
    );
    expect(sql).toContain("GRANT SELECT ON TABLE public.child_age_groups TO anon, authenticated");
    expect(sql).not.toMatch(/GRANT\s+INSERT.*child_age_groups/i);
    expect(sql).toContain("WHEN 'school'     THEN 'school_age'");
    expect(sql).not.toMatch(/WHEN 'baby'/);
    expect(sql).not.toMatch(/WHEN 'teen'/);
    expect(sql).toMatch(/v_n <> 6 OR v_first IS DISTINCT FROM 0 OR v_last IS DISTINCT FROM 215/);
    expect(sql).not.toMatch(/ALTER\s+DEFAULT\s+PRIVILEGES/i);
    expect(sql).toContain("PERFORM public.assert_babysitting_booking_eligible");
  });

  it("hardens privileges under permissive defaults and stays idempotent", async () => {
    db = await createDisposableDb();
    await applySupabaseDefaultPrivileges(db);
    await applyBabysittingMigration(db);
    await grantPermissiveTableAcls(db, "child_age_groups");
    await grantPermissiveTableAcls(db, "provider_age_group_capabilities");
    await applyBabysittingMigration(db);

    const catalogue = allowedMap(
      await tablePrivilegeMatrix(db, "child_age_groups"),
      "authenticated",
    );
    expect(catalogue.SELECT).toBe(true);
    for (const privilege of MUTATION_PRIVILEGES) {
      expect(catalogue[privilege], `authenticated ${privilege} on catalogue`).toBe(false);
    }
    expect(allowedMap(await tablePrivilegeMatrix(db, "child_age_groups"), "anon").TRUNCATE).toBe(
      false,
    );
    expect(allowedMap(await tablePrivilegeMatrix(db, "child_age_groups"), "anon").SELECT).toBe(
      true,
    );

    const claims = allowedMap(
      await tablePrivilegeMatrix(db, "provider_age_group_capabilities"),
      "authenticated",
    );
    expect(claims).toEqual({
      SELECT: true,
      INSERT: true,
      UPDATE: true,
      DELETE: true,
      TRUNCATE: false,
      REFERENCES: false,
      TRIGGER: false,
    });
    expect(
      allowedMap(await tablePrivilegeMatrix(db, "provider_age_group_capabilities"), "anon").SELECT,
    ).toBe(false);
    expect(
      allowedMap(await tablePrivilegeMatrix(db, "provider_age_group_capabilities"), "service_role")
        .TRUNCATE,
    ).toBe(true);

    expect(await publicTablePrivileges(db, "child_age_groups")).toEqual([]);
    expect(await publicTablePrivileges(db, "provider_age_group_capabilities")).toEqual([]);

    expect(
      await functionExecuteAllowed(
        db,
        "authenticated",
        "public.provider_supports_children(uuid, text[], integer)",
      ),
    ).toBe(false);
    expect(
      await functionExecuteAllowed(
        db,
        "anon",
        "public.provider_supports_children(uuid, text[], integer)",
      ),
    ).toBe(false);
    expect(
      await functionExecuteAllowed(
        db,
        "authenticated",
        "public.assert_babysitting_booking_eligible(uuid, uuid, uuid, uuid, timestamp with time zone)",
      ),
    ).toBe(false);
  });

  it("maps 0-215 months onto the six seeded bands and skips unproven aliases", async () => {
    db = await readyDb();

    const mapped = await queryRows<{ months: number; code: string | null }>(
      db,
      `
        SELECT m AS months, public.child_age_group_for_months(m) AS code
        FROM generate_series(0, 216) AS m
      `,
    );
    const byMonth = Object.fromEntries(mapped.map((row) => [row.months, row.code]));
    expect(byMonth[0]).toBe("newborn");
    expect(byMonth[2]).toBe("newborn");
    expect(byMonth[3]).toBe("infant");
    expect(byMonth[11]).toBe("infant");
    expect(byMonth[12]).toBe("toddler");
    expect(byMonth[35]).toBe("toddler");
    expect(byMonth[36]).toBe("preschool");
    expect(byMonth[71]).toBe("preschool");
    expect(byMonth[72]).toBe("school_age");
    expect(byMonth[155]).toBe("school_age");
    expect(byMonth[156]).toBe("teenager");
    expect(byMonth[215]).toBe("teenager");
    expect(byMonth[216]).toBeNull();
    expect(mapped.filter((row) => row.months <= 215 && row.code == null)).toEqual([]);

    await db.exec(`
      INSERT INTO public.provider_onboarding_details (provider_id, child_age_groups)
      VALUES ('${IDS.provider}', ARRAY['school', 'baby', 'teen', 'banana', 'toddler'])
    `);
    await applyBabysittingMigration(db);
    const codes = await queryRows<{ age_group_code: string }>(
      db,
      `SELECT age_group_code FROM public.provider_age_group_capabilities
       WHERE provider_id = $1 ORDER BY 1`,
      [IDS.provider],
    );
    expect(codes.map((row) => row.age_group_code)).toEqual(["school_age", "toddler"]);
  });

  it("keeps claim ownership on the owner and verification on a non-owner admin", async () => {
    db = await readyDb();

    const ownerInsert = await tryAsUser(
      db,
      IDS.providerUser,
      `INSERT INTO public.provider_age_group_capabilities (provider_id, age_group_code, years_experience, note)
       VALUES ($1, 'toddler', 3, 'own claim') RETURNING id`,
      [IDS.provider],
    );
    expect(ownerInsert.ok).toBe(true);
    const claimId = ownerInsert.rows?.[0]?.id as string;

    const otherInsert = await tryAsUser(
      db,
      IDS.otherProviderUser,
      `INSERT INTO public.provider_age_group_capabilities (provider_id, age_group_code)
       VALUES ($1, 'infant')`,
      [IDS.provider],
    );
    expect(otherInsert.ok).toBe(false);

    const adminContent = await tryAsUser(
      db,
      IDS.adminUser,
      `INSERT INTO public.provider_age_group_capabilities (provider_id, age_group_code)
       VALUES ($1, 'infant')`,
      [IDS.provider],
    );
    expect(adminContent.ok).toBe(false);

    const ownerVerify = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.provider_age_group_capabilities
       SET verified_at = now(), verified_by = $2 WHERE id = $1`,
      [claimId, IDS.providerUser],
    );
    expect(ownerVerify.ok).toBe(false);
    expect(ownerVerify.error ?? "").toMatch(/admin-only|cannot verify/i);

    const combinedOwner = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.provider_age_group_capabilities
       SET age_group_code = 'infant', verified_at = now() WHERE id = $1`,
      [claimId],
    );
    expect(combinedOwner.ok).toBe(false);

    const adminVerify = await tryAsUser(
      db,
      IDS.adminUser,
      `UPDATE public.provider_age_group_capabilities
       SET verified_at = now(), verified_by = $2 WHERE id = $1`,
      [claimId, IDS.adminUser],
    );
    expect(adminVerify.ok).toBe(true);

    const ownerEditVerified = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.provider_age_group_capabilities SET years_experience = 9 WHERE id = $1`,
      [claimId],
    );
    expect(ownerEditVerified.ok).toBe(false);

    const ownerRetarget = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.provider_age_group_capabilities SET age_group_code = 'infant' WHERE id = $1`,
      [claimId],
    );
    expect(ownerRetarget.ok).toBe(false);

    const adminSmuggle = await tryAsUser(
      db,
      IDS.adminUser,
      `UPDATE public.provider_age_group_capabilities
       SET years_experience = 12, verified_at = now() WHERE id = $1`,
      [claimId],
    );
    expect(adminSmuggle.ok).toBe(false);

    const reassign = await tryAsUser(
      db,
      IDS.adminUser,
      `UPDATE public.provider_age_group_capabilities SET provider_id = $2 WHERE id = $1`,
      [claimId, IDS.otherProvider],
    );
    expect(reassign.ok).toBe(false);

    const deleteVerified = await tryAsUser(
      db,
      IDS.providerUser,
      `DELETE FROM public.provider_age_group_capabilities WHERE id = $1`,
      [claimId],
    );
    expect(deleteVerified.ok).toBe(false);

    const customerRead = await tryAsUser(
      db,
      IDS.customer,
      `SELECT note, verified_by FROM public.provider_age_group_capabilities WHERE id = $1`,
      [claimId],
    );
    expect(customerRead.rows ?? []).toEqual([]);

    const ownerRead = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT note FROM public.provider_age_group_capabilities WHERE id = $1`,
      [claimId],
    );
    expect(ownerRead.rows?.[0]?.note).toBe("own claim");
  });

  it("lets a provider-admin edit own unverified claims but never self-verify", async () => {
    db = await readyDb();

    const insert = await tryAsUser(
      db,
      IDS.providerAdminUser,
      `INSERT INTO public.provider_age_group_capabilities (provider_id, age_group_code, years_experience)
       VALUES ($1, 'toddler', 1) RETURNING id`,
      [IDS.providerAdminProvider],
    );
    expect(insert.ok).toBe(true);
    const ownId = insert.rows?.[0]?.id as string;

    const editOwn = await tryAsUser(
      db,
      IDS.providerAdminUser,
      `UPDATE public.provider_age_group_capabilities SET years_experience = 2 WHERE id = $1`,
      [ownId],
    );
    expect(editOwn.ok).toBe(true);

    const selfVerify = await tryAsUser(
      db,
      IDS.providerAdminUser,
      `UPDATE public.provider_age_group_capabilities
       SET verified_at = now(), verified_by = $2 WHERE id = $1`,
      [ownId, IDS.providerAdminUser],
    );
    expect(selfVerify.ok).toBe(false);
    expect(selfVerify.error ?? "").toMatch(/cannot verify their own/i);

    const insertWithVerify = await tryAsUser(
      db,
      IDS.providerAdminUser,
      `INSERT INTO public.provider_age_group_capabilities
         (provider_id, age_group_code, verified_at, verified_by)
       VALUES ($1, 'infant', now(), $2)`,
      [IDS.providerAdminProvider, IDS.providerAdminUser],
    );
    expect(insertWithVerify.ok).toBe(false);

    const otherClaim = await tryAsUser(
      db,
      IDS.providerUser,
      `INSERT INTO public.provider_age_group_capabilities (provider_id, age_group_code)
       VALUES ($1, 'preschool') RETURNING id`,
      [IDS.provider],
    );
    expect(otherClaim.ok).toBe(true);
    const otherId = otherClaim.rows?.[0]?.id as string;

    const verifyOther = await tryAsUser(
      db,
      IDS.providerAdminUser,
      `UPDATE public.provider_age_group_capabilities
       SET verified_at = now(), verified_by = $2 WHERE id = $1`,
      [otherId, IDS.providerAdminUser],
    );
    expect(verifyOther.ok).toBe(true);

    const contentOnOther = await tryAsUser(
      db,
      IDS.providerAdminUser,
      `UPDATE public.provider_age_group_capabilities SET note = 'nope' WHERE id = $1`,
      [otherId],
    );
    expect(contentOnOther.ok).toBe(false);

    await db.exec(
      `UPDATE public.providers SET onboarding_status = 'NEEDS_CHANGES' WHERE id = '${IDS.provider}'`,
    );
    const needsChangesEdit = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.provider_age_group_capabilities SET years_experience = 4 WHERE id = $1`,
      [otherId],
    );
    expect(needsChangesEdit.ok).toBe(false);

    const clearVerify = await tryAsUser(
      db,
      IDS.adminUser,
      `UPDATE public.provider_age_group_capabilities
       SET verified_at = NULL, verified_by = NULL WHERE id = $1`,
      [otherId],
    );
    expect(clearVerify.ok).toBe(true);

    const afterClear = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.provider_age_group_capabilities SET years_experience = 4 WHERE id = $1`,
      [otherId],
    );
    expect(afterClear.ok).toBe(true);

    const recreateDelete = await tryAsUser(
      db,
      IDS.providerAdminUser,
      `DELETE FROM public.provider_age_group_capabilities WHERE id = $1`,
      [ownId],
    );
    expect(recreateDelete.ok).toBe(true);
    const recreate = await tryAsUser(
      db,
      IDS.providerAdminUser,
      `INSERT INTO public.provider_age_group_capabilities (provider_id, age_group_code)
       VALUES ($1, 'toddler') RETURNING verified_at`,
      [IDS.providerAdminProvider],
    );
    expect(recreate.ok).toBe(true);
    expect(recreate.rows?.[0]?.verified_at).toBeNull();
  });

  it("enforces one owned child on the authoritative babysitting booking hook", async () => {
    db = await readyDb();
    await db.exec(`
      UPDATE public.providers
      SET max_children_per_booking = 2, onboarding_status = 'APPROVED'
      WHERE id = '${IDS.provider}';
      INSERT INTO public.provider_age_group_capabilities (provider_id, age_group_code)
      VALUES ('${IDS.provider}', 'toddler');
    `);

    const cleaning = await insertBooking(db, {
      serviceId: IDS.cleaningService,
      familyMemberId: null,
    });
    expect(cleaning.ok).toBe(true);

    const myself = await insertBooking(db, {
      serviceId: IDS.babysittingService,
      familyMemberId: null,
    });
    expect(myself.ok).toBe(false);
    expect(myself.error ?? "").toMatch(/BOOKING_INVALID_BOOKING_REQUEST/);

    const inactive = await insertBooking(db, {
      serviceId: IDS.babysittingService,
      familyMemberId: IDS.inactiveMember,
    });
    expect(inactive.ok).toBe(false);

    const stolen = await insertBooking(db, {
      serviceId: IDS.babysittingService,
      familyMemberId: IDS.otherChild,
    });
    expect(stolen.ok).toBe(false);
    expect(stolen.error ?? "").toMatch(/BOOKING_UNAUTHORIZED/);

    const unsupported = await insertBooking(db, {
      serviceId: IDS.babysittingService,
      familyMemberId: IDS.teenMember,
    });
    expect(unsupported.ok).toBe(false);
    expect(unsupported.error ?? "").toMatch(/BOOKING_PROVIDER_INELIGIBLE/);

    const tooOld = await insertBooking(db, {
      serviceId: IDS.babysittingService,
      familyMemberId: IDS.tooOldMember,
    });
    expect(tooOld.ok).toBe(false);
    expect(tooOld.error ?? "").toMatch(/0-215/);

    const futureDob = await insertBooking(db, {
      serviceId: IDS.babysittingService,
      familyMemberId: IDS.futureMember,
    });
    expect(futureDob.ok).toBe(false);
    expect(futureDob.error ?? "").toMatch(/future/i);

    const ok = await insertBooking(db, {
      serviceId: IDS.babysittingService,
      familyMemberId: IDS.childMember,
    });
    expect(ok.ok).toBe(true);

    await db.exec(
      `UPDATE public.providers SET max_children_per_booking = NULL WHERE id = '${IDS.provider}'`,
    );
    const undeclared = await insertBooking(db, {
      serviceId: IDS.babysittingService,
      familyMemberId: IDS.childMember,
    });
    expect(undeclared.ok).toBe(false);
    expect(undeclared.error ?? "").toMatch(/BOOKING_PROVIDER_INELIGIBLE/);

    const oracle = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.provider_supports_children($1, ARRAY['toddler'], 1)`,
      [IDS.provider],
    );
    expect(oracle.ok).toBe(false);
  });

  it("derives age at booking start from the owned date of birth, not caller groups", async () => {
    db = await readyDb();
    await db.exec(`
      UPDATE public.providers SET max_children_per_booking = 1 WHERE id = '${IDS.provider}';
      INSERT INTO public.provider_age_group_capabilities (provider_id, age_group_code)
      VALUES ('${IDS.provider}', 'newborn');
    `);

    const months = await queryRows<{ months: number; code: string | null }>(
      db,
      `
        SELECT
          (EXTRACT(YEAR FROM age($1::date, date_of_birth)) * 12
           + EXTRACT(MONTH FROM age($1::date, date_of_birth)))::int AS months,
          public.child_age_group_for_months(
            (EXTRACT(YEAR FROM age($1::date, date_of_birth)) * 12
             + EXTRACT(MONTH FROM age($1::date, date_of_birth)))::int
          ) AS code
        FROM public.family_members WHERE id = $2
      `,
      [BOOKING_START, IDS.childMember],
    );
    expect(months[0]?.code).toBe("toddler");

    const mismatch = await insertBooking(db, {
      serviceId: IDS.babysittingService,
      familyMemberId: IDS.childMember,
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.error ?? "").toMatch(/does not support this child age group/);
  });

  it("blocks catalogue writes from authenticated clients", async () => {
    db = await readyDb();
    const write = await tryAsUser(
      db,
      IDS.adminUser,
      `UPDATE public.child_age_groups SET min_months = 1 WHERE code = 'newborn'`,
    );
    expect(write.ok).toBe(false);
    expect(write.error ?? "").toMatch(/permission denied/i);

    const read = await asUser(db, IDS.customer, async () =>
      queryRows<{ code: string }>(
        db!,
        `SELECT code FROM public.child_age_groups ORDER BY sort_order`,
      ),
    );
    expect(read.map((row) => row.code)).toEqual([
      "newborn",
      "infant",
      "toddler",
      "preschool",
      "school_age",
      "teenager",
    ]);
  });
});
