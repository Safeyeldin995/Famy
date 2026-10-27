import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react-native";
import { useMarkAllNotificationsRead, useMarkNotificationRead } from "@/lib/queries";
import { useProNotifications } from "@/lib/provider/queries";
import { notificationText } from "@/lib/presentation";
import { ProviderHeader } from "@/ui/provider/ProviderHeader";
import { Page, QueryState, ActionError } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";

type Notification = {
  id: string;
  created_at: string;
  read_at?: string | null;
  deep_link?: string | null;
  title_ar?: string | null;
  title_en?: string | null;
  body_ar?: string | null;
  body_en?: string | null;
};
const calendar = new Intl.DateTimeFormat("en-CA-u-nu-latn", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dayKey = (date: Date) => {
  const parts = calendar.formatToParts(date);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)?.value)
    .join("-");
};

export default function ProNotifications() {
  const { t, i18n } = useTranslation();
  const q = useProNotifications();
  const mark = useMarkNotificationRead();
  const all = useMarkAllNotificationsRead();
  const items = (q.data ?? []) as Notification[];
  const groups = new Map<string, Notification[]>();
  for (const item of [...items].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))) {
    const key = dayKey(new Date(item.created_at));
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const today = dayKey(new Date());
  const yesterdayDate = new Date(`${today}T12:00:00Z`);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);
  const label = (key: string) =>
    key === today
      ? t("proRound2.today")
      : key === yesterday
        ? t("proRound2.yesterday")
        : new Intl.DateTimeFormat(i18n.language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB", {
            timeZone: "Africa/Cairo",
            weekday: "long",
            day: "numeric",
            month: "long",
          }).format(new Date(`${key}T12:00:00Z`));
  const header = (
    <ProviderHeader
      title={t("notifs.title")}
      action={
        items.some((item) => !item.read_at) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("notifs.markAllRead")}
            disabled={all.isPending}
            onPress={() => all.mutate()}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text tone="brand" weight="heavy" size="xs">
              {t("notifs.markAllRead")}
            </Text>
          </Pressable>
        ) : undefined
      }
    />
  );
  return (
    <Page title={t("notifs.title")} header={header} queries={[q]} contentStyle={{ paddingTop: 8 }}>
      <ActionError error={mark.error || all.error} />
      <QueryState query={q} empty={!items.length} emptyKey="notifs.empty">
        {[...groups.entries()].map(([key, group]) => (
          <View key={key} style={{ gap: space.sm, marginBottom: space.lg }}>
            <Text weight="heavy">{label(key)}</Text>
            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: radius.xl,
                overflow: "hidden",
              }}
            >
              {group.map((item) => {
                const content = notificationText(item, i18n.language);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${content.title}. ${t(item.read_at ? "mobile.read" : "mobile.unread")}`}
                    disabled={mark.isPending}
                    onPress={async () => {
                      try {
                        if (!item.read_at) await mark.mutateAsync(item.id);
                      } catch {
                        return;
                      }
                      const booking = String(item.deep_link ?? "").match(
                        /^\/pro\/booking\/([a-zA-Z0-9-]+)$/,
                      );
                      if (booking)
                        router.push({ pathname: "/pro-booking/[id]", params: { id: booking[1] } });
                    }}
                    style={{
                      minHeight: 72,
                      flexDirection: "row",
                      gap: 12,
                      padding: 16,
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border,
                      opacity: item.read_at ? 0.7 : 1,
                    }}
                  >
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 12,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: colors.brandTint,
                      }}
                    >
                      <Bell size={20} color={colors.brand} />
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text weight="bold" style={{ flexShrink: 1 }}>
                          {content.title}
                        </Text>
                        {!item.read_at ? (
                          <View
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 4,
                              backgroundColor: colors.brand,
                            }}
                          />
                        ) : null}
                      </View>
                      <Text tone="muted" size="sm" numberOfLines={2}>
                        {content.body}
                      </Text>
                      <Text tone="muted" size="xs">
                        {new Intl.DateTimeFormat(
                          i18n.language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB",
                          { timeZone: "Africa/Cairo", hour: "numeric", minute: "2-digit" },
                        ).format(new Date(item.created_at))}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </QueryState>
    </Page>
  );
}
