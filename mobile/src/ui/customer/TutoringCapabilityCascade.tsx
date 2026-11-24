import { useEffect, useMemo } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TeachingCapabilityOption } from "@shared/tutoring/teachingCapabilities";
import { serviceRequiresTeachingCurriculum } from "@shared/tutoring/lessonServices";
import {
  approvedCapabilitiesForService,
  capabilitiesMatchingPick,
  coerceCapabilityPick,
  curriculumOptionsFromCapabilities,
  levelOptionsFromCapabilities,
  subjectOptionsFromCapabilities,
  type CapabilityPickValue,
} from "@shared/tutoring/providerCapabilityCascade";
import { BottomSheetSelect } from "@/ui/provider/BottomSheetSelect";
import { Choices } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { space } from "@/ui/theme";

export function TutoringCapabilityCascade({
  serviceId,
  serviceSlug,
  capabilities,
  pick,
  capabilityId,
  onPickChange,
  onCapabilityChange,
}: {
  serviceId: string;
  serviceSlug: string | null | undefined;
  capabilities: TeachingCapabilityOption[];
  pick: CapabilityPickValue;
  capabilityId: string;
  onPickChange: (next: CapabilityPickValue, source?: "user" | "normalize") => void;
  onCapabilityChange: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("ar") ? "ar" : "en";
  const requiresCurriculum = serviceRequiresTeachingCurriculum(serviceSlug);
  const approved = useMemo(
    () => approvedCapabilitiesForService(capabilities, serviceId),
    [capabilities, serviceId],
  );
  const subjects = useMemo(
    () => subjectOptionsFromCapabilities(approved, lang),
    [approved, lang],
  );
  const curricula = useMemo(
    () => curriculumOptionsFromCapabilities(approved, pick.subjectCode, lang),
    [approved, pick.subjectCode, lang],
  );
  const levels = useMemo(
    () => levelOptionsFromCapabilities(approved, pick.subjectCode, pick.curriculumId, lang),
    [approved, pick.curriculumId, pick.subjectCode, lang],
  );
  const durationOptions = useMemo(
    () => capabilitiesMatchingPick(approved, pick),
    [approved, pick],
  );

  useEffect(() => {
    if (!approved.length) return;
    const coerced = coerceCapabilityPick(approved, pick, requiresCurriculum);
    if (
      coerced.subjectCode !== pick.subjectCode ||
      coerced.curriculumId !== pick.curriculumId ||
      coerced.levelId !== pick.levelId
    ) {
      onPickChange(coerced, "normalize");
    }
  }, [approved, pick, requiresCurriculum, onPickChange]);

  useEffect(() => {
    if (!durationOptions.length) {
      if (capabilityId) onCapabilityChange("");
      return;
    }
    if (capabilityId && durationOptions.some((row) => row.id === capabilityId)) return;
    if (durationOptions.length === 1) onCapabilityChange(durationOptions[0]!.id);
  }, [capabilityId, durationOptions, onCapabilityChange]);

  if (!approved.length) {
    return <Text>{t("customerRound2.noCapabilities")}</Text>;
  }

  return (
    <View style={{ gap: space.lg }}>
      <BottomSheetSelect
        label={t("teaching.subject")}
        value={pick.subjectCode}
        options={subjects}
        onChange={(subjectCode) => {
          onPickChange({ subjectCode, curriculumId: "", levelId: "" });
          onCapabilityChange("");
        }}
      />
      {requiresCurriculum ? (
        <BottomSheetSelect
          label={t("studentEducation.curriculum")}
          value={pick.curriculumId}
          disabled={!pick.subjectCode}
          options={curricula}
          onChange={(curriculumId) => {
            onPickChange({ ...pick, curriculumId, levelId: "" });
            onCapabilityChange("");
          }}
        />
      ) : null}
      <BottomSheetSelect
        label={t("studentEducation.grade")}
        value={pick.levelId}
        disabled={requiresCurriculum ? !pick.curriculumId : !pick.subjectCode}
        options={levels}
        onChange={(levelId) => {
          onPickChange({ ...pick, levelId });
          onCapabilityChange("");
        }}
      />
      {durationOptions.length > 0 ? (
        <Choices
          label={t("customerBooking.sessionDuration")}
          value={capabilityId}
          onChange={onCapabilityChange}
          options={durationOptions.map((cap) => ({
            value: cap.id,
            label: t("bookFlow.sessionLine", { minutes: String(cap.durationMin) }),
          }))}
          layout="chips"
        />
      ) : null}
    </View>
  );
}