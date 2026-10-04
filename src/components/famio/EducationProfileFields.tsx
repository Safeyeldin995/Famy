import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useTeachingCurricula, useTeachingLevels } from "@/lib/db/teaching-queries";
import { teachingLevelsForCurriculum } from "@/lib/tutoring/teachingLevelFilters";
import { localizedTaxonomyName } from "@/lib/tutoring/teachingCapabilities";
import { currentLang } from "@/lib/i18n";

export type EducationProfileValue = {
  educationCurriculumId: string;
  educationLevelId: string;
};

export function emptyEducationProfileValue(): EducationProfileValue {
  return { educationCurriculumId: "", educationLevelId: "" };
}

export function EducationProfileFields({
  value,
  onChange,
}: {
  value: EducationProfileValue;
  onChange: (value: EducationProfileValue) => void;
}) {
  const { t } = useTranslation();
  const lang = currentLang() === "ar" ? "ar" : "en";
  const curriculaQ = useTeachingCurricula();
  const levelsQ = useTeachingLevels();
  const curriculum = (curriculaQ.data ?? []).find((row) => row.id === value.educationCurriculumId);
  const filteredLevels = useMemo(
    () => teachingLevelsForCurriculum(curriculum?.code, levelsQ.data ?? []),
    [curriculum?.code, levelsQ.data],
  );

  useEffect(() => {
    if (!value.educationLevelId) return;
    if (!filteredLevels.some((row) => row.id === value.educationLevelId)) {
      onChange({ ...value, educationLevelId: "" });
    }
  }, [filteredLevels, onChange, value]);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("studentEducation.curriculum", "Curriculum")}
        </label>
        <select
          value={value.educationCurriculumId}
          onChange={(e) =>
            onChange({ educationCurriculumId: e.target.value, educationLevelId: "" })
          }
          className="focus-ring mt-2 h-12 w-full rounded-2xl border border-border/60 bg-surface-elevated px-4 text-sm font-bold text-foreground"
        >
          <option value="">{t("studentEducation.optionalNone", "Not set")}</option>
          {(curriculaQ.data ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {localizedTaxonomyName(row, lang)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("studentEducation.grade", "Grade")}
        </label>
        <select
          value={value.educationLevelId}
          onChange={(e) => onChange({ ...value, educationLevelId: e.target.value })}
          disabled={!value.educationCurriculumId}
          className="focus-ring mt-2 h-12 w-full rounded-2xl border border-border/60 bg-surface-elevated px-4 text-sm font-bold text-foreground disabled:opacity-60"
        >
          <option value="">{t("studentEducation.optionalNone", "Not set")}</option>
          {filteredLevels.map((row) => (
            <option key={row.id} value={row.id}>
              {localizedTaxonomyName(row, lang)}
            </option>
          ))}
        </select>
        {curriculum?.code === "british" ? (
          <p className="mt-2 text-xs font-semibold text-muted-foreground">
            {t("teaching.britishLevelHint")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function educationValueFromIds(
  curriculumId: string | null | undefined,
  levelId: string | null | undefined,
): EducationProfileValue {
  return {
    educationCurriculumId: curriculumId ?? "",
    educationLevelId: levelId ?? "",
  };
}

export function educationIdsFromValue(value: EducationProfileValue): {
  education_curriculum_id: string | null;
  education_level_id: string | null;
} {
  return {
    education_curriculum_id: value.educationCurriculumId || null,
    education_level_id: value.educationLevelId || null,
  };
}
