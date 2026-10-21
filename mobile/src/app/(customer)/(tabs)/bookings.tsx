import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { CalendarDays } from "lucide-react-native";
import { Text } from "@/ui/Text";
import { colors, space } from "@/ui/theme";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMyBookings, useBookingParties } from "@/lib/queries";
import { activeStatuses, dateTime, localized, money } from "@/lib/presentation";
import { Page, QueryState, ui } from "@/ui/Page";
import { Segmented } from "@/ui/Segmented";

export default function Bookings() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState("upcoming");
  const q = useMyBookings();
  const parties = useBookingParties((q.data ?? []).map((b) => b.id));
  const rows = (q.data ?? []).filter((b) =>
    tab === "upcoming"
      ? activeStatuses.includes(b.status)
      : ["completed", "cancelled", "no_show"].includes(b.status),
  );
  return (
    <Page tab title={t("bookings.title")} queries={[q, parties]}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "upcoming", label: t("bookings.upcoming") },
          { value: "past", label: t("mobile.past") },
        ]}
      />
      <QueryState query={q} empty={!rows.length} emptyKey="mobile.noBookings">
        <QueryState query={parties} />
        {rows.map((b) => (
          <Pressable
            key={b.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/booking/[id]", params: { id: b.id } })}
            style={({ pressed }) => [ui.card, pressed && ui.pressed]}
          >
            <View style={ui.priceRow}>
              <View style={ui.badge}>
                <Text size="xs" tone="brand" weight="bold">
                  {t(`status.${b.status}`)}
                </Text>
              </View>
              <Text weight="heavy" tone="brand" style={ui.ltr}>
                {money(b.price_total, i18n.language)}
              </Text>
            </View>
            <Text size="lg" weight="heavy">
              {parties.data?.get(b.id)?.other_name ||
                b.provider?.profile.full_name ||
                t("provider2.unnamed")}
            </Text>
            <Text tone="muted">{localized(b.service, i18n.language)}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <CalendarDays size={18} color={colors.brand} accessible={false} />
              <Text size="sm" style={{ flex: 1 }}>
                {dateTime(b.start_at, i18n.language)}
              </Text>
            </View>
          </Pressable>
        ))}
      </QueryState>
    </Page>
  );
}
