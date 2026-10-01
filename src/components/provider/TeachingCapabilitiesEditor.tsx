import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useMyTeachingCapabilities,
  useRemoveTeachingCapability,
  useTeachingCurricula,
  useTeachingLevels,
  useTeachingSubjectServices,
  useTeachingSubjects,
  useUpsertTeachingCapability,
  type ProviderTeachingCapabilityRow,
} from "@/lib/db/teaching-queries";
import {
  allowedDurationsForSubject,
  DEFAULT_SESSION_DURATION_MIN,
  formatTeachingCapabilityLine,
  localizedTaxonomyName,
} from "@/lib/tutoring/teachingCapabilities";
import {
  teachingLevelsForCurriculum,
  upsertTeachingCapabilitiesForLevels,
} from "@/lib/tutoring/teachingLevelFilters";
import { currentLang } from "@/lib/i18n";

type TutoringService = {
  id: string;
  name_en?: string;
  name_ar?: string;
  allowed_session_durations?: number[] | null;
  minimum_price?: number | null;
  maximum_price?: number | null;
};

export function TeachingCapabilitiesEditor({
  providerId,
  services,
}: {
  providerId: string;
  services: TutoringService[];
}) {
  const { t } = useTranslation();
  const lang = currentLang() === "ar" ? "ar" : "en";
  const mine = useMyTeachingCapabilities(providerId);
  const subjectsQ = useTeachingSubjects();
  const curriculaQ = useTeachingCurricula();
  const levelsQ = useTeachingLevels();
  const linksQ = useTeachingSubjectServices();
  const upsert = useUpsertTeachingCapability();
  const remove = useRemoveTeachingCapability();

  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [subjectId, setSubjectId] = useState("");
  const [curriculumId, setCurriculumId] = useState("");
  const [selectedLevelIds, setSelectedLevelIds] = useState<string[]>([]);
  const [duration, setDuration] = useState(DEFAULT_SESSION_DURATION_MIN);
  const [price, setPrice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const service = services.find((s) => s.id === serviceId) ?? services[0];
  const linkedSubjectIds = useMemo(
    () =>
      new Set(
        (linksQ.data ?? [])
          .filter((link) => link.service_id === (service?.id ?? serviceId))
          .map((link) => link.subject_id),
      ),
    [linksQ.data, service?.id, serviceId],
  );
  const subjects = (subjectsQ.data ?? []).filter((row) => linkedSubjectIds.has(row.id));
  const subject = subjects.find((row) => row.id === subjectId);
  const curriculum = (curriculaQ.data ?? []).find((row) => row.id === curriculumId);
  const filteredLevels = teachingLevelsForCurriculum(curriculum?.code, levelsQ.data ?? []);
  const durations = allowedDurationsForSubject(
    subject?.max_session_duration_min ?? 120,
    service?.allowed_session_durations ?? [60, 90, 120, 180],
  );

  useEffect(() => {
    if (!durations.includes(duration)) {
      setDuration(
        durations.includes(DEFAULT_SESSION_DURATION_MIN)
          ? DEFAULT_SESSION_DURATION_MIN
          : (durations[durations.length - 1] ?? DEFAULT_SESSION_DURATION_MIN),
      );
    }
  }, [durations, duration]);

  useEffect(() => {
    setSelectedLevelIds((current) =>
      current.filter((id) => filteredLevels.some((row) => row.id === id)),
    );
  }, [curriculumId, filteredLevels]);

  const resetForm = () => {
    setEditingId(null);
    setSubjectId("");
    setCurriculumId("");
    setSelectedLevelIds([]);
    setDuration(DEFAULT_SESSION_DURATION_MIN);
    setPrice("");
  };

  const startEdit = (row: ProviderTeachingCapabilityRow) => {
    setEditingId(row.id);
    setServiceId(row.service_id);
    setSubjectId(row.subject_id);
    setCurriculumId(row.curriculum_id);
    setSelectedLevelIds([row.level_id]);
    setDuration(row.session_duration_min as typeof DEFAULT_SESSION_DURATION_MIN);
    setPrice(String(row.session_price));
  };

  const toggleLevel = (levelId: string) => {
    if (editingId) {
      setSelectedLevelIds([levelId]);
      return;
    }
    setSelectedLevelIds((current) =>
      current.includes(levelId) ? current.filter((id) => id !== levelId) : [...current, levelId],
    );
  };

  const submit = async () => {
    if (!service?.id || !subjectId || !curriculumId || selectedLevelIds.length === 0) {
      toast.error(t("teaching.formIncomplete"));
      return;
    }
    const sessionPrice = Number(price);
    if (!Number.isInteger(sessionPrice) || sessionPrice <= 0) {
      toast.error(t("teaching.priceInvalid"));
      return;
    }
    setSubmitting(true);
    try {
      const outcomes = await upsertTeachingCapabilitiesForLevels(
        selectedLevelIds,
        {
          id: editingId,
          serviceId: service.id,
          subjectId,
          curriculumId,
          sessionDurationMin: duration,
          sessionPrice,
        },
        (input) => upsert.mutateAsync(input),
      );
      for (const outcome of outcomes) {
        const level = filteredLevels.find((row) => row.id === outcome.levelId);
        const label = level ? localizedTaxonomyName(level, lang) : outcome.levelId;
        if (outcome.ok) {
          toast.success(t("teaching.levelSavedPending", { level: label }));
        } else {
          toast.error(t("teaching.levelSaveFailed", { level: label, error: outcome.error }));
        }
      }
      if (outcomes.some((row) => row.ok)) {
        resetForm();
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (services.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-extrabold">{t("teaching.whatITeach")}</h3>
      <p className="text-xs text-muted-foreground">{t("teaching.editResetsApproval")}</p>
      <div className="grid gap-2">
        <select
          value={service?.id ?? serviceId}
          onChange={(e) => {
            setServiceId(e.target.value);
            setSubjectId("");
          }}
          className="h-11 rounded-xl border border-border bg-surface px-3 text-sm"
        >
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {lang === "ar" ? s.name_ar || s.name_en : s.name_en || s.name_ar}
            </option>
          ))}
        </select>
        <select
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          className="h-11 rounded-xl border border-border bg-surface px-3 text-sm"
        >
          <option value="">{t("teaching.subject")}</option>
          {subjects.map((row) => (
            <option key={row.id} value={row.id}>
              {localizedTaxonomyName(row, lang)}
            </option>
          ))}
        </select>
        <select
          value={curriculumId}
          onChange={(e) => setCurriculumId(e.target.value)}
          className="h-11 rounded-xl border border-border bg-surface px-3 text-sm"
        >
          <option value="">{t("teaching.curriculum")}</option>
          {(curriculaQ.data ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {localizedTaxonomyName(row, lang)}
            </option>
          ))}
        </select>
        {curriculum?.code === "british" ? (
          <p className="text-[11px] text-muted-foreground">{t("teaching.britishLevelHint")}</p>
        ) : null}
        {curriculumId ? (
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("teaching.level")}
            </div>
            <div className="flex flex-wrap gap-2">
              {filteredLevels.map((row) => {
                const on = selectedLevelIds.includes(row.id);
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => toggleLevel(row.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${
                      on ? "bg-brand text-brand-foreground" : "border border-border"
                    }`}
                  >
                    {localizedTaxonomyName(row, lang)}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {durations.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setDuration(value)}
              className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${duration === value ? "bg-brand text-brand-foreground" : "border border-border"}`}
            >
              {value} {t("common.min")}
            </button>
          ))}
        </div>
        <input
          type="number"
          min={service?.minimum_price ?? 300}
          max={service?.maximum_price ?? 1500}
          step={1}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder={t("teaching.pricePlaceholder", {
            min: service?.minimum_price ?? 300,
            max: service?.maximum_price ?? 1500,
          })}
          className="h-11 rounded-xl border border-border bg-surface px-3 text-sm"
        />
        <p className="text-[11px] text-muted-foreground">
          {t("teaching.priceRange", {
            min: service?.minimum_price ?? 300,
            max: service?.maximum_price ?? 1500,
          })}
        </p>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || upsert.isPending}
          className="h-11 rounded-xl bg-brand text-sm font-extrabold text-brand-foreground disabled:opacity-50"
        >
          {editingId ? t("teaching.saveChanges") : t("teaching.addCapability")}
        </button>
        {editingId ? (
          <button
            type="button"
            onClick={resetForm}
            className="text-xs font-bold text-muted-foreground"
          >
            {t("common.cancel")}
          </button>
        ) : null}
      </div>
      <ul className="space-y-2">
        {(mine.data ?? []).map((row) => {
          const line = formatTeachingCapabilityLine({
            subject: localizedTaxonomyName(row.subject ?? {}, lang),
            curriculum: localizedTaxonomyName(row.curriculum ?? {}, lang),
            level: localizedTaxonomyName(row.level ?? {}, lang),
            durationMin: row.session_duration_min,
            price: row.session_price,
          });
          return (
            <li key={row.id} className="rounded-2xl border border-border/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-bold leading-snug">{line}</p>
                <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-extrabold uppercase">
                  {t(`teaching.status.${row.status}`)}
                </span>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(row)}
                  className="text-[11px] font-bold text-brand"
                >
                  {t("common.edit")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    remove.mutate(row.id, {
                      onError: (error: unknown) =>
                        toast.error(
                          error instanceof Error ? error.message : t("common.somethingWentWrong"),
                        ),
                    })
                  }
                  className="text-[11px] font-bold text-coral"
                >
                  {t("common.delete")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
