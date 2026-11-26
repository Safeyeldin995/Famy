import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GraduationCap } from "lucide-react";
import { PrimaryButton } from "@/components/famio/ui";
import { currentLang } from "@/lib/i18n";
import { teachingLevelLabel } from "@/lib/tutoring/teachingLevelLabels";
import { schoolGrades, schoolSystems, type LevelRow } from "@/lib/tutoring/studentLearnerFlow";
import type { CurriculumWithStyle } from "@/lib/db/student-match-queries";

/** Label for a grade in a given system («3 ابتدائي», Year 4, Grade 3…). */
export function gradeLabel(
  level: Pick<LevelRow, "code" | "name_ar" | "name_en"> | null | undefined,
  curriculum: Pick<CurriculumWithStyle, "level_label_style"> | null | undefined,
  lang: "ar" | "en",
): string {
  if (!level) return "";
  return teachingLevelLabel({
    levelCode: level.code,
    style: curriculum?.level_label_style ?? "plain",
    lang,
    fallbackName: lang === "ar" ? level.name_ar : level.name_en,
  });
}

export const chipClass = (active: boolean) =>
  `focus-ring min-h-11 shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-pro-13 font-bold transition-colors ${
    active
      ? "border-navy bg-navy text-navy-foreground"
      : "border-border bg-white text-muted-foreground hover:text-foreground"
  }`;

/**
 * Two steps: «نظام التعليم» as cards, then «السنة الدراسية» with labels per system.
 * Calls `onDone` with the picked ids; the caller saves them (or keeps them for a guest).
 */
export function StudentProfileSteps({
  title,
  curricula,
  levels,
  initialCurriculumId,
  initialLevelId,
  saving,
  onDone,
  onCancel,
}: {
  title: string;
  curricula: CurriculumWithStyle[];
  levels: LevelRow[];
  initialCurriculumId?: string | null;
  initialLevelId?: string | null;
  saving?: boolean;
  onDone: (picked: { curriculumId: string; levelId: string }) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const lang = currentLang();
  const [curriculumId, setCurriculumId] = useState<string | null>(initialCurriculumId ?? null);
  const [levelId, setLevelId] = useState<string | null>(initialLevelId ?? null);
  const [step, setStep] = useState<1 | 2>(initialCurriculumId ? 2 : 1);
  const systems = schoolSystems(curricula);
  const grades = schoolGrades(levels);
  const curriculum = curricula.find((c) => c.id === curriculumId) ?? null;

  return (
    <section
      className="space-y-4 rounded-3xl border border-brand/20 bg-white p-5 shadow-sm"
      aria-label={title}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-pro-18 font-extrabold">{title}</h2>
        <span className="text-pro-12 font-bold text-muted-foreground">
          {t("studentMatch.stepOf", { step })}
        </span>
      </div>

      {step === 1 ? (
        <div className="space-y-3">
          <p className="text-pro-14 font-bold text-muted-foreground">
            {t("studentMatch.systemStep")}
          </p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {systems.map((c) => {
              const active = c.id === curriculumId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setCurriculumId(c.id);
                      if (c.id !== curriculumId) setLevelId(null);
                      setStep(2);
                    }}
                    className={`focus-ring flex min-h-14 w-full items-center gap-3 rounded-2xl border p-3 text-start text-pro-14 font-bold transition-colors ${
                      active
                        ? "border-brand bg-brand/10 text-brand"
                        : "border-border bg-white hover:border-brand/40"
                    }`}
                  >
                    <GraduationCap className="h-5 w-5 shrink-0" aria-hidden />
                    {lang === "ar" ? c.name_ar : c.name_en}
                  </button>
                </li>
              );
            })}
          </ul>
          {onCancel ? (
            <button
              type="button"
              className="focus-ring min-h-11 text-pro-13 font-bold text-muted-foreground"
              onClick={onCancel}
            >
              {t("common.cancel")}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-pro-14 font-bold text-muted-foreground">
            {t("studentMatch.gradeStep")}
            {curriculum ? ` · ${lang === "ar" ? curriculum.name_ar : curriculum.name_en}` : null}
          </p>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label={t("studentMatch.gradeStep")}
          >
            {grades.map((g) => (
              <button
                key={g.id}
                type="button"
                aria-pressed={g.id === levelId}
                className={chipClass(g.id === levelId)}
                onClick={() => setLevelId(g.id)}
              >
                {gradeLabel(g, curriculum, lang)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <PrimaryButton
              type="button"
              className="h-12 px-8"
              disabled={!curriculumId || !levelId || saving}
              onClick={() => curriculumId && levelId && onDone({ curriculumId, levelId })}
            >
              {t("studentMatch.save")}
            </PrimaryButton>
            <button
              type="button"
              className="focus-ring min-h-11 text-pro-13 font-bold text-muted-foreground"
              onClick={() => setStep(1)}
            >
              {t("studentMatch.back")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
