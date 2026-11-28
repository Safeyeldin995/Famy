// Lesson report on a booking screen (migration 20261128140000): the tutor writes or
// edits it after the lesson; the family reads it. Mirrors the website's
// LessonReportSection / LessonReportForm / LessonReportView.
import { useMemo, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import {
  BookOpen,
  ClipboardList,
  LineChart,
  Music2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react-native";
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
  formatQuranRange,
  juzRange,
  lessonReportErrorKey,
  quranKindFromSubject,
  surahRange,
  validateDraft,
  type DraftError,
  type LessonReport,
  type LessonReportDraft,
  type LessonReportKind,
} from "@shared/lessonReports/lessonReports";
import { useLessonReport, useQuranCatalog, useSubmitLessonReport } from "@/lib/lessonReportQueries";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { Choices, ui } from "@/ui/Page";
import { bodyTextInputProps } from "@/ui/a11y";
import { customerStyle } from "@/ui/customer/Primitives";
import { BottomSheetSelect } from "@/ui/provider/BottomSheetSelect";
import { colors, fonts, radius, space } from "@/ui/theme";

const DONE_STATUSES = new Set(["completed", "completion_requested"]);

export function LessonReportCard({
  bookingId,
  bookingStatus,
  tutorName,
  showProgressLink = false,
}: {
  bookingId: string;
  bookingStatus: string;
  tutorName?: string | null;
  showProgressLink?: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const enabled = DONE_STATUSES.has(bookingStatus);
  const q = useLessonReport(bookingId, enabled);
  if (!enabled) return null;
  if (q.isLoading) {
    return (
      <View style={customerStyle.card} accessibilityState={{ busy: true }}>
        <Text tone="muted">{t("common.loading")}</Text>
      </View>
    );
  }
  if (q.isError) {
    return (
      <View style={customerStyle.card}>
        <Text tone="danger">{t("lessonReport.loadError")}</Text>
        <Button variant="ghost" label={t("common.tryAgain")} onPress={() => void q.refetch()} />
      </View>
    );
  }
  const ctx = q.data;
  if (!ctx?.eligible || !ctx.kind) return null;
  const isTutor = ctx.viewer_role === "provider";
  const showForm = isTutor && ctx.can_write && (!ctx.report || editing);
  const progressLabel =
    ctx.learner_is_child && ctx.learner_name
      ? t("learnerProgress.linkLabel", { name: ctx.learner_name })
      : t("learnerProgress.selfLinkLabel");

  return (
    <View style={customerStyle.card} testID="lesson-report-section">
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <ClipboardList size={20} color={colors.brand} />
        <Text weight="heavy" size="lg" style={{ flex: 1 }} accessibilityRole="header">
          {showForm
            ? ctx.report
              ? t("lessonReport.write.editTitle")
              : t("lessonReport.write.title")
            : t("lessonReport.title")}
        </Text>
        {isTutor && ctx.report && ctx.can_write && !editing ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("lessonReport.write.editTitle")}
            onPress={() => setEditing(true)}
            hitSlop={8}
            style={{ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" }}
          >
            <Pencil size={18} color={colors.brand} />
          </Pressable>
        ) : null}
      </View>

      {showForm ? (
        <LessonReportForm
          bookingId={bookingId}
          kind={ctx.kind}
          subjectCode={ctx.subject_code}
          existing={ctx.report}
          onDone={() => setEditing(false)}
        />
      ) : ctx.report ? (
        <LessonReportBody report={ctx.report} tutorName={isTutor ? null : tutorName} />
      ) : (
        <Text tone="muted">{t("lessonReport.waitingAfter")}</Text>
      )}

      {showProgressLink && !isTutor ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={progressLabel}
          onPress={() =>
            router.push({
              pathname: "/progress/[id]",
              params: { id: ctx.learner_is_child ? ctx.learner_id : "me" },
            })
          }
          style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: 44 }}
        >
          <LineChart size={16} color={colors.brandText} />
          <Text weight="bold" tone="brand">
            {progressLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const UNDERSTANDING_COLORS: Record<string, { bg: string; fg: string }> = {
  needs_support: { bg: colors.warningTint, fg: colors.warning },
  good: { bg: colors.brandTint, fg: colors.brandText },
  excellent: { bg: colors.successTint, fg: colors.success },
};

export function LessonReportBody({
  report,
  tutorName,
}: {
  report: LessonReport;
  tutorName?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "ar";
  const tone = UNDERSTANDING_COLORS[report.understanding];
  return (
    <View style={{ gap: space.md }} testID="lesson-report-view">
      {tutorName ? (
        <Text size="sm" tone="muted">
          {t("lessonReport.by", { name: tutorName })}
        </Text>
      ) : null}
      <View style={{ gap: 2 }}>
        <Text size="sm" weight="bold" tone="muted">
          {t("lessonReport.covered")}
        </Text>
        <Text>{report.covered}</Text>
      </View>
      <View style={{ gap: 2 }}>
        <Text size="sm" weight="bold" tone="muted">
          {t("lessonReport.homework")}
        </Text>
        <Text>{report.homework || t("lessonReport.noHomework")}</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
        <Text size="sm" weight="bold" tone="muted">
          {t("lessonReport.understanding")}
        </Text>
        <View
          style={{
            backgroundColor: tone?.bg ?? colors.surface2,
            borderRadius: radius.pill,
            paddingHorizontal: space.md,
            paddingVertical: space.xs,
          }}
        >
          <Text size="sm" weight="bold" style={{ color: tone?.fg ?? colors.foreground }}>
            {t(`lessonReport.understandingValues.${report.understanding}`)}
          </Text>
        </View>
      </View>
      {report.kind === "quran" && report.quran.length ? (
        <View style={{ gap: space.xs }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <BookOpen size={16} color={colors.muted} />
            <Text size="sm" weight="bold" tone="muted">
              {t("lessonReport.quranTitle")}
            </Text>
          </View>
          {report.quran.map((e, i) => (
            <Text key={i}>
              <Text weight="bold">{t(`lessonReport.quranKinds.${e.kind}`)}</Text>
              {`: ${formatQuranRange(e, lang)}`}
            </Text>
          ))}
        </View>
      ) : null}
      {report.kind === "music" && report.music_instrument ? (
        <View style={{ gap: space.xs }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Music2 size={16} color={colors.muted} />
            <Text size="sm" weight="bold" tone="muted">
              {t("lessonReport.musicTitle")}
            </Text>
          </View>
          <Text>
            {t(`lessonReport.instruments.${report.music_instrument}`)}
            {report.music_level ? ` · ${t(`lessonReport.levels.${report.music_level}`)}` : ""}
          </Text>
          {report.music_piece ? <Text tone="muted">{report.music_piece}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function MultilineField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  error,
  testID,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  maxLength: number;
  error?: string | null;
  testID?: string;
}) {
  const { i18n } = useTranslation();
  return (
    <View style={{ gap: space.sm }}>
      <Text weight="bold">{label}</Text>
      <TextInput
        {...bodyTextInputProps()}
        testID={testID}
        accessibilityLabel={label}
        multiline
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        onChangeText={onChange}
        style={[
          ui.input,
          {
            minHeight: 88,
            textAlignVertical: "top",
            fontFamily: (i18n.language === "ar" ? fonts.ar : fonts.en).regular,
          },
        ]}
      />
      {error ? (
        <Text size="sm" weight="bold" tone="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function LessonReportForm({
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
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "ar";
  const [draft, setDraft] = useState<LessonReportDraft>(() =>
    emptyDraft(kind, subjectCode, existing),
  );
  const [showErrors, setShowErrors] = useState(false);
  const catalog = useQuranCatalog(kind === "quran");
  const submit = useSubmitLessonReport(bookingId);
  const surahs = useMemo(() => catalog.data?.surahs ?? [], [catalog.data]);
  const juz = catalog.data?.juz ?? [];
  const errors = useMemo(
    () => (kind === "quran" && !surahs.length ? [] : validateDraft(kind, draft, surahs)),
    [kind, draft, surahs],
  );
  const err = (e: DraftError) =>
    showErrors && errors.includes(e) ? t(`lessonReport.fieldErrors.${e}`) : null;
  const set = (patch: Partial<LessonReportDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const updateEntry = (i: number, patch: Partial<LessonReportDraft["quran"][number]>) =>
    setDraft((d) => ({ ...d, quran: d.quran.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));

  const onSubmit = () => {
    setShowErrors(true);
    if (errors.length || (kind === "quran" && !surahs.length)) return;
    submit.mutate(
      { kind, draft },
      {
        onSuccess: () => {
          Alert.alert(existing ? t("lessonReport.write.saved") : t("lessonReport.write.sent"));
          onDone();
        },
        onError: (error) => Alert.alert(t(lessonReportErrorKey(error))),
      },
    );
  };

  const surahOptions = surahs.map((s) => ({
    value: String(s.number),
    label: `${s.number}. ${lang === "ar" ? s.name_ar : s.name_en}`,
  }));
  const quranError = err("quranRequired") ?? err("quranRange");

  return (
    <View style={{ gap: space.lg }} testID="lesson-report-form">
      <Text tone="muted">{t("lessonReport.write.lead")}</Text>
      <MultilineField
        label={t("lessonReport.covered")}
        value={draft.covered}
        onChange={(covered) => set({ covered })}
        placeholder={t("lessonReport.write.coveredPlaceholder")}
        maxLength={COVERED_MAX}
        error={err("covered")}
        testID="lesson-report-covered"
      />

      {kind === "quran" ? (
        <View style={{ gap: space.md }}>
          <Text weight="bold">{t("lessonReport.write.quranLead")}</Text>
          {catalog.isLoading ? <Text tone="muted">{t("common.loading")}</Text> : null}
          {catalog.isError ? (
            <View>
              <Text tone="danger">{t("lessonReport.loadError")}</Text>
              <Button
                variant="ghost"
                label={t("common.tryAgain")}
                onPress={() => void catalog.refetch()}
              />
            </View>
          ) : null}
          {surahs.length
            ? draft.quran.map((e, i) => (
                <View
                  key={i}
                  style={{
                    gap: space.md,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    padding: space.md,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
                    <View style={{ flex: 1 }}>
                      <Choices
                        label={t("lessonReport.write.rangeKind")}
                        value={e.kind}
                        onChange={(v) =>
                          updateEntry(i, { kind: v as LessonReportDraft["quran"][number]["kind"] })
                        }
                        options={QURAN_ENTRY_KINDS.map((k) => ({
                          value: k,
                          label: t(`lessonReport.quranKinds.${k}`),
                        }))}
                      />
                    </View>
                    {draft.quran.length > 1 ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("lessonReport.write.removeRange")}
                        onPress={() =>
                          setDraft((d) => ({ ...d, quran: d.quran.filter((_, j) => j !== i) }))
                        }
                        style={{
                          minHeight: 44,
                          minWidth: 44,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Trash2 size={18} color={colors.destructive} />
                      </Pressable>
                    ) : null}
                  </View>
                  {(["from", "to"] as const).map((side) => {
                    const surahKey = side === "from" ? "from_surah" : "to_surah";
                    const ayahKey = side === "from" ? "from_ayah" : "to_ayah";
                    return (
                      <View
                        key={side}
                        style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}
                      >
                        <BottomSheetSelect
                          label={`${t(`lessonReport.write.${side}`)} · ${t("lessonReport.write.surah")}`}
                          value={String(e[surahKey])}
                          options={surahOptions}
                          onChange={(v) => {
                            const s = surahs.find((x) => x.number === Number(v));
                            updateEntry(i, {
                              [surahKey]: Number(v),
                              [ayahKey]: side === "from" ? 1 : (s?.ayah_count ?? 1),
                            } as Partial<LessonReportDraft["quran"][number]>);
                          }}
                        />
                        <TextInput
                          {...bodyTextInputProps()}
                          accessibilityLabel={`${t(`lessonReport.write.${side}`)} · ${t("lessonReport.write.ayah")}`}
                          keyboardType="number-pad"
                          value={Number.isFinite(e[ayahKey]) ? String(e[ayahKey]) : ""}
                          onChangeText={(v) =>
                            updateEntry(i, {
                              [ayahKey]:
                                v.trim() === ""
                                  ? Number.NaN
                                  : Math.trunc(Number(v.replace(/[^0-9]/g, ""))),
                            } as Partial<LessonReportDraft["quran"][number]>)
                          }
                          style={[
                            ui.input,
                            { width: 76, textAlign: "center", writingDirection: "ltr" },
                          ]}
                        />
                      </View>
                    );
                  })}
                  <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-end" }}>
                    <Button
                      variant="secondary"
                      label={t("lessonReport.write.wholeSurah")}
                      onPress={() => {
                        const s = surahs.find((x) => x.number === e.from_surah);
                        if (s) updateEntry(i, surahRange(s));
                      }}
                      style={{ flex: 1 }}
                    />
                    <BottomSheetSelect
                      label={t("lessonReport.write.wholeJuz")}
                      value=""
                      options={juz.map((j) => ({
                        value: String(j.juz),
                        label: t("lessonReport.write.juzLabel", { n: j.juz }),
                      }))}
                      onChange={(v) => {
                        const r = juzRange(Number(v), juz, surahs);
                        if (r) updateEntry(i, r);
                      }}
                    />
                  </View>
                </View>
              ))
            : null}
          {quranError ? (
            <Text size="sm" weight="bold" tone="danger">
              {quranError}
            </Text>
          ) : null}
          {surahs.length && draft.quran.length < QURAN_ENTRIES_MAX ? (
            <Button
              variant="ghost"
              icon={<Plus size={16} color={colors.brandText} />}
              label={t("lessonReport.write.addRange")}
              onPress={() =>
                setDraft((d) => ({
                  ...d,
                  quran: [
                    ...d.quran,
                    {
                      kind: d.quran.length ? "review" : quranKindFromSubject(subjectCode),
                      ...surahRange(surahs[0]!),
                    },
                  ],
                }))
              }
            />
          ) : null}
        </View>
      ) : null}

      {kind === "music" ? (
        <View style={{ gap: space.md }}>
          <Choices
            label={t("lessonReport.instrument")}
            value={draft.musicInstrument ?? ""}
            onChange={(v) => set({ musicInstrument: v as LessonReportDraft["musicInstrument"] })}
            options={MUSIC_INSTRUMENTS.map((m) => ({
              value: m,
              label: t(`lessonReport.instruments.${m}`),
            }))}
          />
          {err("musicInstrument") ? (
            <Text size="sm" weight="bold" tone="danger">
              {err("musicInstrument")}
            </Text>
          ) : null}
          <Choices
            label={t("lessonReport.level")}
            value={draft.musicLevel ?? ""}
            onChange={(v) => set({ musicLevel: v as LessonReportDraft["musicLevel"] })}
            options={MUSIC_LEVELS.map((m) => ({ value: m, label: t(`lessonReport.levels.${m}`) }))}
          />
          {err("musicLevel") ? (
            <Text size="sm" weight="bold" tone="danger">
              {err("musicLevel")}
            </Text>
          ) : null}
          <MultilineField
            label={t("lessonReport.piece")}
            value={draft.musicPiece}
            onChange={(musicPiece) => set({ musicPiece })}
            placeholder={t("lessonReport.write.piecePlaceholder")}
            maxLength={PIECE_MAX}
            error={err("musicPiece")}
          />
        </View>
      ) : null}

      <MultilineField
        label={t("lessonReport.homework")}
        value={draft.homework}
        onChange={(homework) => set({ homework })}
        placeholder={t("lessonReport.write.homeworkPlaceholder")}
        maxLength={HOMEWORK_MAX}
        testID="lesson-report-homework"
      />

      <Choices
        label={t("lessonReport.understanding")}
        value={draft.understanding ?? ""}
        onChange={(v) => set({ understanding: v as LessonReportDraft["understanding"] })}
        options={UNDERSTANDING_VALUES.map((u) => ({
          value: u,
          label: t(`lessonReport.understandingValues.${u}`),
        }))}
      />
      {err("understanding") ? (
        <Text size="sm" weight="bold" tone="danger">
          {err("understanding")}
        </Text>
      ) : null}

      <Button
        testID="lesson-report-submit"
        label={existing ? t("lessonReport.write.save") : t("lessonReport.write.submit")}
        loading={submit.isPending}
        onPress={onSubmit}
      />
      <Text size="sm" tone="muted" style={{ textAlign: "center" }}>
        {t("lessonReport.write.editHint")}
      </Text>
    </View>
  );
}
