import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { groupTeachingRows, teachingLevelDiff } from "@shared/tutoring/teachingGroups";
import { allowedDurationsForSubject } from "@shared/tutoring/teachingCapabilities";
import { isPriceInRange } from "@shared/provider/priceOptions";
import {
  useMyTeachingCapabilities,
  useRemoveTeachingCapability,
  useSaveTeachingGroup,
  useTeachingCurricula,
  useTeachingLevels,
  useTeachingSubjects,
  useTeachingSubjectServices,
} from "@/lib/provider/teachingQueries";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { space } from "@/ui/theme";
import { BottomSheetSelect } from "./BottomSheetSelect";
import { ProviderPriceStepper } from "./ProviderPriceStepper";
import { proCard } from "./cards";

type Named = { id: string; code?: string; name_ar: string; name_en: string };
type TeachingService = Named & {
  minimum_price?: number | null;
  maximum_price?: number | null;
  allowed_session_durations?: number[] | null;
};
type TeachingRow = {
  id: string;
  provider_id: string;
  service_id: string;
  subject_id: string;
  curriculum_id: string;
  level_id: string;
  session_duration_min: number;
  session_price: number;
  status: string;
};

export function TeachingGroupsSetup({
  providerId,
  services,
}: {
  providerId: string;
  services: TeachingService[];
}) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const name = (row: Named) => (ar ? row.name_ar : row.name_en);
  const rowsQ = useMyTeachingCapabilities(providerId);
  const subjectsQ = useTeachingSubjects();
  const curriculaQ = useTeachingCurricula();
  const levelsQ = useTeachingLevels();
  const linksQ = useTeachingSubjectServices();
  const saveGroup = useSaveTeachingGroup();
  const removeGroup = useRemoveTeachingCapability();
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [subjectId, setSubjectId] = useState("");
  const [curriculumId, setCurriculumId] = useState("");
  const [levelIds, setLevelIds] = useState<string[]>([]);
  const [duration, setDuration] = useState(60);
  const [price, setPrice] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const queries = [rowsQ, subjectsQ, curriculaQ, levelsQ, linksQ];
  if (queries.some((query) => query.isLoading)) return <Text>{t("common.loading")}</Text>;
  if (queries.some((query) => query.isError))
    return <Text tone="danger">{t("providerApply.saveError")}</Text>;

  const rows = (rowsQ.data ?? []) as TeachingRow[];
  const subjects = (subjectsQ.data ?? []) as Named[];
  const curricula = (curriculaQ.data ?? []) as Named[];
  const levels = (levelsQ.data ?? []) as Named[];
  const links = (linksQ.data ?? []) as { subject_id: string; service_id: string }[];
  const service = services.find((row) => row.id === serviceId);
  const subject = subjects.find((row) => row.id === subjectId);
  const curriculum = curricula.find((row) => row.id === curriculumId);
  const saved = rows.filter(
    (row) =>
      row.service_id === serviceId &&
      row.subject_id === subjectId &&
      row.curriculum_id === curriculumId,
  );
  const diff = teachingLevelDiff(saved, levelIds);
  const chosen = [...new Set([...levelIds, ...diff.lockedApproved.map((row) => row.level_id)])];
  const groups = groupTeachingRows(rows);
  const availableSubjects = subjects.filter((row) =>
    links.some((link) => link.service_id === serviceId && link.subject_id === row.id),
  );
  const availableLevels = levels.filter(
    (row) => curriculum?.code !== "british" || ["g10", "g11", "g12"].includes(row.code ?? ""),
  );
  const durations = allowedDurationsForSubject(
    (subject as Named & { max_session_duration_min?: number })?.max_session_duration_min ?? 120,
    service?.allowed_session_durations ?? [60, 90, 120, 180],
  );
  const locked = saved.some((row) => row.status === "approved") ? saved[0] : undefined;
  const effectiveDuration =
    locked?.session_duration_min ??
    (durations.some((value) => value === duration) ? duration : durations[0]);
  const effectivePrice = locked?.session_price ?? price;
  const valid =
    !!service &&
    !!subjectId &&
    !!curriculumId &&
    chosen.length > 0 &&
    !!effectiveDuration &&
    isPriceInRange(effectivePrice, service.minimum_price ?? null, service.maximum_price ?? null);

  const resetChoice = () => {
    setSubjectId("");
    setCurriculumId("");
    setLevelIds([]);
    setPrice(null);
    setError("");
  };
  const save = async () => {
    if (!valid || effectivePrice == null) return;
    setBusy(true);
    setError("");
    try {
      await saveGroup.mutateAsync({
        serviceId,
        subjectId,
        curriculumId,
        levelIds: chosen,
        sessionDurationMin: effectiveDuration,
        sessionPrice: effectivePrice,
      });
      router.back();
    } catch {
      setError(t("providerApply.saveError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.lg }}>
      <Text tone="muted">{t("providerSetup.hints.subjects")}</Text>
      {groups.map((group) => {
        const first = group.first;
        const subjectName = subjects.find((row) => row.id === first.subject_id);
        const curriculumName = curricula.find((row) => row.id === first.curriculum_id);
        const removable = teachingLevelDiff(group.rows, []).removable.map((row) => row.id);
        return (
          <View key={group.key} style={[proCard.card, { gap: space.sm }]}>
            <Text weight="bold">
              {subjectName ? name(subjectName) : ""} · {curriculumName ? name(curriculumName) : ""}
            </Text>
            <Text tone="muted" size="sm">
              {group.rows
                .map((row) => {
                  const level = levels.find((entry) => entry.id === row.level_id);
                  return level ? name(level) : "";
                })
                .join(" · ")}{" "}
              · {first.session_price} {t("pricePicker.sessionUnit")}
            </Text>
            <Text tone="muted" size="sm">
              {[...new Set(group.rows.map((row) => row.status))]
                .map((status) => t(`providerSetup.status.${status}`))
                .join(" · ")}
            </Text>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Button
                variant="secondary"
                label={t("common.edit")}
                onPress={() => {
                  setServiceId(first.service_id);
                  setSubjectId(first.subject_id);
                  setCurriculumId(first.curriculum_id);
                  setLevelIds(group.rows.map((row) => row.level_id));
                  setDuration(first.session_duration_min);
                  setPrice(first.session_price);
                }}
              />
              {removable.length > 0 && (
                <Button
                  variant="secondary"
                  label={t("providerClarity.removeSubject")}
                  onPress={() => {
                    setBusy(true);
                    void removeGroup
                      .mutateAsync(removable)
                      .catch(() => setError(t("providerApply.saveError")))
                      .finally(() => setBusy(false));
                  }}
                />
              )}
            </View>
          </View>
        );
      })}
      <Text weight="bold">{t("providerSetup.addSubjectGroup")}</Text>
      {!services.length && <Text tone="muted">{t("providerSetup.noTeachingServices")}</Text>}
      <BottomSheetSelect
        label={t("teaching.service")}
        value={serviceId}
        options={services.map((row) => ({ value: row.id, label: name(row) }))}
        onChange={(value) => {
          setServiceId(value);
          resetChoice();
        }}
      />
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
        <View style={{ gap: space.sm }}>
          <Text weight="bold">{t("teaching.level")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {availableLevels.map((row) => {
              const selected = chosen.includes(row.id);
              const lockedLevel = diff.lockedApproved.some((entry) => entry.level_id === row.id);
              return (
                <Button
                  key={row.id}
                  variant={selected ? "primary" : "secondary"}
                  label={name(row)}
                  onPress={() => {
                    if (!lockedLevel)
                      setLevelIds((current) =>
                        selected ? current.filter((id) => id !== row.id) : [...current, row.id],
                      );
                  }}
                />
              );
            })}
          </View>
          {!!diff.lockedApproved.length && (
            <Text tone="muted" size="sm">
              {t("providerSetup.approvedLocked")}
            </Text>
          )}
        </View>
      ) : (
        <Text tone="muted">{t("providerSetup.chooseSubjectFirst")}</Text>
      )}
      <Text weight="bold">{t("providerSetup.duration")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {[...new Set([...durations, ...(locked ? [locked.session_duration_min] : [])])].map(
          (value) => (
            <Button
              key={value}
              variant={effectiveDuration === value ? "primary" : "secondary"}
              label={`${value} ${t("scheduleUi.minutes")}`}
              onPress={() => {
                if (!locked) setDuration(value);
              }}
            />
          ),
        )}
      </View>
      {locked && (
        <Text tone="muted" size="sm">
          {t("providerSetup.approvedPriceLocked")}
        </Text>
      )}
      <ProviderPriceStepper
        min={service?.minimum_price ?? null}
        max={service?.maximum_price ?? null}
        value={effectivePrice}
        onChange={setPrice}
        disabled={!!locked}
      />
      {error ? <Text tone="danger">{error}</Text> : null}
      <Button
        label={t("providerSetup.saveSubject")}
        disabled={!valid}
        loading={busy}
        onPress={() => void save()}
      />
    </View>
  );
}
