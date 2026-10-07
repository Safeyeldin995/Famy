import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SetupScreen } from "@/components/famio/SetupScreen";
import { BottomSheetSelect } from "@/components/famio/BottomSheetSelect";
import { CheckChip } from "@/components/famio/CheckChip";
import { PriceStepper } from "@/components/famio/PriceStepper";
import type {
  ProviderTeachingCapabilityRow,
  TeachingCurriculumRow,
  TeachingLevelRow,
  TeachingSubjectRow,
  TeachingSubjectServiceRow,
} from "@/lib/db/teaching-queries";
import type { SaveTeachingGroup } from "@/lib/db/teaching-group-queries";
import { groupTeachingRows, teachingLevelDiff } from "@/lib/tutoring/teachingGroups";
import { teachingLevelsForCurriculum } from "@/lib/tutoring/teachingLevelFilters";
import { allowedDurationsForSubject } from "@/lib/tutoring/teachingCapabilities";
import { teachingMissingChoice } from "@/lib/tutoring/teachingEditorState";
import { isPriceInRange } from "@/lib/provider/priceOptions";
export type SetupTeachingService = {
  id: string;
  name_ar: string;
  name_en: string;
  minimum_price?: number | null;
  maximum_price?: number | null;
  allowed_session_durations?: number[] | null;
};
export function GroupedTeachingSetup({
  services,
  subjects,
  curricula,
  levels,
  links,
  rows,
  onSave,
  onRemove,
  onBack,
}: {
  services: SetupTeachingService[];
  subjects: TeachingSubjectRow[];
  curricula: TeachingCurriculumRow[];
  levels: TeachingLevelRow[];
  links: TeachingSubjectServiceRow[];
  rows: ProviderTeachingCapabilityRow[];
  onSave: (input: SaveTeachingGroup) => Promise<void>;
  onRemove: (ids: string[]) => Promise<void>;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const name = (row: { name_ar: string; name_en: string }) => (ar ? row.name_ar : row.name_en);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [subjectId, setSubjectId] = useState("");
  const [curriculumId, setCurriculumId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [duration, setDuration] = useState(60);
  const [price, setPrice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const service = services.find((row) => row.id === serviceId);
  const subject = subjects.find((row) => row.id === subjectId);
  const curriculum = curricula.find((row) => row.id === curriculumId);
  const saved = rows.filter(
    (row) =>
      row.service_id === serviceId &&
      row.subject_id === subjectId &&
      row.curriculum_id === curriculumId,
  );
  const diff = teachingLevelDiff(saved, selected);
  const chosen = [...new Set([...selected, ...diff.lockedApproved.map((row) => row.level_id)])];
  const durations = allowedDurationsForSubject(
    subject?.max_session_duration_min ?? 120,
    service?.allowed_session_durations ?? [60, 90, 120, 180],
  );
  const effectiveDuration = durations.find((value) => value === duration) ?? durations[0];
  const filteredLevels = teachingLevelsForCurriculum(curriculum?.code, levels);
  const availableSubjects = subjects.filter((row) =>
    links.some((link) => link.subject_id === row.id && link.service_id === serviceId),
  );
  const missing = teachingMissingChoice(
    subjectId,
    curriculumId,
    chosen,
    isPriceInRange(price, service?.minimum_price ?? null, service?.maximum_price ?? null),
  );
  const save = async () => {
    if (!service || missing || !effectiveDuration || price == null) return;
    setBusy(true);
    setError("");
    try {
      await onSave({
        serviceId,
        subjectId,
        curriculumId,
        levelIds: chosen,
        sessionDurationMin: effectiveDuration,
        sessionPrice: price,
      });
    } catch {
      setError(t("providerApply.saveError"));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setSelected([]);
    setPrice(null);
    setError("");
  };
  return (
    <SetupScreen
      title={t("teaching.whatITeach")}
      hint={t("providerSetup.hints.subjects")}
      saveLabel={t("providerSetup.saveSubject")}
      onBack={onBack}
      onSave={() => void save()}
      disabled={!!missing || !service || !effectiveDuration}
      missing={missing ? t(`teaching.missing.${missing}`) : undefined}
      busy={busy}
      error={error}
    >
      <fieldset className="contents" disabled={busy}>
        {services.length > 1 && (
          <BottomSheetSelect
            label={t("teaching.service")}
            value={serviceId}
            options={services.map((row) => ({ value: row.id, label: name(row) }))}
            onChange={(value) => {
              setServiceId(value);
              setSubjectId("");
              setCurriculumId("");
              reset();
            }}
          />
        )}
        {!services.length && <p role="status">{t("providerSetup.noTeachingServices")}</p>}
        <BottomSheetSelect
          label={t("teaching.subject")}
          value={subjectId}
          options={availableSubjects.map((row) => ({ value: row.id, label: name(row) }))}
          onChange={(value) => {
            setSubjectId(value);
            reset();
          }}
        />
        <BottomSheetSelect
          label={t("teaching.curriculum")}
          value={curriculumId}
          options={curricula.map((row) => ({ value: row.id, label: name(row) }))}
          onChange={(value) => {
            setCurriculumId(value);
            reset();
          }}
        />
        <p className="apply-label">{t("teaching.level")}</p>
        <div className="flex flex-wrap gap-2">
          {(curriculumId ? filteredLevels : []).map((row) => (
            <CheckChip
              key={row.id}
              selected={chosen.includes(row.id)}
              disabled={diff.lockedApproved.some((r) => r.level_id === row.id)}
              onClick={() =>
                setSelected((ids) =>
                  ids.includes(row.id) ? ids.filter((id) => id !== row.id) : [...ids, row.id],
                )
              }
            >
              {name(row)}
            </CheckChip>
          ))}
        </div>
        {!!diff.lockedApproved.length && (
          <p className="text-xs text-muted-foreground">{t("providerSetup.approvedLocked")}</p>
        )}
        {durations.length === 1 ? (
          <p className="text-sm">
            {durations[0]} {t("common.min")}
          </p>
        ) : (
          <BottomSheetSelect
            label={t("providerSetup.duration")}
            value={String(effectiveDuration ?? "")}
            options={durations.map((value) => ({
              value: String(value),
              label: `${value} ${t("common.min")}`,
            }))}
            onChange={(value) => setDuration(Number(value))}
          />
        )}
        <PriceStepper
          min={service?.minimum_price ?? null}
          max={service?.maximum_price ?? null}
          value={price}
          onChange={setPrice}
          unitLabel={t("pricePicker.sessionUnit")}
        />
        <ul className="grid gap-3">
          {groupTeachingRows(rows).map((group) => (
            <li key={group.key} className="rounded-2xl bg-surface-2 p-3">
              <p className="text-sm font-bold">
                {group.first.subject ? name(group.first.subject) : ""} ·{" "}
                {group.first.curriculum ? name(group.first.curriculum) : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {group.rows.map((row) => (row.level ? name(row.level) : "")).join(" · ")} ·{" "}
                {group.first.session_price} {t("pricePicker.sessionUnit")}
              </p>
              <div className="flex flex-wrap gap-2">
                {[...new Set(group.rows.map((row) => row.status))].map((status) => (
                  <span key={status} className="apply-tag apply-time">
                    {t(`teaching.status.${status}`)}
                  </span>
                ))}
              </div>
              <div className="flex gap-4">
                <button
                  type="button"
                  className="min-h-11 font-bold text-brand"
                  onClick={() => {
                    setServiceId(group.first.service_id);
                    setSubjectId(group.first.subject_id);
                    setCurriculumId(group.first.curriculum_id);
                    setSelected(group.rows.map((row) => row.level_id));
                    setDuration(group.first.session_duration_min);
                    setPrice(group.first.session_price);
                  }}
                >
                  {t("common.edit")}
                </button>
                {group.rows.some((row) => row.status !== "approved") && (
                  <button
                    type="button"
                    className="min-h-11 text-destructive"
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        await onRemove(
                          teachingLevelDiff(group.rows, []).removable.map((row) => row.id),
                        );
                      } catch {
                        setError(t("providerApply.saveError"));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {t("common.delete")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </fieldset>
    </SetupScreen>
  );
}
