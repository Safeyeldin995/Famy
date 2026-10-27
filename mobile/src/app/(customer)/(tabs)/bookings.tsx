import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { CalendarDays, Clock, ChevronRight, ChevronLeft } from "lucide-react-native";
import { Text } from "@/ui/Text";
import { colors, space } from "@/ui/theme";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMyBookings, useBookingParties } from "@/lib/queries";
import { activeStatuses, localized, money } from "@/lib/presentation";
import { Page, QueryState, ui } from "@/ui/Page";
import { Segmented } from "@/ui/Segmented";
import { bookingStatusStyle } from "@/ui/customer/bookingStatusStyle";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { CustomerEmpty, customerStyle } from "@/ui/customer/Primitives";
import { Avatar } from "@/ui/ProviderCard";
import { Button } from "@/ui/Button";
import { isProviderNoResponseCancellation } from "@shared/booking/pending-expiry";

export default function Bookings() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState("upcoming");
  const q = useMyBookings();
  const parties = useBookingParties((q.data ?? []).map((b) => b.id));
  const rows = (q.data ?? []).filter((b) =>
    tab === "upcoming"
      ? activeStatuses.includes(b.status)
      : tab === "completed"
        ? b.status === "completed"
        : ["cancelled", "no_show"].includes(b.status),
  );
  const locale = i18n.language === "ar" ? "ar-EG-u-nu-latn" : "en-EG";
  const Arrow = i18n.language === "ar" ? ChevronLeft : ChevronRight;
  return (
    <Page
      tab
      title={t("bookings.title")}
      queries={[q, parties]}
      contentStyle={{ paddingTop: 16 }}
      header={
        <CustomerPageHeader
          title={t("bookings.title")}
          subtitle={t(
            tab === "upcoming"
              ? "bookings.subtitleUpcoming"
              : tab === "completed"
                ? "bookings.subtitleHistory"
                : "bookings.subtitleCancelled",
          )}
        />
      }
    >
      <View style={[customerStyle.card, { borderRadius: 28 }]}>
        <View style={[ui.priceRow, { paddingVertical: 0 }]}>
          <Text weight="heavy">{t(`bookings.${tab}`)}</Text>
          {!q.isLoading && !q.isError ? (
            <View style={[ui.badge, { backgroundColor: colors.surface2 }]}>
              <Text size="xs" weight="bold" tone="muted">
                {String(rows.length)}
              </Text>
            </View>
          ) : null}
        </View>
        <Segmented
          brandSelection
          value={tab}
          onChange={setTab}
          options={[
            { value: "upcoming", label: t("bookings.upcoming") },
            { value: "completed", label: t("bookings.completed") },
            { value: "cancelled", label: t("bookings.cancelled") },
          ]}
        />
      </View>
      <QueryState query={q}>
        <QueryState query={parties} />
        {!rows.length ? (
          <CustomerEmpty
            Icon={CalendarDays}
            title={t("customerRound2.emptyBookings")}
            body={t("customerRound2.emptyBookingsBody")}
          >
            <Button label={t("bookings.browse")} onPress={() => router.push("/home")} />
          </CustomerEmpty>
        ) : null}
        {rows.map((b) => {
          const party = parties.data?.get(b.id);
          const start = new Date(b.start_at);
          const expired = isProviderNoResponseCancellation(b);
          const past = tab !== "upcoming";
          const statusStyle = bookingStatusStyle(b.status);
          const hours = Math.max(1, Math.round((+new Date(b.end_at) - +start) / 36e5));
          return (
            <View
              key={b.id}
              style={[
                customerStyle.card,
                {
                  borderRadius: 28,
                  padding: 0,
                  overflow: "hidden",
                  backgroundColor: past ? colors.surface2 : colors.surface,
                },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${parties.data?.get(b.id)?.other_name || b.provider?.profile.full_name || t("provider2.unnamed")}, ${t(`status.${b.status}`)}`}
                onPress={() => router.push({ pathname: "/booking/[id]", params: { id: b.id } })}
                style={({ pressed }) => [{ padding: 16, gap: 12 }, pressed && ui.pressed]}
              >
                <View style={[customerStyle.row, { alignItems: "flex-start" }]}>
                  <Avatar
                    name={
                      party?.other_name || b.provider?.profile.full_name || t("provider2.unnamed")
                    }
                    raw={party?.other_avatar_url || b.provider?.profile.avatar_url}
                    size={56}
                    round
                  />
                  <View style={{ flex: 1, gap: 8 }}>
                    <View style={[customerStyle.row, { alignItems: "flex-start", gap: 8 }]}>
                      <View style={{ flex: 1 }}>
                        <Text weight="bold">
                          {party?.other_name ||
                            b.provider?.profile.full_name ||
                            t("provider2.unnamed")}
                        </Text>
                        <Text size="xs" tone="muted">
                          {localized(b.service, i18n.language)}
                        </Text>
                      </View>
                      <View
                        style={{
                          borderRadius: 999,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          backgroundColor: statusStyle.backgroundColor,
                        }}
                      >
                        <Text size="xs" weight="heavy" style={{ color: statusStyle.color }}>
                          {t(`status.${b.status}`)}
                        </Text>
                      </View>
                    </View>
                    <View style={[customerStyle.row, { flexWrap: "wrap", gap: 8 }]}>
                      <View style={[customerStyle.row, { gap: 4 }]}>
                        <CalendarDays size={12} color={colors.muted} />
                        <Text size="xs" tone="muted">
                          {start.toLocaleDateString(locale, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}
                        </Text>
                      </View>
                      <View style={[customerStyle.row, { gap: 4 }]}>
                        <Clock size={12} color={colors.muted} />
                        <Text size="xs" tone="muted">
                          {start.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}{" "}
                          · {t("bookings.hoursShort", { hours: String(hours) })}
                        </Text>
                      </View>
                    </View>
                    {expired ? (
                      <Text size="xs" tone="muted">
                        {t("bookings.expiredReason")}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View
                  style={[
                    ui.priceRow,
                    { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
                  ]}
                >
                  <Text weight="heavy" tone={past ? "default" : "brand"}>
                    {money(b.price_total, i18n.language)}
                  </Text>
                  <Text size="xs" tone="muted" style={ui.ltr}>
                    #{b.id.slice(0, 8).toUpperCase()}
                  </Text>
                  {!past ? <Arrow size={16} color={colors.muted} /> : null}
                </View>
              </Pressable>
              {past ? (
                <View
                  style={{
                    padding: 16,
                    paddingTop: 12,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                  }}
                >
                  <Button
                    variant="secondary"
                    label={t(expired ? "bookings.bookAnotherProvider" : "bookings.bookAgain")}
                    onPress={() =>
                      expired
                        ? router.push("/home")
                        : router.push({
                            pathname: "/book/[providerId]",
                            params: {
                              providerId: b.provider_id,
                              serviceId: b.service_id,
                              ...(b.teaching_capability_id
                                ? { capabilityId: b.teaching_capability_id }
                                : {}),
                            },
                          })
                    }
                  />
                </View>
              ) : null}
            </View>
          );
        })}
      </QueryState>
    </Page>
  );
}
