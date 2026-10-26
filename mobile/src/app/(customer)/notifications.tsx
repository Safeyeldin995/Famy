import { View, Pressable } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from "@/lib/queries";
import { notificationText, dateTime } from "@/lib/presentation";
import { Page, QueryState, ActionError, ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { colors } from "@/ui/theme";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";

export default function Notifications() {
  const { t, i18n } = useTranslation();
  const q = useNotifications();
  const mark = useMarkNotificationRead();
  const all = useMarkAllNotificationsRead();
  return (
    <Page
      title={t("notifs.title")}
      queries={[q]}
      header={
        <CustomerPageHeader
          title={t("notifs.title")}
          backTo="/home"
          right={
            q.data?.some((n) => !n.read_at) ? (
              <Button
                variant="secondary"
                label={t("notifs.markAllRead")}
                loading={all.isPending}
                onPress={() => all.mutate()}
                style={{ minHeight: 44, borderRadius: 999, paddingHorizontal: 14 }}
              />
            ) : null
          }
        />
      }
    >
      <ActionError error={mark.error || all.error} />
      <QueryState query={q} empty={!q.data?.length} emptyKey="customerRound2.notificationsEmpty">
        {q.data?.map((n) => {
          const text = notificationText(n, i18n.language);
          return (
            <Pressable
              key={n.id}
              accessibilityRole="button"
              accessibilityLabel={`${text.title}. ${t(n.read_at ? "mobile.read" : "mobile.unread")}`}
              disabled={mark.isPending}
              style={[ui.card, !n.read_at && { borderColor: colors.brand }]}
              onPress={async () => {
                try {
                  if (!n.read_at) await mark.mutateAsync(n.id);
                } catch {
                  return;
                }
                // Only routes implemented in Phase 1 may be opened by server deep links.
                const match = String(n.deep_link ?? "").match(
                  /^\/(booking|provider)\/([a-zA-Z0-9-]+)$/,
                );
                if (match)
                  router.push({
                    pathname: match[1] === "booking" ? "/booking/[id]" : "/provider/[id]",
                    params: { id: match[2] },
                  });
              }}
            >
              <View style={ui.wrap}>
                {!n.read_at && (
                  <View
                    style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand }}
                  />
                )}
                <Text weight="heavy">{text.title}</Text>
              </View>
              <Text>{text.body}</Text>
              <Text tone="muted" size="sm">
                {dateTime(n.created_at, i18n.language)}
              </Text>
            </Pressable>
          );
        })}
      </QueryState>
    </Page>
  );
}
