import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useMarkAllNotificationsRead, useMarkNotificationRead } from "@/lib/queries";
import { useProNotifications } from "@/lib/provider/queries";
import { notificationText, dateTime } from "@/lib/presentation";
import { proCard } from "@/ui/provider/cards";
import { Page, QueryState, ActionError, ui } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors } from "@/ui/theme";

export default function ProNotifications() {
  const { t, i18n } = useTranslation();
  const q = useProNotifications();
  const mark = useMarkNotificationRead();
  const all = useMarkAllNotificationsRead();

  return (
    <Page title={t("notifs.title")} queries={[q]}>
      {q.data?.some((n) => !n.read_at) ? (
        <Button
          variant="secondary"
          label={t("notifs.markAllRead")}
          loading={all.isPending}
          onPress={() => all.mutate()}
        />
      ) : null}
      <ActionError error={mark.error || all.error} />
      <QueryState query={q} empty={!q.data?.length} emptyKey="notifs.empty">
        {q.data?.map((n) => {
          const text = notificationText(n, i18n.language);
          return (
            <Pressable
              key={n.id}
              accessibilityRole="button"
              disabled={mark.isPending}
              style={[proCard.card, !n.read_at && { borderColor: colors.brand }]}
              onPress={async () => {
                try {
                  if (!n.read_at) await mark.mutateAsync(n.id);
                } catch {
                  return;
                }
                const link = String(n.deep_link ?? "");
                const booking = link.match(/^\/pro\/booking\/([a-zA-Z0-9-]+)$/);
                if (booking) {
                  router.push({ pathname: "/pro-booking/[id]", params: { id: booking[1] } });
                }
              }}
            >
              <View style={ui.wrap}>
                {!n.read_at ? (
                  <View
                    style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand }}
                  />
                ) : null}
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
