import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { BOOKING_ACTIVE_STATUSES } from "@/lib/provider/constants";
import { useMyProvider, useProviderBookings } from "@/lib/provider/queries";
import { ProviderBookingCard, type ProviderCardBooking } from "@/ui/provider/ProviderBookingCard";
import { Page, QueryState } from "@/ui/Page";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { space } from "@/ui/theme";
import {
  defaultProviderJobsTab,
  groupProviderUpcomingBookings,
  providerUpcomingDayLabel,
} from "@shared/provider/providerJobsList";

type Tab = "requests" | "upcoming" | "history";

function JobsSectionHeader({ title }: { title: string }) {
  return (
    <Text weight="heavy" size="sm" style={{ marginTop: space.xs }}>
      {title}
    </Text>
  );
}

function JobsDayHeader({ title }: { title: string }) {
  return (
    <Text weight="bold" size="sm" tone="muted">
      {title}
    </Text>
  );
}

export default function ProviderJobs() {
  const { t, i18n } = useTranslation();
  const p = useMyProvider();
  const provider = p.data as { id?: string } | null | undefined;
  const q = useProviderBookings(provider?.id);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [tabPinned, setTabPinned] = useState(false);

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

  useEffect(() => {
    if (tabPinned || !q.data) return;
    setTab(defaultProviderJobsTab(lists.requests.length, lists.upcoming));
  }, [q.data, lists.requests.length, lists.upcoming, tabPinned]);

  const upcomingSections = useMemo(
    () => groupProviderUpcomingBookings(lists.upcoming),
    [lists.upcoming],
  );

  const list = lists[tab];
  const emptyKey =
    tab === "requests"
      ? "pro.bookings.emptyRequests"
      : tab === "upcoming"
        ? "pro.bookings.emptyUpcoming"
        : "pro.bookings.emptyHistory";

  const requestCount = lists.requests.length;

  return (
    <Page tab title={t("pro.bookings.title")} queries={[p, q]} contentStyle={{ gap: 16 }}>
      <Segmented
        value={tab}
        onChange={(value) => {
          setTabPinned(true);
          setTab(value);
        }}
        options={[
          { value: "upcoming", label: t("pro.bookings.upcoming") },
          {
            value: "requests",
            label: t("pro.bookings.requests"),
            badgeCount: requestCount > 0 ? requestCount : undefined,
          },
          { value: "history", label: t("pro.bookings.history") },
        ]}
      />
      <QueryState query={q} empty={!list.length} emptyKey={emptyKey}>
        <View style={{ gap: 12 }}>
          {tab === "upcoming"
            ? upcomingSections.map((section, index) => (
                <View key={`${section.kind}-${section.kind === "day" ? section.dayKey : section.kind}`} style={{ gap: 12 }}>
                  {section.kind === "now" ? (
                    <JobsSectionHeader title={t("pro.bookings.sectionNow")} />
                  ) : null}
                  {section.kind === "today" ? (
                    <JobsSectionHeader title={t("pro.bookings.sectionToday")} />
                  ) : null}
                  {section.kind === "day" &&
                  !upcomingSections.slice(0, index).some((s) => s.kind === "day") ? (
                    <JobsSectionHeader title={t("pro.bookings.sectionLater")} />
                  ) : null}
                  {section.kind === "day" ? (
                    <JobsDayHeader
                      title={providerUpcomingDayLabel(section.dayKey, i18n.language)}
                    />
                  ) : null}
                  {section.bookings.map((b) => (
                    <ProviderBookingCard
                      key={b.id}
                      booking={b}
                      emphasize={section.kind === "now"}
                    />
                  ))}
                </View>
              ))
            : list.map((b) => (
                <ProviderBookingCard key={b.id} booking={b} request={tab === "requests"} />
              ))}
        </View>
      </QueryState>
    </Page>
  );
}
