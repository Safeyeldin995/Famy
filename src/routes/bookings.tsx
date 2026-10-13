import { useBookingParties } from "@/lib/db/booking-parties";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AppShell,
  EmptyState,
  SecondaryButton,
  SegmentedControl,
  StatusPill,
} from "@/components/famio/ui";
import { CustomerPageHeader } from "@/components/famio/CustomerPageHeader";
import { useMyBookings } from "@/lib/db/queries";
import { bookingStatusTone } from "@/lib/utils";
import { formatEGP, formatNumber, formatLocale } from "@/lib/format";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { QueryError } from "@/components/famio/QueryError";
import { isPreviewRoute } from "@/lib/preview/constants";
import { currentLang } from "@/lib/i18n";
import { previewBookPath, previewPath } from "@/lib/preview/previewPath";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Clock, Repeat, ChevronRight } from "lucide-react";
import { ICON_STROKE } from "@/lib/icons/constants";
import { isProviderNoResponseCancellation } from "@/lib/booking/pending-expiry";
import { useProviderOnlyCustomerRedirect } from "@/lib/auth/providerOnlyCustomerGuard";

export const Route = createFileRoute("/bookings")({ component: Bookings });

type Tab = "upcoming" | "completed" | "cancelled";

const TAB_STATUSES: Record<Tab, string[]> = {
  upcoming: [
    "pending",
    "confirmed",
    "on_the_way",
    "arrived",
    "arrival_confirmed",
    "in_progress",
    "completion_requested",
    "disputed",
  ],
  completed: ["completed"],
  cancelled: ["cancelled", "no_show"],
};

const TAB_SUBTITLE: Record<Tab, string> = {
  upcoming: "bookings.subtitleUpcoming",
  completed: "bookings.subtitleHistory",
  cancelled: "bookings.subtitleCancelled",
};

function statusPillTone(status: string): "brand" | "ink" | "success" | "warning" | "muted" {
  const tone = bookingStatusTone(status);
  if (tone === "mint") return "success";
  if (tone === "coral") return "brand";
  if (tone === "navy") return "ink";
  return "muted";
}

function Bookings() {
  const { blocking } = useProviderOnlyCustomerRedirect();
  const { t } = useTranslation();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("upcoming");
  const q = useMyBookings();
  const partiesQ = useBookingParties((q.data ?? []).map((booking) => booking.id));
  const lang = currentLang();
  const locale = formatLocale(lang);

  const list = useMemo(() => {
    const all = q.data ?? [];
    return all.filter((b: any) => TAB_STATUSES[tab].includes(b.status));
  }, [q.data, tab]);

  const tabLabel = t(`bookings.${tab}`);

  if (blocking) return null;

  return (
    <AppShell>
      <CustomerPageHeader title={t("bookings.title")} subtitle={t(TAB_SUBTITLE[tab])} />
      <div className="px-5">
        <div className="mt-4 rounded-2xl border border-border/60 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <p className="text-pro-14 font-extrabold text-foreground">{tabLabel}</p>
            {!q.isLoading && !q.isError ? (
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-pro-12 font-bold text-muted-foreground">
                {formatNumber(list.length)}
              </span>
            ) : null}
          </div>
          <SegmentedControl
            value={tab}
            onChange={setTab}
            options={[
              { value: "upcoming", label: t("bookings.upcoming") },
              { value: "completed", label: t("bookings.completed") },
              { value: "cancelled", label: t("bookings.cancelled") },
            ]}
          />
        </div>
      </div>

      <div className="mt-5 space-y-2.5 px-5 pb-6">
        {q.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[5.5rem] animate-pulse rounded-[1.75rem] bg-surface-2" />
          ))
        ) : q.isError ? (
          <QueryError onRetry={() => q.refetch()} />
        ) : list.length === 0 ? (
          <Empty />
        ) : (
          list.map((b: any) => {
            const profile = b.provider?.profile ?? {};
            const party = partiesQ.data?.get(b.id);
            const name = party?.other_name || profile.full_name || t("provider2.unnamed");
            const serviceLabel = (lang === "ar" ? b.service?.name_ar : b.service?.name_en) || "";
            const start = new Date(b.start_at);
            const end = new Date(b.end_at);
            const hours = Math.max(1, Math.round((+end - +start) / 36e5));
            const dateLabel = start.toLocaleDateString(locale, {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            const timeLabel = start.toLocaleTimeString(locale, {
              hour: "numeric",
              minute: "2-digit",
            });
            const shortId = b.id.slice(0, 8).toUpperCase();
            const isPast = tab !== "upcoming";
            const expired = isProviderNoResponseCancellation(b);
            return (
              <article
                key={b.id}
                className={`overflow-hidden rounded-[1.75rem] border shadow-sm ${
                  isPast ? "border-border/40 bg-surface-2" : "border-border/50 bg-surface-elevated"
                }`}
              >
                <Link
                  to={isPreviewRoute() ? "/preview/bookings" : "/booking/$id"}
                  params={{ id: b.id }}
                  search={isPreviewRoute() ? { bookingId: b.id } : {}}
                  className="focus-ring tap-scale block p-4"
                >
                  <div className="flex flex-wrap items-start gap-3">
                    <ProfileAvatar
                      src={party?.other_avatar_url || profile.avatar_url}
                      name={name}
                      className={`h-14 w-14 shrink-0 rounded-full ring-2 ${
                        isPast ? "ring-border/40 opacity-90" : "ring-border/60"
                      }`}
                    />
                    <div className="min-w-0 flex-1 basis-48">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-pro-14 font-bold text-foreground">{name}</p>
                          <p className="mt-0.5 truncate text-pro-12 text-muted-foreground">
                            {serviceLabel}
                          </p>
                        </div>
                        <StatusPill tone={statusPillTone(b.status)}>
                          {t(`status.${b.status}` as any, b.status) as string}
                        </StatusPill>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-pro-12 text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Calendar
                            className="h-3 w-3"
                            strokeWidth={ICON_STROKE}
                            aria-hidden="true"
                          />
                          {dateLabel}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" strokeWidth={ICON_STROKE} aria-hidden="true" />
                          {timeLabel} · {t("bookings.hoursShort", { hours: formatNumber(hours) })}
                        </span>
                      </div>
                      {expired ? (
                        <p className="mt-2 text-pro-12 font-semibold text-muted-foreground">
                          {t("bookings.expiredReason")}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex w-full items-center justify-between gap-3 border-t border-border/50 pt-3 text-end">
                      <p
                        className={`text-pro-14 font-extrabold ${isPast ? "text-foreground" : "text-brand"}`}
                      >
                        {formatEGP(Number(b.price_total ?? 0))}
                      </p>
                      <p className="mt-0.5 text-pro-12 text-muted-foreground" dir="ltr">
                        #{shortId}
                      </p>
                      {!isPast ? (
                        <ChevronRight
                          className="mt-1 ms-auto h-4 w-4 text-muted-foreground rtl-flip"
                          strokeWidth={ICON_STROKE}
                          aria-hidden="true"
                        />
                      ) : null}
                    </div>
                  </div>
                </Link>
                {isPast ? (
                  <div className="flex gap-2 border-t border-border/70 px-4 pb-4 pt-3">
                    <SecondaryButton
                      className="flex-1 !rounded-[1.25rem]"
                      onClick={() => {
                        if (expired) {
                          nav({ to: previewPath("/home") });
                          return;
                        }
                        nav({
                          to: previewBookPath(b.provider_id),
                          search: {
                            serviceId: b.service_id ?? undefined,
                            capabilityId: b.teaching_capability_id ?? undefined,
                          },
                        });
                      }}
                    >
                      <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
                      {expired ? t("bookings.bookAnotherProvider") : t("bookings.bookAgain")}
                    </SecondaryButton>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </AppShell>
  );
}

function Empty() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon="calendar"
      title={t("customerRound2.emptyBookings")}
      body={t("customerRound2.emptyBookingsBody")}
      action={
        <Link
          to={previewPath("/home")}
          className="focus-ring inline-flex min-h-11 items-center rounded-full bg-brand px-6 text-pro-14 font-bold text-white"
        >
          {t("bookings.browse")}
        </Link>
      }
    />
  );
}
