import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asServiceRole,
  createBookingLifecycleDb,
  IDS,
  queryRows,
  seedLifecycleBooking,
  tryAsAnon,
  tryAsUser,
} from "./booking-lifecycle.harness";

/** Provider education, experience and certificates (migration 20261128150500). */
let db: PGlite;

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  await seedLifecycleBooking(db);
}, 180_000);

afterAll(async () => {
  await db?.close();
});

const P = IDS.provider;
const OTHER = IDS.otherProviderUser;

async function publicCreds(): Promise<{
  education: unknown[];
  experience: unknown[];
  certificates: { title: string }[];
}> {
  const rows = await queryRows<{ c: never }>(db, `SELECT public.public_provider_credentials($1) AS c`, [P]);
  return rows[0].c;
}

describe("provider credentials", () => {
  it("the provider adds education and experience to their own profile", async () => {
    const edu = await tryAsUser(
      db,
      IDS.providerUser,
      `INSERT INTO public.provider_education (provider_id, institution, degree, start_year, end_year)
       VALUES ($1, 'جامعة عين شمس', 'بكالوريوس', 2014, 2018) RETURNING id`,
      [P],
    );
    expect(edu.ok, edu.error).toBe(true);
    const exp = await tryAsUser(
      db,
      IDS.providerUser,
      `INSERT INTO public.provider_work_experience (provider_id, role_title, place, start_year, is_current)
       VALUES ($1, 'مدرس إنجليزي', 'مدرسة النصر', 2019, true) RETURNING id`,
      [P],
    );
    expect(exp.ok, exp.error).toBe(true);
  });

  it("another provider can neither add to nor read this profile", async () => {
    const insert = await tryAsUser(
      db,
      OTHER,
      `INSERT INTO public.provider_education (provider_id, institution, degree) VALUES ($1, 'X Uni', 'BA')`,
      [P],
    );
    expect(insert.ok).toBe(false);
    const read = await tryAsUser(db, OTHER, `SELECT id FROM public.provider_education WHERE provider_id = $1`, [P]);
    expect(read.ok).toBe(true);
    expect(read.rows).toHaveLength(0);
  });

  it("anon cannot read the tables directly", async () => {
    const r = await tryAsAnon(db, `SELECT * FROM public.provider_certificates`);
    expect(r.ok).toBe(false);
  });

  it("a certificate file must sit in the provider's folder and starts pending", async () => {
    const outside = await tryAsUser(
      db,
      IDS.providerUser,
      `INSERT INTO public.provider_certificates (provider_id, title, issuer, file_path)
       VALUES ($1, 'TEFL', 'British Council', 'someone-else/certificate/a.pdf')`,
      [P],
    );
    expect(outside.ok).toBe(false);
    expect(outside.error).toContain("CREDENTIAL_FILE_OUTSIDE_PROVIDER_FOLDER");

    const forged = await tryAsUser(
      db,
      IDS.providerUser,
      `INSERT INTO public.provider_certificates (provider_id, title, issuer, file_path, status)
       VALUES ($1, 'TEFL', 'British Council', $2, 'verified') RETURNING status`,
      [P, `${P}/certificate/a.pdf`],
    );
    expect(forged.ok, forged.error).toBe(true);
    expect(forged.rows?.[0]?.status).toBe("pending");
  });

  it("the public sees nothing while the provider is not active", async () => {
    await asServiceRole(db, () =>
      db.query(`UPDATE public.providers SET is_active = false WHERE id = $1`, [P]),
    );
    const c = await publicCreds();
    expect(c.education).toEqual([]);
    expect(c.certificates).toEqual([]);
  });

  it("only admins review; the public sees verified certificates only", async () => {
    const status = await queryRows<{ s: string }>(
      db,
      `SELECT onboarding_status AS s FROM public.providers WHERE id = $1`,
      [P],
    );
    expect(status[0].s).toBe("APPROVED");
    await asServiceRole(db, () =>
      db.query(`UPDATE public.providers SET is_active = true WHERE id = $1`, [P]),
    );
    let c = await publicCreds();
    expect(c.education).toHaveLength(1);
    expect(c.experience).toHaveLength(1);
    expect(c.certificates).toHaveLength(0);

    const certId = (
      await queryRows<{ id: string }>(db, `SELECT id FROM public.provider_certificates WHERE provider_id = $1`, [P])
    )[0].id;

    const notAdmin = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.admin_review_provider_certificate($1, 'verified', NULL)`,
      [certId],
    );
    expect(notAdmin.ok).toBe(false);
    expect(notAdmin.error).toContain("ADMIN_ONLY");

    const noReason = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_review_provider_certificate($1, 'rejected', ' ')`,
      [certId],
    );
    expect(noReason.ok).toBe(false);
    expect(noReason.error).toContain("CERTIFICATE_REJECT_REASON_REQUIRED");

    const verified = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT (public.admin_review_provider_certificate($1, 'verified', NULL)).status AS status`,
      [certId],
    );
    expect(verified.ok, verified.error).toBe(true);
    expect(verified.rows?.[0]?.status).toBe("verified");

    c = await publicCreds();
    expect(c.certificates.map((x) => x.title)).toEqual(["TEFL"]);
    expect(JSON.stringify(c)).not.toContain("file_path");
    expect(JSON.stringify(c)).not.toContain("certificate/a.pdf");
  });

  it("anon can call the public RPC", async () => {
    const r = await tryAsAnon(db, `SELECT public.public_provider_credentials($1)`, [P]);
    expect(r.ok, r.error).toBe(true);
  });

  it("the provider cannot keep «verified» while changing the certificate", async () => {
    const touched = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.provider_certificates SET title = 'TEFL Level 5', status = 'verified'
       WHERE provider_id = $1 RETURNING status`,
      [P],
    );
    expect(touched.ok, touched.error).toBe(true);
    expect(touched.rows?.[0]?.status).toBe("pending");
    const c = await publicCreds();
    expect(c.certificates).toHaveLength(0);
  });

  it("stops at 15 rows per section", async () => {
    for (let i = 0; i < 14; i++) {
      const r = await tryAsUser(
        db,
        IDS.providerUser,
        `INSERT INTO public.provider_education (provider_id, institution, degree) VALUES ($1, $2, 'دبلوم')`,
        [P, `معهد ${i + 1}`],
      );
      expect(r.ok, r.error).toBe(true);
    }
    const over = await tryAsUser(
      db,
      IDS.providerUser,
      `INSERT INTO public.provider_education (provider_id, institution, degree) VALUES ($1, 'معهد زيادة', 'دبلوم')`,
      [P],
    );
    expect(over.ok).toBe(false);
    expect(over.error).toContain("CREDENTIAL_LIMIT_REACHED");
  });

  it("internal trigger functions are not callable by app roles", async () => {
    const rows = await queryRows<{ fn: string; anon: boolean; auth: boolean }>(
      db,
      `SELECT p.proname AS fn,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname IN ('tg_provider_credential_guard', 'tg_provider_credential_limit')`,
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.anon).toBe(false);
      expect(r.auth).toBe(false);
    }
  });
});
