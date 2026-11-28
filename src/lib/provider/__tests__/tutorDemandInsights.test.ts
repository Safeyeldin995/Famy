import { describe, expect, it } from "vitest";
import i18next from "i18next";
import ar from "@/lib/i18n/locales/ar";
import en from "@/lib/i18n/locales/en";
import {
  demandAction,
  demandAgeDays,
  demandHeadline,
  demandPrefillParams,
  demandRecency,
  demandWhat,
  readDemandPrefill,
  sortDemandRows,
  type TutorDemandInsightRow,
} from "@/lib/provider/tutorDemandInsights";
import { teachingSetupPrefill } from "@/lib/provider/teachingSetupPrefill";

const S = "11111111-1111-4111-8111-111111111111";
const SUBJ = "22222222-2222-4222-8222-222222222222";
const CUR = "33333333-3333-4333-8333-333333333333";
const LVL = "44444444-4444-4444-8444-444444444444";

function row(over: Partial<TutorDemandInsightRow> = {}): TutorDemandInsightRow {
  return {
    service_id: S,
    service_slug: "school-subject-tutoring",
    service_name_ar: "دروس خصوصية للمواد الدراسية",
    service_name_en: "School subjects",
    subject_id: SUBJ,
    subject_code: "french",
    subject_name_ar: "فرنساوي",
    subject_name_en: "French",
    curriculum_id: CUR,
    curriculum_code: "ib",
    curriculum_name_ar: "IB",
    curriculum_name_en: "IB",
    level_id: LVL,
    level_code: "g3",
    level_label_ar: "سنة 3",
    level_label_en: "Grade 3",
    service_mode: "online",
    governorate_code: null,
    students: 12,
    last_requested_at: "2026-11-28T10:00:00Z",
    teaches_subject: false,
    capability_status: null,
    mode_fits: true,
    near_me: false,
    ...over,
  };
}

async function translator(lng: "ar" | "en") {
  const i = i18next.createInstance();
  await i.init({ lng, resources: { ar: { translation: ar }, en: { translation: en } } });
  return i.t.bind(i) as unknown as (key: string, o?: Record<string, unknown>) => string;
}

describe("tutor demand insights", () => {
  it("writes the Arabic and English headline with the right plural", async () => {
    const tAr = await translator("ar");
    expect(demandHeadline(row(), "ar", tAr)).toBe("12 طالب بيدوروا على فرنساوي IB سنة 3 أونلاين");
    expect(demandHeadline(row({ students: 1 }), "ar", tAr)).toBe(
      "طالب واحد بيدور على فرنساوي IB سنة 3 أونلاين",
    );
    expect(demandHeadline(row({ students: 2 }), "ar", tAr)).toBe(
      "طالبين بيدوروا على فرنساوي IB سنة 3 أونلاين",
    );
    expect(demandHeadline(row({ students: 4 }), "ar", tAr)).toBe(
      "4 طلبة بيدوروا على فرنساوي IB سنة 3 أونلاين",
    );
    expect(
      demandHeadline(
        row({ service_mode: "in_person", governorate_code: "giza", students: 3 }),
        "ar",
        tAr,
      ),
    ).toBe("3 طلبة بيدوروا على فرنساوي IB سنة 3 في البيت في الجيزة");
    const tEn = await translator("en");
    expect(demandHeadline(row({ students: 1 }), "en", tEn)).toBe(
      "1 student is looking for French IB Grade 3 online",
    );
  });

  it("drops the no-curriculum system for Quran and music and falls back to the service name", () => {
    expect(
      demandWhat(
        row({
          curriculum_code: "na",
          curriculum_name_ar: "بدون منهج",
          subject_name_ar: "حفظ القرآن",
          level_label_ar: "مبتدئ",
        }),
        "ar",
      ),
    ).toBe("حفظ القرآن مبتدئ");
    expect(
      demandWhat(row({ subject_id: null, subject_name_ar: null, subject_name_en: null }), "ar"),
    ).toBe("دروس خصوصية للمواد الدراسية IB سنة 3");
  });

  it("says how recent the last request is, in Western digits", async () => {
    const tAr = await translator("ar");
    const now = new Date("2026-11-28T12:00:00Z");
    expect(demandAgeDays("2026-11-28T01:00:00Z", now)).toBe(0);
    expect(demandRecency("2026-11-27T10:00:00Z", tAr, now)).toBe("آخر طلب امبارح");
    expect(demandRecency("2026-11-23T10:00:00Z", tAr, now)).toBe("آخر طلب من 5 أيام");
    expect(demandAgeDays("2026-12-01T00:00:00Z", now)).toBe(0);
  });

  it("puts rows the tutor can take first", () => {
    const sorted = sortDemandRows([
      row({ students: 20 }),
      row({ students: 2, teaches_subject: true, mode_fits: true }),
      row({ students: 5, near_me: true }),
    ]);
    expect(sorted.map((r) => r.students)).toEqual([2, 5, 20]);
  });

  it("chooses the right action and only carries valid ids", () => {
    expect(demandAction(row({ capability_status: "pending" }), "approved")).toEqual({
      kind: "pending",
    });
    expect(
      demandAction(row({ capability_status: "approved", mode_fits: false }), "approved"),
    ).toEqual({
      kind: "has_it",
      needsMode: true,
    });
    const setup = demandAction(row(), "approved");
    expect(setup).toMatchObject({ kind: "add", target: "setup" });
    const request = demandAction(row(), undefined);
    expect(request).toMatchObject({ kind: "add", target: "request" });
    expect(demandAction(row(), "rejected")).toMatchObject({ target: "request" });
    if (request.kind !== "add") throw new Error("expected add");
    expect(demandPrefillParams(request)).toEqual({
      service: S,
      subject: SUBJ,
      curriculum: CUR,
      level: LVL,
    });
    expect(
      readDemandPrefill({ service: S, subject: "x'; drop", curriculum: [CUR], level: 5 }),
    ).toEqual({ service: S, curriculum: CUR });
  });

  it("prefills the add-subject screen and keeps the grades the tutor already has", () => {
    const na = { id: "55555555-5555-4555-8555-555555555555", code: "na" };
    const data = {
      services: [{ id: S }],
      subjects: [{ id: SUBJ }],
      curricula: [{ id: CUR, code: "ib" }, na],
      links: [{ service_id: S, subject_id: SUBJ }],
      rows: [
        {
          service_id: S,
          subject_id: SUBJ,
          curriculum_id: CUR,
          level_id: "g2",
          status: "pending",
          session_duration_min: 90,
          session_price: 500,
        },
        {
          service_id: S,
          subject_id: SUBJ,
          curriculum_id: CUR,
          level_id: "g1",
          status: "approved",
          session_duration_min: 90,
          session_price: 500,
        },
      ],
    };
    expect(
      teachingSetupPrefill({ service: S, subject: SUBJ, curriculum: CUR, level: LVL }, data),
    ).toEqual({
      serviceId: S,
      subjectId: SUBJ,
      curriculumId: CUR,
      levelIds: ["g2", LVL],
      durationMin: 90,
      price: 500,
    });
    // Quran / music: no school system to pick.
    expect(
      teachingSetupPrefill({ service: S, subject: SUBJ, curriculum: na.id, level: LVL }, data),
    ).toMatchObject({
      curriculumId: "",
      levelIds: [LVL],
    });
    // A service the tutor doesn't have, or a subject not linked to it, is ignored.
    expect(teachingSetupPrefill({ service: CUR }, data)).toBeNull();
    expect(teachingSetupPrefill({ service: S, subject: CUR }, data)).toEqual({
      serviceId: S,
      subjectId: "",
      curriculumId: "",
      levelIds: [],
    });
  });
});
