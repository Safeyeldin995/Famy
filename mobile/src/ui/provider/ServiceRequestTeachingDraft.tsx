import { useMemo, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { allowedDurationsForSubject } from "@shared/tutoring/teachingCapabilities";
import { teachingLevelsForServiceAndCurriculum } from "@shared/tutoring/teachingLevelFilters";
import {
  isTeachingCurriculumNa,
  serviceRequiresTeachingCurriculum,
  TEACHING_CURRICULUM_NA_CODE,
  isLessonServiceSlug,
} from "@shared/tutoring/lessonServices";
import { LessonIllustration } from "@/ui/lessons/LessonIllustration";
import { LessonSubjectChips } from "@/ui/lessons/LessonSubjectChips";
import { isPriceInRange } from "@shared/provider/priceOptions";
import type { TeachingGroupDraft } from "@shared/provider/serviceRequestPayload";
import {
  useTeachingCurricula,
  useTeachingLevels,
  useTeachingSubjects,
  useTeachingSubjectServices,
  useTeachingServiceLevels,
} from "@/lib/provider/teachingQueries";
import { BottomSheetSelect } from "./BottomSheetSelect";
import { ProviderPriceStepper } from "./ProviderPriceStepper";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { space } from "@/ui/theme";
import { proCard } from "./cards";

type Named = { id: string; code?: string | null; name_ar: string; name_en: string };
type TeachingService = Named & {
  slug?: string | null;
  minimum_price?: number | null;
  maximum_price?: number | null;
  allowed_session_durations?: number[] | null;
};

export function ServiceRequestTeachingDraft({
  service,
  groups,
  onChangeGroups,
}: {
  service: TeachingService;
  groups: TeachingGroupDraft[];
  onChangeGroups: (next: TeachingGroupDraft[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const name = (row: { name_ar?: string; name_en?: string }) =>
    ar ? (row.name_ar ?? row.name_en ?? "") : (row.name_en ?? row.name_ar ?? "");
  const subjectsQ = useTeachingSubjects();
  const curriculaQ = useTeachingCurricula();
  const levelsQ = useTeachingLevels();
  const linksQ = useTeachingSubjectServices();
  const serviceLevelsQ = useTeachingServiceLevels();

  const [subjectId, setSubjectId] = useState("");
  const [curriculumId, setCurriculumId] = useState("");
  const [levelIds, setLevelIds] = useState<string[]>([]);
  const [duration, setDuration] = useState(service.allowed_session_durations?.[0] ?? 60);
  const [price, setPrice] = useState<number | null>(null);

  const requiresCurriculum = serviceRequiresTeachingCurriculum(service.slug);
  const naCurriculumId =
    (curriculaQ.data ?? []).find((row) => row.code === TEACHING_CURRICULUM_NA_CODE)?.id ?? "";
  const effectiveCurriculumId = requiresCurriculum ? curriculumId : naCurriculumId;

  const subjects = (subjectsQ.data ?? []) as Named[];
  const curricula = (curriculaQ.data ?? []) as Named[];
  const levels = (levelsQ.data ?? []) as Named[];
  const links = (linksQ.data ?? []) as { subject_id: string; service_id: string }[];
  const serviceLevels = (serviceLevelsQ.data ?? []) as { service_id: string; level_id: string }[];
  const subject = subjects.find((row) => row.id === subjectId);
  const curriculum = curricula.find((row) => row.id === effectiveCurriculumId);

  const availableSubjects = subjects.filter((row) =>
    links.some((link) => link.service_id === service.id && link.subject_id === row.id),
  );
  const filteredLevels = useMemo(
    () =>
      teachingLevelsForServiceAndCurriculum(
        service.id,
        curriculum?.code,
        levels,
        serviceLevels,
      ),
    [service.id, curriculum?.code, levels, serviceLevels],
  );
  const selectableCurricula = curricula.filter((row) => !isTeachingCurriculumNa(row.code));
  const durations = allowedDurationsForSubject(
    (subject as Named & { max_session_duration_min?: number })?.max_session_duration_min ?? 120,
    service.allowed_session_durations ?? [60, 90, 120, 180],
  );

  const addGroup = () => {
    if (
      !subjectId ||
      !effectiveCurriculumId ||
      levelIds.length === 0 ||
      price == null ||
      !isPriceInRange(price, service.minimum_price ?? null, service.maximum_price ?? null)
    ) {
      return;
    }
    onChangeGroups([
      ...groups,
      {
        subject_id: subjectId,
        curriculum_id: effectiveCurriculumId,
        level_ids: levelIds,
        session_duration_min: duration,
        session_price: price,
      },
    ]);
    setSubjectId("");
    setCurriculumId("");
    setLevelIds([]);
    setPrice(null);
  };

  if ([subjectsQ, curriculaQ, levelsQ, linksQ, serviceLevelsQ].some((q) => q.isLoading)) {
    return <Text>{t("common.loading")}</Text>;
  }

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        {isLessonServiceSlug(service.slug) ? (
          <LessonIllustration
            serviceSlug={service.slug}
            accessibilityLabel={name(service)}
            width={44}
            height={44}
          />
        ) : null}
        <Text weight="bold">{t("pro.serviceRequest.teachingTitle")}</Text>
      </View>
      {groups.map((group, idx) => (
        <View key={idx} style={[proCard.card, { gap: space.xs }]}>
          <Text tone="muted" size="sm">
            {t("pro.serviceRequest.teachingGroupLine", {
              count: group.level_ids.length,
              duration: group.session_duration_min,
              price: group.session_price,
            })}
          </Text>
          <Button
            variant="secondary"
            label={t("providerClarity.removeSubject")}
            onPress={() => onChangeGroups(groups.filter((_, i) => i !== idx))}
          />
        </View>
      ))}
      <LessonSubjectChips
        serviceSlug={service.slug}
        subjects={availableSubjects as { id: string; code: string; name_ar: string; name_en: string }[]}
        value={subjectId}
        label={name}
        onChange={(value) => {
          setSubjectId(value);
          setLevelIds([]);
        }}
      />
      {!isLessonServiceSlug(service.slug) ? (
        <BottomSheetSelect
          label={t("teaching.subject")}
          value={subjectId}
          options={availableSubjects.map((row) => ({ value: row.id, label: name(row) }))}
          onChange={(value) => {
            setSubjectId(value);
            setLevelIds([]);
          }}
        />
      ) : (
        <Text weight="bold">{t("teaching.subject")}</Text>
      )}
      {requiresCurriculum ? (
        <BottomSheetSelect
          label={t("teaching.curriculum")}
          value={curriculumId}
          options={selectableCurricula.map((row) => ({ value: row.id, label: name(row) }))}
          onChange={(value) => {
            setCurriculumId(value);
            setLevelIds([]);
          }}
        />
      ) : null}
      {subjectId && effectiveCurriculumId ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {filteredLevels.map((row) => {
            const selected = levelIds.includes(row.id);
            return (
              <Button
                key={row.id}
                variant={selected ? "primary" : "secondary"}
                label={name(row)}
                onPress={() =>
                  setLevelIds((current) =>
                    selected ? current.filter((id) => id !== row.id) : [...current, row.id],
                  )
                }
              />
            );
          })}
        </View>
      ) : (
        <Text tone="muted">{t("providerSetup.chooseSubjectFirst")}</Text>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {durations.map((value) => (
          <Button
            key={value}
            variant={duration === value ? "primary" : "secondary"}
            label={`${value} ${t("scheduleUi.minutes")}`}
            onPress={() => setDuration(value)}
          />
        ))}
      </View>
      <ProviderPriceStepper
        min={service.minimum_price ?? null}
        max={service.maximum_price ?? null}
        value={price}
        onChange={setPrice}
      />
      <Button variant="secondary" label={t("pro.serviceRequest.addTeachingGroup")} onPress={addGroup} />
    </View>
  );
}
