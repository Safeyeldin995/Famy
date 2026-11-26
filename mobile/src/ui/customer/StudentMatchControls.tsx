// «الحجز لمين؟» → (system + grade if missing) → subject (+ level for Quran / music).
// Issue 536 PR 2. No filter UI: the learner's saved system and grade drive the match.
import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import { teachingLevelLabel } from "@shared/tutoring/teachingLevelLabels";
import {
  schoolGrades,
  schoolSystems,
  type LearnerOption,
  type LevelRow,
  type SubjectRow,
} from "@shared/tutoring/studentLearnerFlow";
import { Text } from "../Text";
import { Button } from "../Button";
import { space } from "../theme";
import { CustomerChips, customerStyle } from "./Primitives";
import type { CurriculumWithStyle } from "@/lib/studentMatchQueries";

const ADD_CHILD = "__add_child__";

export function gradeLabelFor(
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

export function LearnerChips({
  learners,
  value,
  onChange,
}: {
  learners: LearnerOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space.xs }}>
      <Text size="sm" weight="bold" tone="muted">
        {t("studentMatch.forWhomTitle")}
      </Text>
      <CustomerChips
        value={value}
        onChange={(v) => (v === ADD_CHILD ? router.push("/family-members/new") : onChange(v))}
        options={[
          ...learners.map((l) => ({
            value: l.id,
            label: l.kind === "self" ? t("studentMatch.me") : (l.firstName ?? ""),
          })),
          { value: ADD_CHILD, label: `+ ${t("studentMatch.addChild")}` },
        ]}
      />
    </View>
  );
}

/** Two steps: «نظام التعليم», then «السنة الدراسية» with labels per system. */
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
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "ar";
  const [curriculumId, setCurriculumId] = useState<string | null>(initialCurriculumId ?? null);
  const [levelId, setLevelId] = useState<string | null>(initialLevelId ?? null);
  const [step, setStep] = useState<1 | 2>(initialCurriculumId ? 2 : 1);
  const curriculum = curricula.find((c) => c.id === curriculumId) ?? null;
  const systems = schoolSystems(curricula);
  const grades = schoolGrades(levels);

  return (
    <View style={[customerStyle.card, { gap: space.md }]}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          gap: space.sm,
        }}
      >
        <Text weight="heavy" style={{ flexShrink: 1 }}>
          {title}
        </Text>
        <Text size="xs" weight="bold" tone="muted">
          {t("studentMatch.stepOf", { step: String(step) })}
        </Text>
      </View>
      {step === 1 ? (
        <View style={{ gap: space.sm }}>
          <Text size="sm" weight="bold" tone="muted">
            {t("studentMatch.systemStep")}
          </Text>
          {systems.map((c) => (
            <Button
              key={c.id}
              variant={c.id === curriculumId ? "primary" : "secondary"}
              label={lang === "ar" ? c.name_ar : c.name_en}
              onPress={() => {
                if (c.id !== curriculumId) setLevelId(null);
                setCurriculumId(c.id);
                setStep(2);
              }}
            />
          ))}
          {onCancel ? (
            <Button variant="ghost" label={t("common.cancel")} onPress={onCancel} />
          ) : null}
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <Text size="sm" weight="bold" tone="muted">
            {t("studentMatch.gradeStep")}
            {curriculum ? ` · ${lang === "ar" ? curriculum.name_ar : curriculum.name_en}` : ""}
          </Text>
          <CustomerChips
            value={levelId ?? ""}
            onChange={setLevelId}
            options={grades.map((g) => ({
              value: g.id,
              label: gradeLabelFor(g, curriculum, lang),
            }))}
          />
          <Button
            label={t("studentMatch.save")}
            disabled={!curriculumId || !levelId || saving}
            onPress={() => curriculumId && levelId && onDone({ curriculumId, levelId })}
          />
          <Button variant="ghost" label={t("studentMatch.back")} onPress={() => setStep(1)} />
        </View>
      )}
    </View>
  );
}

export function SubjectChips({
  subjects,
  value,
  onChange,
}: {
  subjects: SubjectRow[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  if (!subjects.length) return null;
  return (
    <View style={{ gap: space.xs }}>
      <Text size="sm" weight="bold" tone="muted">
        {t("studentMatch.subjectTitle")}
      </Text>
      <CustomerChips
        value={value ?? ""}
        onChange={onChange}
        options={subjects.map((s) => ({
          value: s.id,
          label: i18n.language === "en" ? s.name_en : s.name_ar,
        }))}
      />
    </View>
  );
}

export function LevelChips({
  levels,
  value,
  onChange,
}: {
  levels: LevelRow[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  if (!levels.length) return null;
  return (
    <View style={{ gap: space.xs }}>
      <Text size="sm" weight="bold" tone="muted">
        {t("studentMatch.levelTitle")}
      </Text>
      <CustomerChips
        value={value ?? ""}
        onChange={onChange}
        options={levels.map((l) => ({
          value: l.id,
          label: i18n.language === "en" ? l.name_en : l.name_ar,
        }))}
      />
    </View>
  );
}
