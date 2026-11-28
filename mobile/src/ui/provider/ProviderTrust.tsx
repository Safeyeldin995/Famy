import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  BadgeCheck,
  CalendarCheck2,
  House,
  MonitorPlay,
  ShieldCheck,
  Star,
} from "lucide-react-native";
import { useProviderTrustStats, usePublicProviderReviews } from "@/lib/trustQueries";
import { customerNumber } from "@/lib/customerFormat";
import {
  reviewLessonParts,
  trustBadgeText,
  trustBadges,
  type TrustBadge,
} from "@shared/provider/trustBadges";
import { QueryState } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";

function BadgeIcon({ badgeKey }: { badgeKey: TrustBadge["key"] }) {
  const Icon =
    badgeKey === "verified"
      ? BadgeCheck
      : badgeKey === "neverCancels"
        ? ShieldCheck
        : CalendarCheck2;
  return <Icon size={16} color={colors.success} accessible={false} />;
}

/** Trust facts under the profile header. Renders nothing when there is no real fact to show. */
export function ProviderTrustBadges({
  providerId,
  tutoring,
  verifiedFallback,
}: {
  providerId: string;
  tutoring: boolean;
  verifiedFallback?: boolean;
}) {
  const { t } = useTranslation();
  const statsQ = useProviderTrustStats(providerId);
  const stats = statsQ.data ?? null;
  const badges = trustBadges(stats, { tutoring, verifiedFallback });
  const modes = stats
    ? ([
        stats.offers_online ? { key: "online", Icon: MonitorPlay } : null,
        stats.offers_in_person ? { key: "inPerson", Icon: House } : null,
      ].filter(Boolean) as { key: "online" | "inPerson"; Icon: typeof MonitorPlay }[])
    : [];
  if (!badges.length && !modes.length) return null;
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={t("providerTrust.label")}
      style={{ gap: space.sm }}
    >
      {badges.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {badges.map((badge) => (
            <View
              key={badge.key}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.xs,
                paddingVertical: space.sm,
                paddingHorizontal: space.md,
                borderRadius: radius.pill,
                backgroundColor: colors.successTint,
                maxWidth: "100%",
              }}
            >
              <BadgeIcon badgeKey={badge.key} />
              <Text size="sm" weight="bold" style={{ flexShrink: 1 }}>
                {trustBadgeText(t, badge)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {modes.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {modes.map(({ key, Icon }) => (
            <View
              key={key}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.xs,
                paddingVertical: space.xs,
                paddingHorizontal: space.md,
                borderRadius: radius.pill,
                backgroundColor: colors.brandTint,
              }}
            >
              <Icon size={14} color={colors.brandText} accessible={false} />
              <Text size="xs" weight="bold" style={{ color: colors.brandText }}>
                {t(key === "online" ? "providerTrust.online" : "providerTrust.inPerson")}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Reviews with the lesson they were for («فرنساوي · 3 ابتدائي · IB»), newest first, five at a
 * time with «كل التقييمات». Reviewer identity is never shown.
 */
export function PublicProviderReviews({
  providerId,
  onReport,
}: {
  providerId: string;
  /** Signed-in customers can report a review. */
  onReport?: (reviewId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "ar" ? "ar" : "en";
  const q = usePublicProviderReviews(providerId);
  const rows = (q.data?.pages ?? []).flat();
  const total = rows[0]?.total_count ?? 0;
  return (
    <QueryState query={q}>
      {!rows.length ? (
        <Text tone="muted">{t("providerPage.noReviews")}</Text>
      ) : (
        <View style={{ gap: space.sm }}>
          {rows.map((r) => {
            const lesson = reviewLessonParts(r, lang);
            return (
              <View
                key={r.id}
                style={{
                  gap: space.xs,
                  padding: space.md,
                  borderRadius: radius.lg,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <View
                    style={{ flexDirection: "row", gap: 2 }}
                    accessible
                    accessibilityLabel={t("providerTrust.ratingOutOf", {
                      rating: customerNumber(Number(r.rating), i18n.language),
                    })}
                  >
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        size={14}
                        color={i < Number(r.rating) ? colors.warning : colors.border}
                        fill={i < Number(r.rating) ? colors.warning : "transparent"}
                      />
                    ))}
                  </View>
                  <View style={{ flex: 1 }} />
                  <Text size="xs" tone="muted">
                    {new Date(r.created_at).toLocaleDateString(
                      lang === "ar" ? "ar-EG-u-nu-latn" : "en-EG",
                      { day: "numeric", month: "long", year: "numeric" },
                    )}
                  </Text>
                </View>
                {lesson.length ? (
                  <Text size="xs" tone="muted" weight="bold">
                    {lesson.join(" · ")}
                  </Text>
                ) : null}
                {r.comment ? <Text>{r.comment}</Text> : null}
                {onReport ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("ugc.reportReview")}
                    onPress={() => onReport(r.id)}
                    style={{ alignSelf: "flex-start", paddingVertical: space.xs }}
                  >
                    <Text size="sm" tone="muted" weight="bold">
                      {t("ugc.reportReview")}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
          {q.hasNextPage ? (
            <Button
              variant="secondary"
              label={`${t(rows.length <= 5 ? "providerTrust.allReviews" : "providerTrust.moreReviews")} (${customerNumber(total, i18n.language)})`}
              loading={q.isFetchingNextPage}
              onPress={() => void q.fetchNextPage()}
            />
          ) : null}
        </View>
      )}
    </QueryState>
  );
}
