import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheetSelect } from "@/components/famio/BottomSheetSelect";
import { CheckChip } from "@/components/famio/CheckChip";
import type { TeachingCapabilityOption } from "@/lib/tutoring/teachingCapabilities";
import { serviceRequiresTeachingCurriculum } from "@/lib/tutoring/lessonServices";
import { currentLang } from "@/lib/i18n";
import {
  approvedCapabilitiesForService,
  capabilityPickAwaitingGrade,
  coerceCapabilityPick,
  curriculumOptionsFromCapabilities,
  durationOptionsFromCapabilityPick,
  levelOptionsFromCapabilities,
  subjectOptionsFromCapabilities,
  type CapabilityPickValue,
} from "@/lib/tutoring/providerCapabilityCascade";
import { formatEGP, formatNumber } from "@/lib/format";

export function TutoringCapabilityCascadeFields({
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
  capabilityId: string | null;
  onPickChange: (next: CapabilityPickValue, source?: "user" | "normalize") => void;
  onCapabilityChange: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const lang = currentLang() === "ar" ? "ar" : "en";
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
    () =>
      levelOptionsFromCapabilities(
        approved,
        pick.subjectCode,
        pick.curriculumId,
        lang,
      ),
    [approved, pick.curriculumId, pick.subjectCode, lang],
  );
  const awaitingGrade = capabilityPickAwaitingGrade(pick, requiresCurriculum);
  const durationOptions = useMemo(
    () => durationOptionsFromCapabilityPick(approved, pick, requiresCurriculum),
    [approved, pick, requiresCurriculum],
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
      if (capabilityId) onCapabilityChange(null);
      return;
    }
    if (capabilityId && durationOptions.some((row) => row.id === capabilityId)) return;
    if (durationOptions.length === 1) onCapabilityChange(durationOptions[0]!.id);
  }, [capabilityId, durationOptions, onCapabilityChange]);

  const setSubject = (subjectCode: string) => {
    onPickChange({ subjectCode, curriculumId: "", levelId: "" });
    onCapabilityChange(null);
  };
  const setCurriculum = (curriculumId: string) => {
    onPickChange({ ...pick, curriculumId, levelId: "" });
    onCapabilityChange(null);
  };
  const setLevel = (levelId: string) => {
    onPickChange({ ...pick, levelId });
    onCapabilityChange(null);
  };

  if (!approved.length) {
    return <p>{t("customerRound2.noCapabilities")}</p>;
  }

  return (
    <div className="space-y-3">
      <BottomSheetSelect
        label={t("teaching.subject")}
        value={pick.subjectCode}
        options={subjects}
        onChange={setSubject}
      />
      {requiresCurriculum ? (
        <BottomSheetSelect
          label={t("studentEducation.curriculum")}
          value={pick.curriculumId}
          disabled={!pick.subjectCode}
          options={curricula}
          onChange={setCurriculum}
        />
      ) : null}
      <BottomSheetSelect
        label={t("studentEducation.grade")}
        value={pick.levelId}
        disabled={requiresCurriculum ? !pick.curriculumId : !pick.subjectCode}
        options={levels}
        onChange={setLevel}
      />
      {awaitingGrade ? (
        <p className="text-pro-13 text-muted-foreground">{t("customerBooking.pickGradeFirst")}</p>
      ) : durationOptions.length > 0 ? (
        <div>
          <span className="apply-label">{t("customerBooking.sessionDuration")}</span>
          <div className="apply-chips">
            {durationOptions.map((cap) => (
              <CheckChip
                key={cap.id}
                selected={cap.id === capabilityId}
                onClick={() => onCapabilityChange(cap.id)}
              >
                {t("customerBooking.durationPriceChip", {
                  minutes: formatNumber(cap.durationMin, lang),
                  price: formatEGP(cap.price, undefined, lang),
                })}
              </CheckChip>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}