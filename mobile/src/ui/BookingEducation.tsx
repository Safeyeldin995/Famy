import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useTeachingCurricula, useTeachingLevels } from "@/lib/queries";
import { shouldClearStaleEducationLevel } from "@shared/tutoring/educationProfileFieldsLogic";
import { localized } from "@/lib/presentation";
import { Choices, QueryState } from "./Page";
import { Text } from "./Text";
export function BookingEducation({
  curriculum,
  level,
  onChange,
}: {
  curriculum: string;
  level: string;
  onChange: (curriculum: string, level: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const curricula = useTeachingCurricula();
  const levels = useTeachingLevels();
  const selected = curricula.data?.find((c) => c.id === curriculum);
  // Pure filter from src/lib/tutoring/teachingLevelFilters.ts; its type import pulls web query hooks.
  const filtered = (levels.data ?? []).filter(
    (l) => selected?.code !== "british" || ["g10", "g11", "g12"].includes(l.code),
  );
  useEffect(() => {
    if (
      shouldClearStaleEducationLevel({
        educationLevelId: level,
        filteredLevelIds: filtered.map((l) => l.id),
        taxonomyLoaded: curricula.isSuccess && levels.isSuccess,
      })
    )
      onChange(curriculum, "");
  }, [curriculum, level, filtered, curricula.isSuccess, levels.isSuccess, onChange]);
  return (
    <>
      <QueryState query={curricula} />
      <QueryState query={levels} />
      <Choices
        label={t("studentEducation.curriculum")}
        value={curriculum}
        onChange={(v) => onChange(v, "")}
        options={[
          { value: "", label: t("studentEducation.optionalNone") },
          ...(curricula.data ?? []).map((c) => ({
            value: c.id,
            label: localized(c, i18n.language),
          })),
        ]}
      />
      {curriculum && (
        <Choices
          label={t("studentEducation.grade")}
          value={level}
          onChange={(v) => onChange(curriculum, v)}
          options={[
            { value: "", label: t("studentEducation.optionalNone") },
            ...filtered.map((l) => ({ value: l.id, label: localized(l, i18n.language) })),
          ]}
        />
      )}
      {selected?.code === "british" && <Text>{t("teaching.britishLevelHint")}</Text>}
    </>
  );
}
