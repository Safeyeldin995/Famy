import { useMemo, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { BOOKING_ACTIVE_STATUSES } from "@/lib/provider/constants";
import { useMyProvider, useProviderBookings } from "@/lib/provider/queries";
import { ProviderBookingCard, type ProviderCardBooking } from "@/ui/provider/ProviderBookingCard";
import { Page, QueryState } from "@/ui/Page";
import { Segmented } from "@/ui/Segmented";

type Tab = "requests" | "upcoming" | "history";

export default function ProviderJobs() {
  const { t } = useTranslation();
  const p = useMyProvider();
  const provider = p.data as { id?: string } | null | undefined;
  const q = useProviderBookings(provider?.id);
  const [tab, setTab] = useState<Tab>("requests");

  const lists = useMemo(() => {
    const all = (q.data ?? []) as ProviderCardBooking[];
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
    <Page tab title={t("pro.bookings.title")} queries={[p, q]} contentStyle={{ gap: 16 }}>
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
        <View style={{ gap: 12 }}>
          {list.map((b) => (
            <ProviderBookingCard key={b.id} booking={b} request={tab === "requests"} />
          ))}
        </View>
      </QueryState>
    </Page>
  );
}
