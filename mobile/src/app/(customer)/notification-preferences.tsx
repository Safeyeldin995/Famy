import { Linking, Platform, Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/provider/profileQueries";
import { Page, QueryState, ActionError } from "@/ui/Page";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { customerStyle } from "@/ui/customer/Primitives";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { colors } from "@/ui/theme";
import { useState } from "react";

export default function CustomerNotificationPreferences() {
  const { t } = useTranslation();
  const prefs = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();
  const [failed, setFailed] = useState(false);
  const categories: [keyof NotificationPreferences, string][] = [
    ["booking_push", "bookingUpdates"],
    ["chat_push", "chatMessages"],
    ["reminder_push", "reminders"],
    ["support_push", "support"],
    ["campaign_push", "marketing"],
  ];
  return (
    <Page
      title={t("notifPrefs.title")}
      header={<CustomerPageHeader title={t("notifPrefs.title")} backTo="/profile" />}
      queries={[prefs]}
    >
      <Text size="sm" weight="bold" tone="muted">
        {t("notifPrefs.pushSection")}
      </Text>
      <View style={customerStyle.card}>
        {Platform.OS === "web" ? (
          <Text size="xs" tone="muted">
            {t("notifPrefs.pushUnsupported")}
          </Text>
        ) : (
          <Button
            variant="secondary"
            label={t("notifPrefs.title")}
            onPress={() => void Linking.openSettings().catch(() => setFailed(true))}
          />
        )}
      </View>
      <Text size="sm" weight="bold" tone="muted">
        {t("notifPrefs.categories")}
      </Text>
      <QueryState query={prefs}>
        <View style={[customerStyle.card, { padding: 0, gap: 0 }]}>
          {categories.map(([key, label], index) => (
            <View
              key={key}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 16,
                paddingVertical: 14,
                borderTopWidth: index ? 1 : 0,
                borderTopColor: colors.border,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text weight="bold">{t(`notifPrefs.${label}`)}</Text>
                <Text size="xs" tone="muted">
                  {t(`notifPrefs.${label}Sub`)}
                </Text>
              </View>
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel={t(`notifPrefs.${label}`)}
                accessibilityState={{
                  checked: !!prefs.data?.[key],
                  disabled: update.isPending || !prefs.data,
                }}
                disabled={update.isPending || !prefs.data}
                onPress={() => update.mutate({ [key]: !prefs.data?.[key] })}
                style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Text size="xs" weight="bold" tone={prefs.data?.[key] ? "brand" : "muted"}>
                  {t(
                    prefs.data?.[key]
                      ? "providerNotificationPolish.on"
                      : "providerNotificationPolish.off",
                  )}
                </Text>
                <View
                  style={{
                    width: 48,
                    height: 28,
                    borderRadius: 14,
                    padding: 2,
                    backgroundColor: prefs.data?.[key] ? colors.brand : colors.surface2,
                  }}
                >
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      backgroundColor: colors.surface,
                      alignSelf: prefs.data?.[key] ? "flex-end" : "flex-start",
                    }}
                  />
                </View>
              </Pressable>
            </View>
          ))}
        </View>
      </QueryState>
      <Text size="xs" tone="muted">
        {t("providerNotificationPolish.footer")}
      </Text>
      <ActionError error={update.error || failed} />
    </Page>
  );
}
