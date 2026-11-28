/**
 * Lesson reports and learner progress (migration 20261128140000).
 * The tutor writes the report after a completed teaching lesson; the customer, the
 * linked parent of a self-booking student and admins read it; nobody else does.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  createBookingLifecycleDb,
  IDS,
  queryRows,
  seedLifecycleBooking,
  tryAsAnon,
  tryAsUser,
} from "./booking-lifecycle.harness";

const STRANGER_ID = "00000000-0000-0000-0000-00000000d201";
const PARENT_ID = "00000000-0000-0000-0000-00000000d202";

let db: PGlite;

async function serviceIdBySlug(slug: string): Promise<string> {
  const rows = await queryRows<{ id: string }>(
    db,
    `SELECT id FROM public.services WHERE slug = $1`,
    [slug],
  );
  if (!rows[0]) throw new Error(`missing service ${slug}`);
  return rows[0].id;
}

/** A completed booking turned into a teaching booking (triggers off: fixture only). */
async function seedTeachingBooking(opts: {
  slug: string;
  subjectCode: string | null;
  child: boolean;
  status?: string;
  endedHoursAgo?: number;
}): Promise<string> {
  const { bookingId } = await seedLifecycleBooking(db);
  const serviceId = await serviceIdBySlug(opts.slug);
  const ended = opts.endedHoursAgo ?? 2;
  await db.exec(`
    SET session_replication_role = replica;
    UPDATE public.bookings SET
      service_id = '${serviceId}',
      teaching_subject_code = ${opts.subjectCode ? `'${opts.subjectCode}'` : "NULL"},
      teaching_subject_name_ar = ${opts.subjectCode ? "'مادة'" : "NULL"},
      family_member_id = ${opts.child ? `'${IDS.childMember}'` : "NULL"},
      status = '${opts.status ?? "completed"}'::public.booking_status,
      start_at = now() - interval '${ended + 1} hours',
      end_at = now() - interval '${ended} hours',
      completed_at = now() - interval '${ended} hours'
    WHERE id = '${bookingId}';
    SET session_replication_role = origin;
  `);
  return bookingId;
}

function submit(userId: string, bookingId: string, extra: Record<string, unknown> = {}) {
  const args = {
    covered: "حفظنا أول عشر آيات",
    understanding: "good",
    homework: null,
    quran: [],
    instrument: null,
    level: null,
    piece: null,
    ...extra,
  };
  return tryAsUser(
    db,
    userId,
    `SELECT public.submit_lesson_report($1, $2, $3, $4, $5::jsonb, $6, $7, $8) AS id`,
    [
      bookingId,
      args.covered,
      args.understanding,
      args.homework,
      JSON.stringify(args.quran),
      args.instrument,
      args.level,
      args.piece,
    ],
  );
}

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  await seedLifecycleBooking(db);
  await db.exec(`
    INSERT INTO auth.users (id, raw_user_meta_data) VALUES
      ('${STRANGER_ID}', '{"signup_role":"customer"}'::jsonb),
      ('${PARENT_ID}', '{"signup_role":"customer"}'::jsonb)
    ON CONFLICT (id) DO NOTHING;
    UPDATE public.profiles SET full_name = 'Lifecycle Customer' WHERE id = '${IDS.customer}';
    UPDATE public.family_members SET full_name = 'Mariam Test' WHERE id = '${IDS.childMember}';
  `);
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("quran catalog", () => {
  it("has 114 surahs, 6236 ayahs and 30 juz, readable by guests", async () => {
    const rows = await queryRows<{ n: number; ayahs: number; juz: number }>(
      db,
      `SELECT count(*)::int AS n, sum(ayah_count)::int AS ayahs,
              (SELECT count(*)::int FROM public.quran_juz) AS juz
       FROM public.quran_surahs`,
    );
    expect(rows[0]).toEqual({ n: 114, ayahs: 6236, juz: 30 });
    const anon = await tryAsAnon(db, `SELECT number FROM public.quran_surahs LIMIT 1`);
    expect(anon.ok).toBe(true);
  });
});

describe("submit_lesson_report", () => {
  it("lets the tutor write a Quran report and notifies the parent with the child's name", async () => {
    const bookingId = await seedTeachingBooking({
      slug: "quran-lessons",
      subjectCode: "quran_memorization",
      child: true,
    });
    const res = await submit(IDS.providerUser, bookingId, {
      quran: [
        { kind: "new", from_surah: 78, from_ayah: 1, to_surah: 78, to_ayah: 40 },
        { kind: "review", from_surah: 112, from_ayah: 1, to_surah: 114, to_ayah: 6 },
      ],
      homework: "مراجعة سورة النبأ",
    });
    expect(res.error).toBeUndefined();
    const notes = await queryRows<{ title_ar: string; deep_link: string; user_id: string }>(
      db,
      `SELECT title_ar, deep_link, user_id FROM public.notifications
       WHERE booking_id = $1 AND type = 'lesson_report_ready'`,
      [bookingId],
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title_ar).toBe("تقرير حصة Mariam وصل");
    expect(notes[0]!.user_id).toBe(IDS.customer);

    // Editing the report does not notify again.
    const again = await submit(IDS.providerUser, bookingId, {
      covered: "حفظنا سورة النبأ كاملة",
      quran: [{ kind: "new", from_surah: 78, from_ayah: 1, to_surah: 78, to_ayah: 40 }],
    });
    expect(again.error).toBeUndefined();
    const count = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.notifications WHERE booking_id = $1 AND type = 'lesson_report_ready'`,
      [bookingId],
    );
    expect(count[0]!.n).toBe(1);
  });

  it("rejects the customer, a stranger and the other tutor", async () => {
    const bookingId = await seedTeachingBooking({
      slug: "language-tutoring",
      subjectCode: "english",
      child: false,
    });
    for (const who of [IDS.customer, STRANGER_ID, IDS.otherProviderUser]) {
      const res = await submit(who, bookingId);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("LESSON_REPORT_FORBIDDEN");
    }
  });

  it("refuses lessons that are not finished and non-teaching bookings", async () => {
    const upcoming = await seedTeachingBooking({
      slug: "language-tutoring",
      subjectCode: "english",
      child: false,
      status: "confirmed",
    });
    expect((await submit(IDS.providerUser, upcoming)).error).toContain(
      "LESSON_REPORT_NOT_COMPLETED",
    );

    const babysitting = await seedTeachingBooking({
      slug: "hourly-babysitting",
      subjectCode: null,
      child: true,
    });
    expect((await submit(IDS.providerUser, babysitting)).error).toContain(
      "LESSON_REPORT_NOT_TEACHING",
    );

    // An online lesson the student never joined takes no report and no reminder.
    const absent = await seedTeachingBooking({
      slug: "language-tutoring",
      subjectCode: "english",
      child: false,
    });
    await db.exec(`
      SET session_replication_role = replica;
      UPDATE public.bookings SET online_session_outcome = 'customer_absent' WHERE id = '${absent}';
      SET session_replication_role = origin;
    `);
    expect((await submit(IDS.providerUser, absent)).error).toContain(
      "LESSON_REPORT_NOT_COMPLETED",
    );
    await db.exec(`SELECT public.process_lesson_report_reminders()`);
    const reminders = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.lesson_report_reminders WHERE booking_id = $1`,
      [absent],
    );
    expect(reminders[0]!.n).toBe(0);
  });

  it("validates Quran ranges against the catalog and requires at least one range", async () => {
    const bookingId = await seedTeachingBooking({
      slug: "quran-lessons",
      subjectCode: "quran_tajweed",
      child: false,
    });
    expect((await submit(IDS.providerUser, bookingId)).error).toContain(
      "LESSON_REPORT_QURAN_REQUIRED",
    );
    const tooFar = await submit(IDS.providerUser, bookingId, {
      quran: [{ kind: "tajweed", from_surah: 1, from_ayah: 1, to_surah: 1, to_ayah: 8 }],
    });
    expect(tooFar.error).toContain("LESSON_REPORT_QURAN_RANGE_INVALID");
    const backwards = await submit(IDS.providerUser, bookingId, {
      quran: [{ kind: "new", from_surah: 3, from_ayah: 1, to_surah: 2, to_ayah: 5 }],
    });
    expect(backwards.error).toContain("LESSON_REPORT_QURAN_RANGE_INVALID");
    const badRating = await submit(IDS.providerUser, bookingId, {
      understanding: "perfect",
      quran: [{ kind: "new", from_surah: 1, from_ayah: 1, to_surah: 1, to_ayah: 7 }],
    });
    expect(badRating.error).toContain("LESSON_REPORT_UNDERSTANDING_INVALID");
  });

  it("requires a level for music and takes the instrument from the lesson subject", async () => {
    const bookingId = await seedTeachingBooking({
      slug: "music-lessons",
      subjectCode: "music_oud",
      child: true,
    });
    expect((await submit(IDS.providerUser, bookingId)).error).toContain(
      "LESSON_REPORT_MUSIC_LEVEL_INVALID",
    );
    const ok = await submit(IDS.providerUser, bookingId, { level: "beginner", piece: "سلم دو" });
    expect(ok.error).toBeUndefined();
    const rows = await queryRows<{ music_instrument: string }>(
      db,
      `SELECT music_instrument FROM public.lesson_reports WHERE booking_id = $1`,
      [bookingId],
    );
    expect(rows[0]!.music_instrument).toBe("oud");
  });
});

describe("reading reports", () => {
  it("shows the report to the customer and the tutor, never to a stranger or anon", async () => {
    const bookingId = await seedTeachingBooking({
      slug: "language-tutoring",
      subjectCode: "english",
      child: false,
    });
    expect((await submit(IDS.providerUser, bookingId)).error).toBeUndefined();

    const customer = await tryAsUser(db, IDS.customer, `SELECT public.get_lesson_report($1) AS r`, [
      bookingId,
    ]);
    const r = customer.rows?.[0]?.r as Record<string, unknown>;
    expect(r.viewer_role).toBe("customer");
    expect(r.can_write).toBe(false);
    expect((r.report as Record<string, unknown>).covered).toBe("حفظنا أول عشر آيات");

    const tutor = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.get_lesson_report($1) AS r`,
      [bookingId],
    );
    expect((tutor.rows?.[0]?.r as Record<string, unknown>).can_write).toBe(true);

    const stranger = await tryAsUser(db, STRANGER_ID, `SELECT public.get_lesson_report($1) AS r`, [
      bookingId,
    ]);
    expect(stranger.error).toContain("LESSON_REPORT_FORBIDDEN");
    expect((await tryAsAnon(db, `SELECT public.get_lesson_report($1)`, [bookingId])).ok).toBe(
      false,
    );

    const direct = await tryAsUser(db, IDS.customer, `SELECT * FROM public.lesson_reports`);
    expect(direct.ok).toBe(false);
  });

  it("lets a linked parent of a self-booking student read the report and progress", async () => {
    const bookingId = await seedTeachingBooking({
      slug: "language-tutoring",
      subjectCode: "english",
      child: false,
    });
    expect(
      (await tryAsUser(db, PARENT_ID, `SELECT public.get_lesson_report($1)`, [bookingId])).ok,
    ).toBe(false);

    await db.exec(`
      INSERT INTO public.student_parent_links (
        student_id, parent_id, requested_parent_phone, parent_email, status, decided_at
      ) VALUES ('${IDS.customer}', '${PARENT_ID}', '201099990000', 'parent@example.com', 'linked', now());
    `);
    expect((await submit(IDS.providerUser, bookingId)).error).toBeUndefined();
    const parentNote = await queryRows<{ title_ar: string; deep_link: string }>(
      db,
      `SELECT title_ar, deep_link FROM public.notifications
       WHERE user_id = $1 AND type = 'lesson_report_ready_parent'`,
      [PARENT_ID],
    );
    expect(parentNote[0]?.title_ar).toBe("تقرير حصة Lifecycle وصل");
    expect(parentNote[0]?.deep_link).toBe(`/account/students/${IDS.customer}`);

    const read = await tryAsUser(db, PARENT_ID, `SELECT public.get_lesson_report($1) AS r`, [
      bookingId,
    ]);
    expect((read.rows?.[0]?.r as Record<string, unknown>).viewer_role).toBe("parent");
    const progress = await tryAsUser(db, PARENT_ID, `SELECT public.learner_progress($1) AS p`, [
      IDS.customer,
    ]);
    expect(
      ((progress.rows?.[0]?.p as Record<string, unknown>).learner as Record<string, unknown>).mode,
    ).toBe("student");
  });

  it("computes Quran progress per surah and juz for a child", async () => {
    const bookingId = await seedTeachingBooking({
      slug: "quran-lessons",
      subjectCode: "quran_memorization",
      child: true,
    });
    expect(
      (
        await submit(IDS.providerUser, bookingId, {
          quran: [
            { kind: "new", from_surah: 78, from_ayah: 1, to_surah: 114, to_ayah: 6 },
            { kind: "review", from_surah: 1, from_ayah: 1, to_surah: 1, to_ayah: 7 },
          ],
        })
      ).error,
    ).toBeUndefined();

    const res = await tryAsUser(db, IDS.customer, `SELECT public.learner_progress($1) AS p`, [
      IDS.childMember,
    ]);
    expect(res.error).toBeUndefined();
    const p = res.rows?.[0]?.p as {
      learner: { mode: string };
      quran: {
        memorized_ayahs: number;
        total_ayahs: number;
        juz: { juz: number; memorized_ayahs: number; total_ayahs: number }[];
        surahs: { number: number; memorized_ayahs: number; reviewed_ayahs: number }[];
      };
    };
    expect(p.learner.mode).toBe("child");
    expect(p.quran.total_ayahs).toBe(6236);
    const juz30 = p.quran.juz.find((j) => j.juz === 30)!;
    // Juz 30 (An-Naba to An-Nas) is fully memorized: 564 ayahs.
    expect(juz30.total_ayahs).toBe(564);
    expect(juz30.memorized_ayahs).toBe(564);
    expect(p.quran.juz).toHaveLength(30);
    const fatiha = p.quran.surahs.find((s) => s.number === 1)!;
    expect(fatiha.reviewed_ayahs).toBe(7);
    expect(fatiha.memorized_ayahs).toBe(0);
    // The earlier child Quran report (An-Naba 1-40) overlaps; totals count each ayah once.
    expect(p.quran.memorized_ayahs).toBe(564);

    const stranger = await tryAsUser(db, STRANGER_ID, `SELECT public.learner_progress($1)`, [
      IDS.childMember,
    ]);
    expect(stranger.error).toContain("LESSON_REPORT_FORBIDDEN");
  });
});

describe("process_lesson_report_reminders", () => {
  it("reminds the tutor once per day, at most three times, and stops after the report", async () => {
    const bookingId = await seedTeachingBooking({
      slug: "language-tutoring",
      subjectCode: "english",
      child: true,
    });
    expect(
      (await tryAsUser(db, IDS.customer, `SELECT public.process_lesson_report_reminders()`)).ok,
    ).toBe(false);

    await db.exec(`SELECT public.process_lesson_report_reminders()`);
    await db.exec(`SELECT public.process_lesson_report_reminders()`);
    const once = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.notifications WHERE booking_id = $1 AND type = 'lesson_report_reminder'`,
      [bookingId],
    );
    expect(once[0]!.n).toBe(1);

    await db.exec(
      `UPDATE public.lesson_report_reminders SET last_sent_at = now() - interval '25 hours' WHERE booking_id = '${bookingId}'`,
    );
    await db.exec(`SELECT public.process_lesson_report_reminders()`);
    await db.exec(
      `UPDATE public.lesson_report_reminders SET last_sent_at = now() - interval '25 hours' WHERE booking_id = '${bookingId}'`,
    );
    await db.exec(`SELECT public.process_lesson_report_reminders()`);
    await db.exec(
      `UPDATE public.lesson_report_reminders SET last_sent_at = now() - interval '25 hours' WHERE booking_id = '${bookingId}'`,
    );
    await db.exec(`SELECT public.process_lesson_report_reminders()`);
    const capped = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.notifications WHERE booking_id = $1 AND type = 'lesson_report_reminder'`,
      [bookingId],
    );
    expect(capped[0]!.n).toBe(3);

    expect((await submit(IDS.providerUser, bookingId)).error).toBeUndefined();
    const left = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.lesson_report_reminders WHERE booking_id = $1`,
      [bookingId],
    );
    expect(left[0]!.n).toBe(0);
  });
});
