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
import { Smartphone, Trash2 } from "lucide-react-native";
import { useCustomerPushDevices, useRevokeCustomerPushDevice } from "@/lib/customerPushDevices";
import { enableCustomerPushNotifications } from "@/lib/push";

export default function CustomerNotificationPreferences() {
  const { t } = useTranslation();
  const prefs = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();
  const devices = useCustomerPushDevices();
  const revoke = useRevokeCustomerPushDevice();
  const [failed, setFailed] = useState(false);
  const [enabling, setEnabling] = useState(false);
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
      queries={[prefs, devices]}
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
          <View style={{ gap: 8 }}>
            <Button
              variant="secondary"
              label={t(enabling ? "notifPrefs.enabling" : "notifPrefs.enable")}
              loading={enabling}
              onPress={async () => {
                setEnabling(true);
                setFailed(false);
                try {
                  await enableCustomerPushNotifications();
                  await devices.refetch();
                } catch {
                  setFailed(true);
                } finally {
                  setEnabling(false);
                }
              }}
            />
            <Button
              variant="ghost"
              label={t("notifPrefs.title")}
              onPress={() => void Linking.openSettings().catch(() => setFailed(true))}
            />
          </View>
        )}
      </View>
      <QueryState query={devices}>
        {(devices.data?.length ?? 0) > 0 ? (
          <View style={{ gap: 8 }}>
            <Text size="sm" weight="bold" tone="muted">
              {t("notifPrefs.devices")}
            </Text>
            <View style={[customerStyle.card, { padding: 0, gap: 0 }]}>
              {devices.data?.map((device, index) => (
                <View
                  key={`${device.kind}:${device.id}`}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderTopWidth: index ? 1 : 0,
                    borderTopColor: colors.border,
                  }}
                >
                  <Smartphone size={16} color={colors.muted} />
                  <Text numberOfLines={1} style={{ flex: 1 }}>
                    {device.device_label || t("notifPrefs.unknownDevice")}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("notifPrefs.removeDevice")}
                    disabled={revoke.isPending}
                    onPress={() => revoke.mutate(device)}
                    style={{
                      width: 44,
                      height: 44,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: revoke.isPending ? 0.5 : 1,
                    }}
                  >
                    <Trash2 size={16} color={colors.muted} />
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </QueryState>
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
      <ActionError error={update.error || revoke.error || failed} />
    </Page>
  );
}
