import { createFileRoute, Link } from "@tanstack/react-router";
import { toUIProvider } from "@/lib/db/adapters";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, ChevronRight } from "lucide-react";
import { PrimaryButton, SegmentedControl, StatusPill } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { useMyBookings } from "@/lib/db/queries";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";
import { filterWebOnlineBookingRows, redactInPersonFieldsForWeb } from "@/lib/web/webOnlineDataBoundary";
import { bookingStatusTone } from "@/lib/utils";
import { formatDate, formatTime, formatLocale } from "@/lib/format";
import { currentLang } from "@/lib/i18n";
import { ICON_STROKE } from "@/lib/icons/constants";

export const Route = createFileRoute("/online/lessons/")({
  component: OnlineLessonsIndex,
});

type Tab = "upcoming" | "past";

const UPCOMING = new Set([
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

function OnlineLessonsIndex() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("upcoming");
  const bookingsQ = useMyBookings({ serviceMode: "online" });
  const lang = currentLang();
  const locale = formatLocale(lang);

  const list = useMemo(() => {
    const rows = filterWebOnlineBookingRows(bookingsQ.data ?? []).map((b) =>
      redactInPersonFieldsForWeb(b as Record<string, unknown>),
    );
    return rows.filter((b) => {
      const upcoming = UPCOMING.has(String(b.status));
      return tab === "upcoming" ? upcoming : !upcoming;
    });
  }, [bookingsQ.data, tab]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-pro-24 font-extrabold">{t("onlineWeb.lessons.title")}</h1>
        <p className="mt-2 text-pro-14 text-muted-foreground">{t("onlineWeb.lessons.lead")}</p>
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
        <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
          <p className="text-pro-15 text-muted-foreground">{t("onlineWeb.lessons.empty")}</p>
          <Link to={ONLINE_WEB_ROUTE_IDS.tutors} className="mt-6 inline-block">
            <PrimaryButton className="h-12 px-6">{t("onlineWeb.lessons.browse")}</PrimaryButton>
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((booking) => {
            const provider = (booking as { provider?: Record<string, unknown> | null }).provider;
            const ui = provider ? toUIProvider(provider) : null;
            const providerName = ui?.name ?? "";
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
                      src={ui?.avatar}
                      name={providerName}
                      className="h-12 w-12 rounded-full text-pro-16"
                    />
                    <div className="min-w-0 flex-1">
                      <OnlineLessonStatusPill status={String(booking.status)} />
                      <p className="mt-1 text-pro-16 font-bold">{providerName || t("provider2.unnamed")}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-pro-13 text-muted-foreground">
                        <Calendar className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
                        {formatDate(startAt, { weekday: "short", day: "numeric", month: "short" }, locale)}
                        <span aria-hidden>·</span>
                        {formatTime(startAt, locale)}
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground ltr:rotate-0 rtl:rotate-180" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-pro-12 leading-relaxed text-muted-foreground">{t("onlineWeb.cancelPolicy.body")}</p>
    </div>
  );
}

function OnlineLessonStatusPill({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <StatusPill tone={statusTone(status)}>
      {t(`status.${status}` as "status.pending", status)}
    </StatusPill>
  );
}