import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, ChevronRight } from "lucide-react";
import { PrimaryButton, SegmentedControl, StatusPill } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { requireOnlineWebSession } from "@/lib/web/onlineWebSession";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";
import { filterWebOnlineBookingRows, redactInPersonFieldsForWeb } from "@/lib/web/webOnlineDataBoundary";
import { useMyProvider, useProviderBookings } from "@/lib/db/provider-queries";
import { bookingStatusTone } from "@/lib/utils";
import { formatDate, formatTime, formatLocale } from "@/lib/format";
import { currentLang } from "@/lib/i18n";
import { ICON_STROKE } from "@/lib/icons/constants";
import { OnlineProviderBookingSummary } from "@/components/online/OnlineProviderBookingSummary";

export const Route = createFileRoute("/online/provider/lessons")({
  beforeLoad: async ({ location }) => {
    await requireOnlineWebSession(location.href);
  },
  component: OnlineProviderLessons,
});

type Tab = "upcoming" | "past";

const UPCOMING_STATUSES = new Set([
  "pending",
  "confirmed",
  "on_the_way",
  "arrived",
  "arrival_confirmed",
  "in_progress",
  "completion_requested",
  "disputed",
]);

function statusTone(status: string): "brand" | "ink" | "success" | "warning" | "muted" {
  const tone = bookingStatusTone(status);
  if (tone === "mint") return "success";
  if (tone === "coral") return "brand";
  if (tone === "navy") return "ink";
  return "muted";
}

function OnlineProviderLessons() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("upcoming");
  const providerQ = useMyProvider();
  const bookingsQ = useProviderBookings(providerQ.data?.id);
  const lang = currentLang();
  const locale = formatLocale(lang);

  const list = useMemo(() => {
    const rows = filterWebOnlineBookingRows(bookingsQ.data ?? []).map((b) =>
      redactInPersonFieldsForWeb(b as Record<string, unknown>),
    );
    return rows.filter((b) => {
      const upcoming = UPCOMING_STATUSES.has(String(b.status));
      return tab === "upcoming" ? upcoming : !upcoming;
    });
  }, [bookingsQ.data, tab]);

  if (providerQ.isLoading) {
    return <p className="text-pro-14 text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!providerQ.data?.id) {
    return (
      <div className="rounded-3xl bg-white p-8 shadow-sm">
        <p className="text-pro-15 text-muted-foreground">{t("onlineWeb.providerRequests.noProvider")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="rounded-3xl bg-white p-8 shadow-sm">
        <h1 className="text-pro-22 font-extrabold">{t("onlineWeb.providerLessons.title")}</h1>
        <p className="mt-3 text-pro-15 text-muted-foreground">{t("onlineWeb.providerLessons.lead")}</p>
      </header>

      <SegmentedControl
        value={tab}
        onChange={setTab}
        options={[
          { value: "upcoming", label: t("onlineWeb.lessons.upcoming") },
          { value: "past", label: t("onlineWeb.lessons.past") },
        ]}
      />

      {bookingsQ.isError ? (
        <QueryError onRetry={() => void bookingsQ.refetch()} />
      ) : bookingsQ.isLoading ? (
        <p className="text-pro-14 text-muted-foreground">{t("common.loading")}</p>
      ) : list.length === 0 ? (
        <p className="rounded-2xl border border-border/60 bg-white p-6 text-pro-14 text-muted-foreground">
          {t("onlineWeb.lessons.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {list.map((booking) => {
            const customer = (booking as { customer?: { full_name?: string; avatar_url?: string } }).customer;
            const name = customer?.full_name ?? "";
            const startAt = new Date(String(booking.start_at));
            return (
              <li key={String(booking.id)}>
                <Link
                  to="/online/lessons/$bookingId"
                  params={{ bookingId: String(booking.id) }}
                  search={{ paymob_return: undefined }}
                  className="block rounded-2xl border border-border/60 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <ProfileAvatar
                      src={customer?.avatar_url}
                      name={name}
                      className="h-12 w-12 rounded-full text-pro-16"
                    />
                    <div className="min-w-0 flex-1">
                      <StatusPill tone={statusTone(String(booking.status))}>
                        {t(`status.${String(booking.status)}` as "status.pending", String(booking.status))}
                      </StatusPill>
                      <p className="mt-1 text-pro-16 font-bold">{name || t("pro.common.customer")}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-pro-13 text-muted-foreground">
                        <Calendar className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
                        {formatDate(startAt, { weekday: "short", day: "numeric", month: "short" }, locale)}
                        <span aria-hidden>·</span>
                        {formatTime(startAt, locale)}
                      </p>
                      <div className="mt-2">
                        <OnlineProviderBookingSummary
                          booking={booking as import("@/components/online/OnlineProviderBookingSummary").OnlineProviderBookingSummaryRow}
                          compact
                        />
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground ltr:rotate-0 rtl:rotate-180" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Link to={ONLINE_WEB_ROUTE_IDS.providerRequests}>
        <PrimaryButton className="h-11 w-full">{t("onlineWeb.nav.providerRequests")}</PrimaryButton>
      </Link>
    </div>
  );
}