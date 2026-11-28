import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton } from "@/components/famio/ui";
import { ICON_STROKE } from "@/lib/icons/constants";
import { currentLang } from "@/lib/i18n";
import { formatNumber } from "@/lib/format";
import { useQuranCatalog, useSubmitLessonReport } from "@/lib/db/lesson-report-queries";
import {
  COVERED_MAX,
  HOMEWORK_MAX,
  MUSIC_INSTRUMENTS,
  MUSIC_LEVELS,
  PIECE_MAX,
  QURAN_ENTRIES_MAX,
  QURAN_ENTRY_KINDS,
  UNDERSTANDING_VALUES,
  emptyDraft,
  juzRange,
  lessonReportErrorKey,
  quranKindFromSubject,
  surahRange,
  validateDraft,
  type DraftError,
  type JuzStart,
  type LessonReport,
  type LessonReportDraft,
  type LessonReportKind,
  type Surah,
} from "@/lib/lessonReports/lessonReports";

const fieldClass =
  "focus-ring w-full rounded-2xl border border-border/70 bg-surface px-3 py-2.5 text-pro-14 text-foreground";

function ChoiceRow<T extends string>({
  name,
  values,
  value,
  label,
  onChange,
}: {
  name: string;
  values: readonly T[];
  value: T | null;
  label: (v: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-2">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`focus-ring min-h-11 rounded-full px-4 py-2 text-pro-13 font-bold transition-colors ${
            value === v
              ? "bg-brand text-brand-foreground"
              : "bg-surface-2 text-foreground hover:bg-muted"
          }`}
        >
          {label(v)}
        </button>
      ))}
    </div>
  );
}

/** The tutor's lesson report form (new or edit). */
export function LessonReportForm({
  bookingId,
  kind,
  subjectCode,
  existing,
  onDone,
}: {
  bookingId: string;
  kind: LessonReportKind;
  subjectCode: string | null;
  existing: LessonReport | null;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const lang = currentLang();
  const [draft, setDraft] = useState<LessonReportDraft>(() =>
    emptyDraft(kind, subjectCode, existing),
  );
  const [showErrors, setShowErrors] = useState(false);
  const catalogQ = useQuranCatalog(kind === "quran");
  const submit = useSubmitLessonReport(bookingId);
  const surahs = useMemo(() => catalogQ.data?.surahs ?? [], [catalogQ.data]);
  const errors = useMemo(
    () => (kind === "quran" && !surahs.length ? [] : validateDraft(kind, draft, surahs)),
    [kind, draft, surahs],
  );
  const has = (e: DraftError) => showErrors && errors.includes(e);
  const set = (patch: Partial<LessonReportDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const onSubmit = () => {
    setShowErrors(true);
    if (errors.length || (kind === "quran" && !surahs.length)) return;
    submit.mutate(
      { kind, draft },
      {
        onSuccess: () => {
          toast.success(existing ? t("lessonReport.write.saved") : t("lessonReport.write.sent"));
          onDone?.();
        },
        onError: (error) => toast.error(t(lessonReportErrorKey(error))),
      },
    );
  };

  return (
    <form
      className="space-y-4"
      data-testid="lesson-report-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      noValidate
    >
      <p className="text-pro-13 text-muted-foreground">{t("lessonReport.write.lead")}</p>

      <label className="block space-y-1.5">
        <span className="text-pro-13 font-bold">{t("lessonReport.covered")}</span>
        <textarea
          className={`${fieldClass} min-h-24`}
          value={draft.covered}
          maxLength={COVERED_MAX}
          placeholder={t("lessonReport.write.coveredPlaceholder")}
          aria-invalid={has("covered")}
          onChange={(e) => set({ covered: e.target.value })}
          data-testid="lesson-report-covered"
        />
        {has("covered") ? (
          <span className="text-pro-12 font-bold text-coral">
            {t("lessonReport.fieldErrors.covered")}
          </span>
        ) : null}
      </label>

      {kind === "quran" ? (
        <QuranRanges
          draft={draft}
          setDraft={setDraft}
          surahs={surahs}
          juz={catalogQ.data?.juz ?? []}
          loading={catalogQ.isLoading}
          loadError={catalogQ.isError}
          onRetry={() => void catalogQ.refetch()}
          subjectCode={subjectCode}
          error={has("quranRequired") ? "quranRequired" : has("quranRange") ? "quranRange" : null}
          lang={lang}
        />
      ) : null}

      {kind === "music" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-pro-13 font-bold">{t("lessonReport.instrument")}</p>
            <ChoiceRow
              name={t("lessonReport.instrument")}
              values={MUSIC_INSTRUMENTS}
              value={draft.musicInstrument}
              label={(v) => t(`lessonReport.instruments.${v}`)}
              onChange={(v) => set({ musicInstrument: v })}
            />
            {has("musicInstrument") ? (
              <p className="text-pro-12 font-bold text-coral">
                {t("lessonReport.fieldErrors.musicInstrument")}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <p className="text-pro-13 font-bold">{t("lessonReport.level")}</p>
            <ChoiceRow
              name={t("lessonReport.level")}
              values={MUSIC_LEVELS}
              value={draft.musicLevel}
              label={(v) => t(`lessonReport.levels.${v}`)}
              onChange={(v) => set({ musicLevel: v })}
            />
            {has("musicLevel") ? (
              <p className="text-pro-12 font-bold text-coral">
                {t("lessonReport.fieldErrors.musicLevel")}
              </p>
            ) : null}
          </div>
          <label className="block space-y-1.5">
            <span className="text-pro-13 font-bold">{t("lessonReport.piece")}</span>
            <input
              className={fieldClass}
              value={draft.musicPiece}
              maxLength={PIECE_MAX}
              placeholder={t("lessonReport.write.piecePlaceholder")}
              onChange={(e) => set({ musicPiece: e.target.value })}
            />
          </label>
        </div>
      ) : null}

      <label className="block space-y-1.5">
        <span className="text-pro-13 font-bold">{t("lessonReport.homework")}</span>
        <textarea
          className={`${fieldClass} min-h-20`}
          value={draft.homework}
          maxLength={HOMEWORK_MAX}
          placeholder={t("lessonReport.write.homeworkPlaceholder")}
          onChange={(e) => set({ homework: e.target.value })}
          data-testid="lesson-report-homework"
        />
      </label>

      <div className="space-y-1.5">
        <p className="text-pro-13 font-bold">{t("lessonReport.understanding")}</p>
        <ChoiceRow
          name={t("lessonReport.understanding")}
          values={UNDERSTANDING_VALUES}
          value={draft.understanding}
          label={(v) => t(`lessonReport.understandingValues.${v}`)}
          onChange={(v) => set({ understanding: v })}
        />
        {has("understanding") ? (
          <p className="text-pro-12 font-bold text-coral">
            {t("lessonReport.fieldErrors.understanding")}
          </p>
        ) : null}
      </div>

      <PrimaryButton
        type="submit"
        className="h-12"
        disabled={submit.isPending}
        data-testid="lesson-report-submit"
      >
        {existing ? t("lessonReport.write.save") : t("lessonReport.write.submit")}
      </PrimaryButton>
      <p className="text-center text-pro-12 text-muted-foreground">
        {t("lessonReport.write.editHint")}
      </p>
    </form>
  );
}

function QuranRanges({
  draft,
  setDraft,
  surahs,
  juz,
  loading,
  loadError,
  onRetry,
  subjectCode,
  error,
  lang,
}: {
  draft: LessonReportDraft;
  setDraft: React.Dispatch<React.SetStateAction<LessonReportDraft>>;
  surahs: Surah[];
  juz: JuzStart[];
  loading: boolean;
  loadError: boolean;
  onRetry: () => void;
  subjectCode: string | null;
  error: "quranRequired" | "quranRange" | null;
  lang: string;
}) {
  const { t } = useTranslation();
  if (loading) return <p className="text-pro-13 text-muted-foreground">{t("common.loading")}</p>;
  if (loadError) {
    return (
      <div className="space-y-2">
        <p className="text-pro-13 text-coral">{t("lessonReport.loadError")}</p>
        <button
          type="button"
          className="text-pro-13 font-bold text-brand underline"
          onClick={onRetry}
        >
          {t("common.tryAgain")}
        </button>
      </div>
    );
  }
  const num = (n: number) => formatNumber(n, lang);
  const surahName = (s: Surah) => `${num(s.number)}. ${lang === "ar" ? s.name_ar : s.name_en}`;
  const update = (i: number, patch: Partial<LessonReportDraft["quran"][number]>) =>
    setDraft((d) => ({ ...d, quran: d.quran.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));
  const remove = (i: number) =>
    setDraft((d) => ({ ...d, quran: d.quran.filter((_, j) => j !== i) }));
  const add = () =>
    setDraft((d) => ({
      ...d,
      quran: [
        ...d.quran,
        {
          kind: d.quran.length ? "review" : quranKindFromSubject(subjectCode),
          ...surahRange(surahs[0]!),
        },
      ],
    }));

  return (
    <fieldset className="space-y-3">
      <legend className="text-pro-13 font-bold">{t("lessonReport.write.quranLead")}</legend>
      {draft.quran.map((e, i) => {
        const fromSurah = surahs.find((s) => s.number === e.from_surah);
        const toSurah = surahs.find((s) => s.number === e.to_surah);
        return (
          <div
            key={i}
            className="space-y-3 rounded-2xl border border-border/60 bg-surface-2/40 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <ChoiceRow
                name={t("lessonReport.write.rangeKind")}
                values={QURAN_ENTRY_KINDS}
                value={e.kind}
                label={(v) => t(`lessonReport.quranKinds.${v}`)}
                onChange={(v) => update(i, { kind: v })}
              />
              {draft.quran.length > 1 ? (
                <button
                  type="button"
                  aria-label={t("lessonReport.write.removeRange")}
                  className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full text-coral hover:bg-coral/10"
                  onClick={() => remove(i)}
                >
                  <Trash2 className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden />
                </button>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(["from", "to"] as const).map((side) => {
                const surahKey = side === "from" ? "from_surah" : "to_surah";
                const ayahKey = side === "from" ? "from_ayah" : "to_ayah";
                const selected = side === "from" ? fromSurah : toSurah;
                return (
                  <div key={side} className="min-w-0 space-y-1.5">
                    <p className="text-pro-12 font-bold text-muted-foreground">
                      {t(`lessonReport.write.${side}`)}
                    </p>
                    <div className="flex gap-2">
                      <select
                        className={`${fieldClass} min-w-0 flex-1`}
                        aria-label={`${t(`lessonReport.write.${side}`)} · ${t("lessonReport.write.surah")}`}
                        value={e[surahKey]}
                        onChange={(ev) => {
                          const n = Number(ev.target.value);
                          const s = surahs.find((x) => x.number === n);
                          update(i, {
                            [surahKey]: n,
                            [ayahKey]: side === "from" ? 1 : (s?.ayah_count ?? 1),
                          } as Partial<LessonReportDraft["quran"][number]>);
                        }}
                      >
                        {surahs.map((s) => (
                          <option key={s.number} value={s.number}>
                            {surahName(s)}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={selected?.ayah_count ?? 286}
                        className={`${fieldClass} w-20 shrink-0 tabular-nums`}
                        aria-label={`${t(`lessonReport.write.${side}`)} · ${t("lessonReport.write.ayah")}`}
                        value={Number.isFinite(e[ayahKey]) ? e[ayahKey] : ""}
                        onChange={(ev) =>
                          update(i, {
                            [ayahKey]:
                              ev.target.value === ""
                                ? Number.NaN
                                : Math.trunc(Number(ev.target.value)),
                          } as Partial<LessonReportDraft["quran"][number]>)
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="focus-ring min-h-11 rounded-full border border-border/70 px-4 text-pro-12 font-bold"
                onClick={() => fromSurah && update(i, surahRange(fromSurah))}
              >
                {t("lessonReport.write.wholeSurah")}
              </button>
              <select
                className="focus-ring min-h-11 rounded-full border border-border/70 bg-surface px-3 text-pro-12 font-bold"
                aria-label={t("lessonReport.write.wholeJuz")}
                value=""
                onChange={(ev) => {
                  const r = juzRange(Number(ev.target.value), juz, surahs);
                  if (r) update(i, r);
                }}
              >
                <option value="">{t("lessonReport.write.wholeJuz")}</option>
                {juz.map((j) => (
                  <option key={j.juz} value={j.juz}>
                    {t("lessonReport.write.juzLabel", { n: num(j.juz) })}
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      })}
      {error ? (
        <p className="text-pro-12 font-bold text-coral">{t(`lessonReport.fieldErrors.${error}`)}</p>
      ) : null}
      {draft.quran.length < QURAN_ENTRIES_MAX ? (
        <button
          type="button"
          className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-pro-13 font-bold text-brand"
          onClick={add}
        >
          <Plus className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
          {t("lessonReport.write.addRange")}
        </button>
      ) : null}
    </fieldset>
  );
}
