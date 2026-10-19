import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigrationReplayDb, replayAllMigrations } from "./migration-replay.harness";
const user = "00000000-0000-0000-0000-000000001361";
const admin = "00000000-0000-0000-0000-000000001362";
const provider = "00000000-0000-0000-0000-000000001363";
const service = "00000000-0000-0000-0000-000000001364";
const zone = "00000000-0000-0000-0000-000000001365";
let db: PGlite;
beforeAll(async () => {
  db = await createMigrationReplayDb();
  await replayAllMigrations(db);
  await db.exec(
    "ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb DEFAULT '{}'::jsonb",
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(`BEGIN;
    INSERT INTO auth.users (id, raw_user_meta_data) VALUES ('${user}', '{"signup_role":"provider","full_name":"Synthetic Applicant"}'), ('${admin}', '{}');
    INSERT INTO public.user_roles(user_id,role) VALUES ('${admin}','admin');
    UPDATE public.profiles SET phone = 'synthetic-phone' WHERE id = '${user}';
    INSERT INTO public.providers(id,profile_id,hourly_rate,onboarding_status) VALUES ('${provider}','${user}',1,'DRAFT');
    INSERT INTO public.provider_onboarding_details(provider_id,accuracy_confirmed_at) VALUES ('${provider}',now());
    INSERT INTO public.services(id,category_id,slug,name_en,name_ar,provider_pricing_allowed,minimum_price,maximum_price)
      SELECT '${service}',id,'synthetic-apply-service','Synthetic service','خدمة تجريبية',true,100,500 FROM public.categories WHERE slug='babysitting';
    INSERT INTO public.provider_services(provider_id,service_id,status,price_override) VALUES ('${provider}','${service}','pending',250);
    INSERT INTO public.zones(id,name_en,name_ar,center_lat,center_lng,radius_km) VALUES ('${zone}','Synthetic zone','منطقة تجريبية',30,31,5);
    INSERT INTO public.zone_providers(provider_id,zone_id) VALUES ('${provider}','${zone}');
    INSERT INTO public.provider_documents(provider_id,type,storage_path) VALUES ('${provider}','id_card_front','synthetic/front.jpg'), ('${provider}','id_card_back','synthetic/back.jpg');
  `);
});
afterEach(async () => {
  await db.exec("ROLLBACK");
});
async function asUser<
  T = { result: { ok: boolean; complete: boolean; errors: Record<string, string> } },
>(sql: string, values: unknown[] = [], uid = user) {
  await db.exec("SAVEPOINT user_call");
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [uid]);
    await db.exec("SET LOCAL ROLE authenticated");
    const result = await db.query<T>(sql, values);
    await db.exec("RESET ROLE; RELEASE SAVEPOINT user_call");
    await db.query("SELECT set_config('request.jwt.claim.sub','',true)");
    return result.rows;
  } catch (error) {
    await db.exec("ROLLBACK TO SAVEPOINT user_call; RELEASE SAVEPOINT user_call");
    throw error;
  }
}
it("replays all migrations and accepts minimal submission without weakening approval", async () => {
  expect(
    (await asUser(`SELECT public.provider_onboarding_submittable('${provider}') AS result`))[0]
      .result.complete,
  ).toBe(true);
  expect((await asUser("SELECT public.provider_submit_onboarding() AS result"))[0].result.ok).toBe(
    true,
  );
  expect(
    (await asUser(`SELECT public.provider_onboarding_completion('${provider}') AS result`))[0]
      .result.complete,
  ).toBe(false);
  await expect(
    asUser(`SELECT public.admin_provider_onboarding_action('${provider}','approve')`, [], admin),
  ).rejects.toThrow(/incomplete/);
  const { rows } = await db.query(
    `SELECT onboarding_status,is_verified FROM public.providers WHERE id='${provider}'`,
  );
  expect(rows).toEqual([{ onboarding_status: "SUBMITTED", is_verified: false }]);
});
it.each(["SUBMITTED", "UNDER_REVIEW"])(
  "allows only deferred sections and profile photos in %s",
  async (status) => {
    await db.exec(
      `SELECT set_config('app.onboarding_status_transition','1',true); UPDATE public.providers SET onboarding_status='${status}' WHERE id='${provider}'; SELECT set_config('app.onboarding_status_transition','',true);`,
    );
    await asUser("SELECT public.provider_save_onboarding_section('personal',$1::jsonb)", [
      JSON.stringify({
        legal_name: "Must not replace reviewed name",
        date_of_birth: "1990-01-01",
        governorate: "Test",
        area: "Test",
        full_address: "Synthetic address",
      }),
    ]);
    await asUser("SELECT public.provider_save_onboarding_section('experience',$1::jsonb)", [
      JSON.stringify({
        bio_ar: "خبرة",
        years_experience: 2,
        max_children_per_booking: 2,
        age_group_capabilities: [{ code: "preschool" }],
      }),
    ]);
    await asUser("SELECT public.provider_save_onboarding_section('references',$1::jsonb)", [
      JSON.stringify({
        references: [
          { full_name: "Synthetic Reference", relationship: "Work", phone: "01000000136" },
        ],
      }),
    ]);
    await asUser(
      "SELECT public.provider_prepare_document_upload('profile_photo','image/jpeg',100)",
    );
    await asUser("SELECT public.provider_finalize_document_upload($1,'profile_photo')", [
      `${provider}/profile_photo-synthetic.jpg`,
    ]);
    await expect(
      asUser("SELECT public.provider_prepare_document_upload('id_card_front','image/jpeg',100)"),
    ).rejects.toThrow(/not editable/);
    await expect(
      asUser("SELECT public.provider_finalize_document_upload($1,'id_card_back')", [
        `${provider}/id_card_back-synthetic.jpg`,
      ]),
    ).rejects.toThrow(/not editable/);
    for (const section of ["coverage", "services", "review"])
      await expect(
        asUser("SELECT public.provider_save_onboarding_section($1,'{}')", [section]),
      ).rejects.toThrow(/not editable/);
    expect(
      (await db.query(`SELECT full_name FROM public.profiles WHERE id='${user}'`)).rows[0],
    ).toEqual({ full_name: "Synthetic Applicant" });
    expect(
      (
        await db.query(
          `SELECT max_children_per_booking FROM public.providers WHERE id='${provider}'`,
        )
      ).rows[0],
    ).toEqual({ max_children_per_booking: 2 });
    await expect(
      asUser(`UPDATE public.providers SET hourly_rate=400 WHERE id='${provider}'`),
    ).rejects.toThrow(/read-only/);
  },
);
it("preserves approved-provider locks and rejects other-user access", async () => {
  await db.exec(
    `SELECT set_config('app.onboarding_status_transition','1',true); UPDATE public.providers SET onboarding_status='APPROVED',is_verified=true WHERE id='${provider}'; SELECT set_config('app.onboarding_status_transition','',true);`,
  );
  await expect(
    asUser("SELECT public.provider_save_onboarding_section('personal','{}')"),
  ).rejects.toThrow(/not editable/);
  await expect(asUser("SELECT public.provider_submit_onboarding()")).rejects.toThrow(
    /cannot be submitted/,
  );
  await expect(
    asUser(
      `SELECT public.provider_onboarding_submittable('${provider}')`,
      [],
      "00000000-0000-0000-0000-000000001399",
    ),
  ).rejects.toThrow(/Access denied/);
});
it("rejects missing identity, zone, agreement, and invalid service prices", async () => {
  await db.exec(
    `DELETE FROM public.provider_documents WHERE provider_id='${provider}'; DELETE FROM public.zone_providers WHERE provider_id='${provider}'; UPDATE public.provider_onboarding_details SET accuracy_confirmed_at=NULL WHERE provider_id='${provider}'; UPDATE public.providers SET hourly_rate=0 WHERE id='${provider}'; UPDATE public.provider_services SET price_override=NULL WHERE provider_id='${provider}';`,
  );
  const result = (await asUser("SELECT public.provider_submit_onboarding() AS result"))[0].result;
  expect(result.ok).toBe(false);
  expect(result.errors).toMatchObject({
    documents: "national_id_required",
    coverage: "zone_required",
    review: "accuracy_confirmation_required",
    services: "provider_price_invalid",
  });
});
