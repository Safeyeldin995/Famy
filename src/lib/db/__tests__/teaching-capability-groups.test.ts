import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigrationReplayDb, replayAllMigrations } from "./migration-replay.harness";
const user = "00000000-0000-0000-0000-000000001381";
const other = "00000000-0000-0000-0000-000000001382";
const admin = "00000000-0000-0000-0000-000000001383";
const provider = "00000000-0000-0000-0000-000000001384";
const provider2 = "00000000-0000-0000-0000-000000001385";
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
    INSERT INTO auth.users(id,raw_user_meta_data) VALUES ('${user}','{"signup_role":"provider"}'),('${other}','{"signup_role":"provider"}'),('${admin}','{}');
    INSERT INTO public.user_roles(user_id,role) VALUES ('${admin}','admin');
    INSERT INTO public.providers(id,profile_id,hourly_rate) VALUES ('${provider}','${user}',1),('${provider2}','${other}',1);
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
async function save(ids = levels, price = 400, uid = user) {
  return (
    await asUser<{ result: { ok: boolean; ids: string[] } }>(
      "SELECT public.provider_save_teaching_group($1,$2,$3,$4::uuid[],60,$5) AS result",
      [service, subject, curriculum, ids, price],
      uid,
    )
  )[0].result;
}
async function review(ids: string[], status = "approved", uid = admin) {
  return asUser(
    "SELECT public.admin_review_teaching_group($1::uuid[],$2,'Synthetic note')",
    [ids, status],
    uid,
  );
}
it("replays all migrations, creates N rows and removes only unchecked pending grades", async () => {
  const result = await save();
  expect(result.ok).toBe(true);
  expect(result.ids).toHaveLength(3);
  await save(levels.slice(0, 2));
  expect((await db.query("SELECT id FROM provider_teaching_capabilities")).rows).toHaveLength(2);
});
it("preserves approved rows unchanged whether checked or unchecked", async () => {
  const result = await save();
  await review([result.ids[0]]);
  const before = (
    await db.query("SELECT * FROM provider_teaching_capabilities WHERE id=$1", [result.ids[0]])
  ).rows[0];
  await save(levels, 500);
  await save([levels[1]], 600);
  expect(
    (await db.query("SELECT * FROM provider_teaching_capabilities WHERE id=$1", [result.ids[0]]))
      .rows[0],
  ).toEqual(before);
  expect((await db.query("SELECT id FROM provider_teaching_capabilities")).rows).toHaveLength(2);
});
it("rejects out-of-range price and rolls back partial group writes", async () => {
  await expect(save(levels, 1)).rejects.toThrow(/TEACHING_INVALID_PRICE/);
  expect((await db.query("SELECT id FROM provider_teaching_capabilities")).rows).toHaveLength(0);
  await expect(save([levels[0], "00000000-0000-0000-0000-000000009999"])).rejects.toThrow(
    /TEACHING_SUBJECT_NOT_LINKED/,
  );
  expect((await db.query("SELECT id FROM provider_teaching_capabilities")).rows).toHaveLength(0);
});
it("rejects empty, duplicate and null grades", async () => {
  for (const ids of [[], [levels[0], levels[0]]])
    await expect(save(ids)).rejects.toThrow(/TEACHING_INVALID_LEVELS/);
  await expect(
    asUser("SELECT public.provider_save_teaching_group($1,$2,$3,ARRAY[NULL]::uuid[],60,400)", [
      service,
      subject,
      curriculum,
    ]),
  ).rejects.toThrow(/TEACHING_INVALID_LEVELS/);
});
it("cannot write another provider's rows and requires the provider role", async () => {
  const mine = await save();
  await save([levels[0]], 500, other);
  expect(
    (
      await db.query<{ session_price: number }>(
        "SELECT session_price FROM provider_teaching_capabilities WHERE id=ANY($1::uuid[])",
        [mine.ids],
      )
    ).rows.every((r) => r.session_price === 400),
  ).toBe(true);
  await expect(save(levels, 400, admin)).rejects.toThrow(/Provider role required/);
});
it.each(["approved", "rejected"])(
  "reviews the whole group as %s with exactly one notification",
  async (status) => {
    const saved = await save();
    await review(saved.ids, status);
    const rows = (
      await db.query<{
        status: string;
        reviewed_by: string;
        review_note: string;
        reviewed_at: string;
      }>("SELECT status,reviewed_by,review_note,reviewed_at FROM provider_teaching_capabilities")
    ).rows;
    expect(rows).toHaveLength(3);
    expect(
      rows.every(
        (r) =>
          r.status === status &&
          r.reviewed_by === admin &&
          r.review_note === "Synthetic note" &&
          r.reviewed_at,
      ),
    ).toBe(true);
    const notices = (
      await db.query<{ payload: { capability_ids: string[] }; deep_link: string }>(
        "SELECT payload,deep_link FROM notifications WHERE type=$1",
        [`teaching_capability_${status}`],
      )
    ).rows;
    expect(notices).toHaveLength(1);
    expect(notices[0].payload.capability_ids).toEqual(saved.ids);
    expect(notices[0].deep_link).toBe("/pro/onboarding");
  },
);
it("rejects mixed-provider ids, missing ids, non-admin and self-review", async () => {
  const mine = await save();
  const theirs = await save(levels, 400, other);
  await expect(review([mine.ids[0], theirs.ids[0]])).rejects.toThrow(/one provider/);
  await expect(review([mine.ids[0], "00000000-0000-0000-0000-000000009999"])).rejects.toThrow(
    /must exist/,
  );
  await expect(review(mine.ids, "approved", user)).rejects.toThrow(/Admin role required/);
  await db.exec(`INSERT INTO public.user_roles(user_id,role) VALUES ('${user}','admin')`);
  await expect(review(mine.ids, "approved", user)).rejects.toThrow(/TEACHING_SELF_REVIEW/);
  expect(
    (
      await db.query<{ status: string }>("SELECT status FROM provider_teaching_capabilities")
    ).rows.every((r) => r.status === "pending"),
  ).toBe(true);
});
