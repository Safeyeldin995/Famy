import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { BOOKING_ACTIVE_STATUSES } from "@/lib/provider/constants";
import { useMyProvider, useProviderBookings } from "@/lib/provider/queries";
import { localized, money, dateTime } from "@/lib/presentation";
import { BookingRequestActions } from "@/ui/provider/BookingRequestActions";
import { proCard } from "@/ui/provider/cards";
import { Page, QueryState } from "@/ui/Page";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { space } from "@/ui/theme";

type Tab = "requests" | "upcoming" | "history";

export default function ProviderJobs() {
  const { t, i18n } = useTranslation();
  const p = useMyProvider();
  const provider = p.data as { id?: string } | null | undefined;
  const q = useProviderBookings(provider?.id);
  const [tab, setTab] = useState<Tab>("requests");

  const lists = useMemo(() => {
    const all = (q.data ?? []) as Record<string, unknown>[];
    return {
      requests: all.filter((b) => b.status === "pending"),
      upcoming: all
        .filter((b) => BOOKING_ACTIVE_STATUSES.includes(b.status as never))
        .sort((a, b) => +new Date(String(a.start_at)) - +new Date(String(b.start_at))),
      history: all.filter((b) =>
        ["completed", "cancelled", "no_show", "disputed"].includes(String(b.status)),
      ),
    };
  }, [q.data]);

  const list = lists[tab];
  const emptyKey =
    tab === "requests"
      ? "pro.bookings.emptyRequests"
      : tab === "upcoming"
        ? "pro.bookings.emptyUpcoming"
        : "pro.bookings.emptyHistory";

  return (
    <Page tab title={t("pro.bookings.title")} queries={[p, q]}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "requests", label: `${t("pro.bookings.requests")} (${lists.requests.length})` },
          { value: "upcoming", label: t("pro.bookings.upcoming") },
          { value: "history", label: t("pro.bookings.history") },
        ]}
      />
      <QueryState query={q} empty={!list.length} emptyKey={emptyKey}>
        {list.map((b) => {
          const customer = b.customer as { full_name?: string } | undefined;
          const service = b.service as { name_ar?: string; name_en?: string } | undefined;
          return (
            <Pressable
              key={String(b.id)}
              accessibilityRole="button"
              onPress={() =>
                router.push({ pathname: "/pro-booking/[id]", params: { id: String(b.id) } })
              }
              style={proCard.card}
            >
              <View
                style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}
              >
                <Text weight="heavy" style={{ flex: 1 }}>
                  {customer?.full_name || t("pro.common.customer")}
                </Text>
                <Text weight="heavy" tone="brand">
                  {money(Number(b.price_total ?? 0), i18n.language)}
                </Text>
              </View>
              <Text>{localized(service, i18n.language)}</Text>
              <Text tone="muted" size="sm">
                {dateTime(String(b.start_at), i18n.language)}
              </Text>
              <Text tone="muted" size="sm">
                {t(`pro.statuses.${String(b.status)}`, String(b.status))}
              </Text>
              {tab === "requests" ? <BookingRequestActions id={String(b.id)} /> : null}
            </Pressable>
          );
        })}
      </QueryState>
    </Page>
  );
}
