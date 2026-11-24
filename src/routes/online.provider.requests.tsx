import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BookingRequestActions } from "@/components/provider/BookingRequestActions";
import { QueryError } from "@/components/famio/QueryError";
import { requireOnlineWebSession } from "@/lib/web/onlineWebSession";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";
import { filterWebOnlineBookingRows } from "@/lib/web/webOnlineDataBoundary";
import { useMyProvider, useProviderBookings } from "@/lib/db/provider-queries";
import { formatDate, formatTime, formatLocale } from "@/lib/format";
import { currentLang } from "@/lib/i18n";

export const Route = createFileRoute("/online/provider/requests")({
  beforeLoad: async () => {
    await requireOnlineWebSession(ONLINE_WEB_ROUTE_IDS.providerRequests);
  },
  component: OnlineProviderRequests,
});

function OnlineProviderRequests() {
  const { t } = useTranslation();
  const providerQ = useMyProvider();
  const bookingsQ = useProviderBookings(providerQ.data?.id);
  const locale = formatLocale(currentLang());

  const pending = useMemo(() => {
    const rows = filterWebOnlineBookingRows(bookingsQ.data ?? []);
    return rows.filter((b) => String(b.status) === "pending");
  }, [bookingsQ.data]);

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
        <h1 className="text-pro-22 font-extrabold">{t("onlineWeb.providerRequests.title")}</h1>
        <p className="mt-3 text-pro-15 text-muted-foreground">{t("onlineWeb.providerRequests.lead")}</p>
      </header>

      {bookingsQ.isError ? (
        <QueryError onRetry={() => void bookingsQ.refetch()} />
      ) : bookingsQ.isLoading ? (
        <p className="text-pro-14 text-muted-foreground">{t("common.loading")}</p>
      ) : pending.length === 0 ? (
        <p className="rounded-2xl border border-border/60 bg-white p-6 text-pro-14 text-muted-foreground">
          {t("onlineWeb.providerRequests.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {pending.map((booking) => {
            const customer = (booking as { customer?: { full_name?: string } }).customer;
            const startAt = new Date(String(booking.start_at));
            return (
              <li key={String(booking.id)} className="overflow-hidden rounded-2xl border border-border/60 bg-white shadow-sm">
                <div className="p-4">
                  <p className="text-pro-16 font-bold">{customer?.full_name ?? t("provider2.unnamed")}</p>
                  <p className="mt-1 text-pro-13 text-muted-foreground">
                    {formatDate(startAt, { weekday: "short", day: "numeric", month: "short" }, locale)}{" "}
                    · {formatTime(startAt, locale)}
                  </p>
                </div>
                <BookingRequestActions id={String(booking.id)} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}