import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigrationReplayDb, replayAllMigrations } from "./migration-replay.harness";
const user = "00000000-0000-0000-0000-000000001381";
const other = "00000000-0000-0000-0000-000000001382";
const admin = "00000000-0000-0000-0000-000000001383";
const provider = "00000000-0000-0000-0000-000000001384";
const service = "00000000-0000-0000-0000-000000001386";
let db: PGlite;
let subject: string, curriculum: string, levels: string[];
beforeAll(async () => {
  db = await createMigrationReplayDb();
  await replayAllMigrations(db);
  await db.exec(
    "ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb DEFAULT '{}'::jsonb",
  );
  subject = (await db.query<{ id: string }>("SELECT id FROM teaching_subjects WHERE code='math'"))
    .rows[0].id;
  curriculum = (
    await db.query<{ id: string }>("SELECT id FROM teaching_curricula WHERE code='eg_national_ar'")
  ).rows[0].id;
  levels = (
    await db.query<{ id: string }>(
      "SELECT id FROM teaching_levels WHERE is_active ORDER BY sort_order LIMIT 3",
    )
  ).rows.map((r) => r.id);
}, 30000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(`BEGIN;
    INSERT INTO auth.users(id,raw_user_meta_data) VALUES ('${user}','{"signup_role":"provider"}'),('${other}','{}'),('${admin}','{}');
    INSERT INTO public.user_roles(user_id,role) VALUES ('${admin}','admin');
    INSERT INTO public.providers(id,profile_id,hourly_rate) VALUES ('${provider}','${user}',1);
    INSERT INTO public.services(id,category_id,slug,name_en,name_ar,minimum_price,maximum_price,allowed_session_durations)
      SELECT '${service}',id,'synthetic-group-service','Synthetic group','خدمة تجريبية',300,1500,ARRAY[60,90,120] FROM public.categories WHERE slug='tutoring';
    INSERT INTO public.teaching_subject_services(subject_id,service_id) VALUES ('${subject}','${service}');
  `);
});
afterEach(async () => {
  await db.exec("ROLLBACK");
});
async function asUser<T>(sql: string, values: unknown[], uid = user) {
  await db.exec("SAVEPOINT group_call");
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [uid]);
    await db.exec("SET LOCAL ROLE authenticated");
    const result = await db.query<T>(sql, values);
    await db.exec("RESET ROLE; RELEASE SAVEPOINT group_call");
    await db.query("SELECT set_config('request.jwt.claim.sub','',true)");
    return result.rows;
  } catch (error) {
    await db.exec("ROLLBACK TO SAVEPOINT group_call; RELEASE SAVEPOINT group_call");
    throw error;
  }
}
async function save(ids = levels, price = 400) {
  return (
    await asUser<{ result: { ok: boolean; ids: string[] } }>(
      "SELECT public.provider_save_teaching_group($1,$2,$3,$4::uuid[],60,$5) AS result",
      [service, subject, curriculum, ids, price],
    )
  )[0].result;
}
async function review(ids: string[], value = "approved", uid = admin) {
  return asUser(
    "SELECT public.admin_review_teaching_group($1::uuid[],$2,'Synthetic private note')",
    [ids, value],
    uid,
  );
}
async function status(value: "SUBMITTED" | "UNDER_REVIEW" | "APPROVED") {
  await db.query("SELECT set_config('app.onboarding_status_transition','1',true)");
  await db.query("UPDATE providers SET onboarding_status=$1 WHERE id=$2", [value, provider]);
  await db.query("SELECT set_config('app.onboarding_status_transition','',true)");
}
it("emits one pending notice for a multi-grade save and none for an unchanged retry", async () => {
  const saved = await save();
  await save();
  const notices = (
    await db.query<{ payload: { capability_ids: string[] }; body_ar: string }>(
      "SELECT payload,body_ar FROM notifications WHERE type='teaching_capability_pending'",
    )
  ).rows;
  expect(notices).toHaveLength(1);
  expect(notices[0].payload.capability_ids).toEqual(saved.ids);
  expect(notices[0].body_ar).toContain("بنراجع المادة");
  await save(levels, 500);
  expect(
    (await db.query("SELECT id FROM notifications WHERE type='teaching_capability_pending'")).rows,
  ).toHaveLength(2);
});
it("groups approval notices during application review without changing approved grades", async () => {
  const saved = await save();
  await status("SUBMITTED");
  await review(saved.ids);
  expect(
    (await db.query("SELECT id FROM notifications WHERE type='teaching_capability_approved'")).rows,
  ).toHaveLength(0);
  const approved = (await db.query("SELECT * FROM provider_teaching_capabilities ORDER BY id"))
    .rows;
  await save([levels[0]], 600);
  expect((await db.query("SELECT * FROM provider_teaching_capabilities ORDER BY id")).rows).toEqual(
    approved,
  );
});
it("sends one localized post-approval group notice and rejects self-review", async () => {
  const saved = await save();
  await status("APPROVED");
  await review(saved.ids);
  await review(saved.ids);
  const notices = (
    await db.query<{ body_ar: string; body_en: string }>(
      "SELECT body_ar,body_en FROM notifications WHERE type='teaching_capability_approved'",
    )
  ).rows;
  expect(notices).toHaveLength(1);
  expect(notices[0].body_ar).toContain("اتوافق");
  expect(notices[0].body_en).toContain("approved");
  await db.exec(`INSERT INTO user_roles(user_id,role) VALUES ('${user}','admin')`);
  await expect(review(saved.ids, "approved", user)).rejects.toThrow("TEACHING_SELF_REVIEW");
});
it("does not leak private rejection notes and retains RLS", async () => {
  const saved = await save();
  await review(saved.ids, "rejected");
  const notices = (
    await db.query("SELECT * FROM notifications WHERE type='teaching_capability_rejected'")
  ).rows;
  expect(notices).toHaveLength(1);
  expect(JSON.stringify(notices)).not.toContain("Synthetic private note");
  expect(await asUser("SELECT id FROM notifications WHERE user_id=$1", [user], other)).toEqual([]);
});
it("sends one application approval with Arabic service names after service and grade review", async () => {
  const saved = await save();
  const secondService = "00000000-0000-0000-0000-000000001387";
  await db.exec(`
    INSERT INTO services(id,category_id,slug,name_en,name_ar,minimum_price,maximum_price,allowed_session_durations)
      SELECT '${secondService}',category_id,'synthetic-second','English-only service name','خدمة تانية',300,1500,ARRAY[60] FROM services WHERE id='${service}';
    INSERT INTO provider_services(provider_id,service_id,status) VALUES ('${provider}','${service}','pending'),('${provider}','${secondService}','pending');
    UPDATE profiles SET full_name='Synthetic Provider',phone='synthetic-phone',avatar_url='synthetic/photo.png' WHERE id='${user}';
    UPDATE providers SET bio_ar='خبرة في التدريس',years_experience=4,languages=ARRAY['ar'] WHERE id='${provider}';
    INSERT INTO provider_onboarding_details(provider_id,date_of_birth,governorate,area,full_address,accuracy_confirmed_at) VALUES ('${provider}','1990-01-01','Test','Test','Synthetic address',now());
    INSERT INTO provider_references(provider_id,full_name,relationship,phone) VALUES ('${provider}','Synthetic Reference','work','01000001381');
    INSERT INTO zones(id,name_en,name_ar,center_lat,center_lng,radius_km) VALUES ('${secondService}','Synthetic zone','منطقة تجريبية',30,31,5);
    INSERT INTO zone_providers(provider_id,zone_id) VALUES ('${provider}','${secondService}');
    SELECT set_config('request.jwt.claim.sub','${admin}',true);
    INSERT INTO provider_documents(provider_id,type,storage_path,status) VALUES ('${provider}','id_card_front','synthetic/front','approved'),('${provider}','id_card_back','synthetic/back','approved');
    SELECT set_config('request.jwt.claim.sub','',true);
  `);
  await status("UNDER_REVIEW");
  const services = (
    await db.query<{ id: string }>("SELECT id FROM provider_services WHERE provider_id=$1", [
      provider,
    ])
  ).rows;
  expect(services).toHaveLength(2);
  for (const row of services)
    await asUser("SELECT admin_set_provider_service_status($1,'approved')", [row.id], admin);
  await review(saved.ids);
  expect(
    (
      await db.query(
        "SELECT id FROM notifications WHERE type IN ('provider_service_approved','teaching_capability_approved')",
      )
    ).rows,
  ).toHaveLength(0);
  await asUser("SELECT admin_provider_onboarding_action($1,'approve')", [provider], admin);
  const notices = (
    await db.query<{ title_ar: string; body_ar: string; body_en: string }>(
      "SELECT title_ar,body_ar,body_en FROM notifications WHERE type='provider_onboarding_approved'",
    )
  ).rows;
  expect(notices).toHaveLength(1);
  expect(notices[0].title_ar).toBe("اتوافق على طلبك! بقيت ظاهر للعملاء");
  expect(notices[0].body_ar).toContain("خدمة تجريبية");
  expect(notices[0].body_ar).toContain("خدمة تانية");
  expect(notices[0].body_ar).not.toContain("English-only");
  expect(notices[0].body_en).toContain("English-only service name");
});
it("retains application approval completeness and document gates", async () => {
  await status("SUBMITTED");
  await expect(
    asUser("SELECT admin_provider_onboarding_action($1,'approve')", [provider], admin),
  ).rejects.toThrow("incomplete");
  expect(
    (await db.query("SELECT id FROM notifications WHERE type='provider_onboarding_approved'")).rows,
  ).toHaveLength(0);
});
