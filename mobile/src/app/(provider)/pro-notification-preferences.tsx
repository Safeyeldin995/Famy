import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/provider/profileQueries";
import { Page, QueryState } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { colors, space } from "@/ui/theme";
import { proCard } from "@/ui/provider/cards";

type ToggleKey = Extract<keyof NotificationPreferences, `${string}_push` | "campaign_in_app">;

function ToggleRow({
  label,
  sub,
  on,
  onToggle,
  disabled,
}: {
  label: string;
  sub?: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={{
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.md,
        paddingVertical: space.sm,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="bold">{label}</Text>
        {sub ? (
          <Text tone="muted" size="sm">
            {sub}
          </Text>
        ) : null}
      </View>
      <Text tone={on ? "brand" : "muted"} size="sm" weight="bold">
        {t(on ? "providerNotificationPolish.on" : "providerNotificationPolish.off")}
      </Text>
      <View
        style={{
          width: 48,
          height: 28,
          borderRadius: 14,
          backgroundColor: on ? colors.brand : colors.border,
          justifyContent: "center",
          paddingHorizontal: 2,
        }}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: colors.surface,
            alignSelf: on ? "flex-end" : "flex-start",
          }}
        />
      </View>
    </Pressable>
  );
}

export default function ProNotificationPreferencesScreen() {
  const { t } = useTranslation();
  const prefsQ = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();
  const prefs = prefsQ.data;

  const toggle = (key: ToggleKey) => {
    if (!prefs) return;
    update.mutate({ [key]: !prefs[key] } as Partial<NotificationPreferences>);
  };

  const categories: { key: ToggleKey; label: string; sub: string }[] = [
    {
      key: "booking_push",
      label: t("notifPrefs.bookingUpdates"),
      sub: t("notifPrefs.bookingUpdatesSub"),
    },
    { key: "chat_push", label: t("notifPrefs.chatMessages"), sub: t("notifPrefs.chatMessagesSub") },
    { key: "reminder_push", label: t("notifPrefs.reminders"), sub: t("notifPrefs.remindersSub") },
    { key: "support_push", label: t("notifPrefs.support"), sub: t("notifPrefs.supportSub") },
    { key: "campaign_push", label: t("notifPrefs.marketing"), sub: t("notifPrefs.marketingSub") },
  ];

  return (
    <Page title={t("mobilePro.notificationPrefs")} queries={[prefsQ]}>
      <QueryState query={prefsQ}>
        <View style={proCard.card}>
          {categories.map((row) => (
            <ToggleRow
              key={row.key}
              label={row.label}
              sub={row.sub}
              on={!!prefs?.[row.key]}
              disabled={update.isPending}
              onToggle={() => toggle(row.key)}
            />
          ))}
          <ToggleRow
            label={t("mobilePro.campaignInApp")}
            on={!!prefs?.campaign_in_app}
            disabled={update.isPending}
            onToggle={() => toggle("campaign_in_app")}
          />
        </View>
      </QueryState>
    </Page>
  );
}
