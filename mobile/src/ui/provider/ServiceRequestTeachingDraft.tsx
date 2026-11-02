import { useMemo, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { allowedDurationsForSubject } from "@shared/tutoring/teachingCapabilities";
import { isPriceInRange } from "@shared/provider/priceOptions";
import type { TeachingGroupDraft } from "@shared/provider/serviceRequestPayload";
import {
  useTeachingCurricula,
  useTeachingLevels,
  useTeachingSubjects,
  useTeachingSubjectServices,
} from "@/lib/provider/teachingQueries";
import { BottomSheetSelect } from "./BottomSheetSelect";
import { ProviderPriceStepper } from "./ProviderPriceStepper";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { space } from "@/ui/theme";
import { proCard } from "./cards";

type Named = { id: string; code?: string; name_ar: string; name_en: string };
type TeachingService = Named & {
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
  const name = (row: Named) => (ar ? row.name_ar : row.name_en);
  const subjectsQ = useTeachingSubjects();
  const curriculaQ = useTeachingCurricula();
  const levelsQ = useTeachingLevels();
  const linksQ = useTeachingSubjectServices();

  const [subjectId, setSubjectId] = useState("");
  const [curriculumId, setCurriculumId] = useState("");
  const [levelIds, setLevelIds] = useState<string[]>([]);
  const [duration, setDuration] = useState(service.allowed_session_durations?.[0] ?? 60);
  const [price, setPrice] = useState<number | null>(null);

  const subjects = (subjectsQ.data ?? []) as Named[];
  const curricula = (curriculaQ.data ?? []) as Named[];
  const levels = (levelsQ.data ?? []) as Named[];
  const links = (linksQ.data ?? []) as { subject_id: string; service_id: string }[];
  const subject = subjects.find((row) => row.id === subjectId);
  const curriculum = curricula.find((row) => row.id === curriculumId);

  const availableSubjects = subjects.filter((row) =>
    links.some((link) => link.service_id === service.id && link.subject_id === row.id),
  );
  const filteredLevels = useMemo(
    () =>
      levels.filter(
        (row) => curriculum?.code !== "british" || ["g10", "g11", "g12"].includes(row.code ?? ""),
      ),
    [curriculum?.code, levels],
  );
  const durations = allowedDurationsForSubject(
    (subject as Named & { max_session_duration_min?: number })?.max_session_duration_min ?? 120,
    service.allowed_session_durations ?? [60, 90, 120, 180],
  );

  const addGroup = () => {
    if (
      !subjectId ||
      !curriculumId ||
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
        curriculum_id: curriculumId,
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

  if ([subjectsQ, curriculaQ, levelsQ, linksQ].some((q) => q.isLoading)) {
    return <Text>{t("common.loading")}</Text>;
  }

  return (
    <View style={{ gap: space.lg }}>
      <Text weight="bold">{t("pro.serviceRequest.teachingTitle")}</Text>
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
      <BottomSheetSelect
        label={t("teaching.subject")}
        value={subjectId}
        options={availableSubjects.map((row) => ({ value: row.id, label: name(row) }))}
        onChange={(value) => {
          setSubjectId(value);
          setLevelIds([]);
        }}
      />
      <BottomSheetSelect
        label={t("teaching.curriculum")}
        value={curriculumId}
        options={curricula.map((row) => ({ value: row.id, label: name(row) }))}
        onChange={(value) => {
          setCurriculumId(value);
          setLevelIds([]);
        }}
      />
      {subjectId && curriculumId ? (
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
