// «تقدم {name}» (migration 20261128140000): lesson reports over time, Quran memorization
// (surahs and juz) and music level for one learner. `id` is a child (family member) id,
// `me`, or a linked student's id (parent link, #419).
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import { BookOpen, ClipboardList, Music2 } from "lucide-react-native";
import { juzWithProgress, percent, surahStatus } from "@shared/lessonReports/lessonReports";
import { useLearnerProgress } from "@/lib/lessonReportQueries";
import { Page, QueryState } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { CustomerEmpty, customerStyle } from "@/ui/customer/Primitives";
import { LessonReportBody } from "@/ui/lessons/LessonReportCard";
import { colors, radius, space } from "@/ui/theme";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_COLORS = {
  memorized: { bg: colors.successTint, fg: colors.success },
  in_progress: { bg: colors.brandTint, fg: colors.brandText },
  reviewed: { bg: colors.surface2, fg: colors.muted },
} as const;

export default function LearnerProgressScreen() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "ar";
  const { id } = useLocalSearchParams<{ id?: string }>();
  const learnerId = !id || id === "me" ? null : UUID_RE.test(id) ? id : null;
  const q = useLearnerProgress(learnerId);
  const data = q.data;
  const firstName = (data?.learner.name ?? "").trim().split(/\s+/)[0] || null;
  const title =
    !data || data.learner.mode === "self" || !firstName
      ? t("learnerProgress.selfTitle")
      : t("learnerProgress.title", { name: firstName });
  const dateFmt = new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Africa/Cairo",
  });

  return (
    <Page
      title={title}
      queries={[q]}
      header={<CustomerPageHeader hero title={title} backTo="/students" />}
    >
      <QueryState query={q}>
        {data?.quran.has_data ? (
          <View style={customerStyle.card} testID="learner-progress-quran">
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <BookOpen size={20} color={colors.brand} />
              <Text weight="heavy" size="lg" accessibilityRole="header">
                {t("learnerProgress.quranTitle")}
              </Text>
            </View>
            <Text weight="bold">
              {t("learnerProgress.quranTotal", {
                memorized: data.quran.memorized_ayahs,
                total: data.quran.total_ayahs,
              })}
            </Text>
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{
                min: 0,
                max: 100,
                now: percent(data.quran.memorized_ayahs, data.quran.total_ayahs),
              }}
              style={{
                height: 12,
                borderRadius: radius.pill,
                backgroundColor: colors.surface2,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  height: "100%",
                  width: `${percent(data.quran.memorized_ayahs, data.quran.total_ayahs)}%`,
                  backgroundColor: colors.success,
                  borderRadius: radius.pill,
                }}
              />
            </View>
            {juzWithProgress(data.quran.juz).length ? (
              <View style={{ gap: space.sm }}>
                <Text size="sm" weight="bold" tone="muted">
                  {t("learnerProgress.juzTitle")}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                  {juzWithProgress(data.quran.juz).map((j) => {
                    const done = j.memorized_ayahs >= j.total_ayahs;
                    return (
                      <View
                        key={j.juz}
                        style={{
                          flexBasis: "47%",
                          flexGrow: 1,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: radius.md,
                          padding: space.sm,
                        }}
                      >
                        <Text weight="bold">{t("lessonReport.write.juzLabel", { n: j.juz })}</Text>
                        <Text
                          size="sm"
                          tone={done ? "success" : "muted"}
                          weight={done ? "bold" : "regular"}
                        >
                          {done
                            ? t("learnerProgress.juzComplete")
                            : t("learnerProgress.juzProgress", {
                                memorized: j.memorized_ayahs,
                                total: j.total_ayahs,
                              })}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : null}
            {data.quran.surahs.length ? (
              <View style={{ gap: space.sm }}>
                <Text size="sm" weight="bold" tone="muted">
                  {t("learnerProgress.surahsTitle")}
                </Text>
                {data.quran.surahs.map((s) => {
                  const status = surahStatus(s);
                  return (
                    <View
                      key={s.number}
                      style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text weight="bold">{`${s.number}. ${lang === "ar" ? s.name_ar : s.name_en}`}</Text>
                        <Text size="sm" tone="muted">
                          {status === "reviewed"
                            ? t("learnerProgress.surahReviewed", { count: s.reviewed_ayahs })
                            : t("learnerProgress.surahAyahs", {
                                memorized: s.memorized_ayahs,
                                total: s.ayah_count,
                              })}
                        </Text>
                      </View>
                      <View
                        style={{
                          backgroundColor: STATUS_COLORS[status].bg,
                          borderRadius: radius.pill,
                          paddingHorizontal: space.md,
                          paddingVertical: space.xs,
                        }}
                      >
                        <Text size="sm" weight="bold" style={{ color: STATUS_COLORS[status].fg }}>
                          {t(`learnerProgress.surahStatus.${status}`)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        ) : null}

        {data?.music.length ? (
          <View style={customerStyle.card}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Music2 size={20} color={colors.brand} />
              <Text weight="heavy" size="lg" accessibilityRole="header">
                {t("learnerProgress.musicTitle")}
              </Text>
            </View>
            {[...data.music].reverse().map((m) => (
              <View
                key={m.booking_id}
                style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}
              >
                <Text style={{ flex: 1 }}>
                  {`${t(`lessonReport.instruments.${m.instrument}`)} · ${t(`lessonReport.levels.${m.level}`)}`}
                  {m.piece ? ` · ${m.piece}` : ""}
                </Text>
                <Text size="sm" tone="muted">
                  {dateFmt.format(new Date(m.start_at))}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text weight="heavy" size="lg" accessibilityRole="header">
          {t("learnerProgress.reportsTitle")}
        </Text>
        {data && data.reports.length === 0 ? (
          <CustomerEmpty
            Icon={ClipboardList}
            title={t("learnerProgress.reportsTitle")}
            body={t("learnerProgress.empty")}
          />
        ) : null}
        {(data?.reports ?? []).map((r) => {
          const subject =
            (lang === "ar" ? r.subject_name_ar : r.subject_name_en) ?? r.subject_name_ar ?? "";
          return (
            <View key={r.id} style={customerStyle.card}>
              <Text weight="bold">
                {t("learnerProgress.lessonOn", {
                  date: dateFmt.format(new Date(r.start_at)),
                  subject: subject || t("lessonReport.title"),
                })}
              </Text>
              {r.tutor_name ? (
                <Text size="sm" tone="muted">
                  {t("learnerProgress.tutor", { name: r.tutor_name })}
                </Text>
              ) : null}
              <LessonReportBody report={r} />
            </View>
          );
        })}
      </QueryState>
    </Page>
  );
}
