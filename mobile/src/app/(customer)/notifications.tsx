import { View, Pressable } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from "@/lib/queries";
import { notificationText } from "@/lib/presentation";
import {
  customerNotificationGroups,
  customerNotificationDate,
} from "@/lib/customerNotificationGroups";
import { Bell, Sparkles } from "lucide-react-native";
import { CustomerEmpty, customerStyle } from "@/ui/customer/Primitives";
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
      <QueryState query={q}>
        {!q.data?.length ? (
          <CustomerEmpty
            Icon={Bell}
            title={t("customerRound2.notificationsEmpty")}
            body={t("customerRound2.notificationsEmptyBody")}
          >
            <Button label={t("customerRound2.browse")} onPress={() => router.push("/home")} />
          </CustomerEmpty>
        ) : null}
        {customerNotificationGroups(q.data ?? []).map((group) => (
          <View key={group.key} style={{ gap: 12, marginBottom: 12 }}>
            <Text size="lg" weight="bold">
              {group.labelKey
                ? t(group.labelKey)
                : customerNotificationDate(group.date, i18n.language)}
            </Text>
            {group.items.map((n) => {
              const text = notificationText(n, i18n.language);
              const offer = n.category === "campaign";
              const Icon = offer ? Sparkles : Bell;
              return (
                <Pressable
                  key={n.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${text.title}. ${t(n.read_at ? "mobile.read" : "mobile.unread")}`}
                  disabled={mark.isPending}
                  style={[
                    customerStyle.card,
                    customerStyle.row,
                    {
                      alignItems: "flex-start",
                      borderRadius: 24,
                      gap: 14,
                      backgroundColor: n.read_at ? colors.surface2 : colors.surface,
                      borderColor: n.read_at ? "transparent" : "#F10E7233",
                    },
                  ]}
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
                  <View
                    style={[
                      customerStyle.icon,
                      {
                        width: 44,
                        height: 44,
                        backgroundColor: offer ? colors.brand : colors.brandTint,
                      },
                    ]}
                  >
                    <Icon size={20} color={offer ? "white" : colors.brand} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={ui.wrap}>
                      <Text size="lg" weight="heavy" style={{ flexShrink: 1 }}>
                        {text.title}
                      </Text>
                      {!n.read_at && (
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: colors.brand,
                          }}
                        />
                      )}
                    </View>
                    {text.body ? <Text tone="muted">{text.body}</Text> : null}
                    <Text tone="muted" size="xs">
                      {customerNotificationDate(new Date(n.created_at), i18n.language, true)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </QueryState>
    </Page>
  );
}
