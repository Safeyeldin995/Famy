import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Calendar } from "lucide-react";
import { PrimaryButton, StatusPill, CancelBookingDialog } from "@/components/famio/ui";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { OnlineWebLessonPaymentPanel } from "@/components/online/OnlineWebLessonPaymentPanel";
import { useBooking } from "@/lib/db/queries";
import { toUIProvider } from "@/lib/db/adapters";
import { useCancelBooking } from "@/lib/db/cancellation-queries";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";
import { assertWebOnlineBookingRow } from "@/lib/web/webOnlineDataBoundary";
import { bookingAmountDue } from "@/lib/payments/amountDue";
import { authorizeSessionJoin, sessionJoinWindow } from "@/lib/livekit/sessionAccess";
import { formatDate, formatTime, formatLocale } from "@/lib/format";
import { currentLang } from "@/lib/i18n";
import { ICON_STROKE } from "@/lib/icons/constants";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useBookingPayment } from "@/lib/db/payment-queries";
import { moneyHeld } from "@/lib/payments/refundOwed";
import { useState } from "react";
import { toast } from "sonner";
import { usePaymobReturnPaymentPoll } from "@/hooks/usePaymobReturnPaymentPoll";

export const Route = createFileRoute("/online/lessons/$bookingId/")({
  component: OnlineLessonDetail,
});

function OnlineLessonDetail() {
  const { bookingId } = Route.useParams();
  const { paymob_return } = Route.useSearch();
  const { t } = useTranslation();
  const bookingQ = useBooking(bookingId);
  const paymentQ = useBookingPayment(bookingId);
  const cancel = useCancelBooking();
  const [cancelOpen, setCancelOpen] = useState(false);
  const lang = currentLang();
  const locale = formatLocale(lang);

  const userQ = useQuery({
    queryKey: ["online-lesson-user"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
  });

  usePaymobReturnPaymentPoll(paymob_return, paymentQ.refetch);

  if (bookingQ.isLoading) {
    return <p className="text-pro-14 text-muted-foreground">{t("common.loading")}</p>;
  }
  const booking = bookingQ.data;
  if (!booking) {
    return <p className="text-pro-14 text-muted-foreground">{t("onlineWeb.lessons.empty")}</p>;
  }

  const boundary = assertWebOnlineBookingRow(booking);
  if (!boundary.ok) {
    return <p className="text-pro-14 text-muted-foreground">{t("common.pageNotFound")}</p>;
  }

  const userId = userQ.data;
  const isCustomer = userId === String(booking.customer_id);
  const isProvider =
    userId === String((booking as { provider_profile_id?: string | null }).provider_profile_id ?? "");
  if (userId && !isCustomer && !isProvider) {
    return <p className="text-pro-14 text-muted-foreground">{t("common.pageNotFound")}</p>;
  }

  const providerRow = booking.provider as Record<string, unknown> | null | undefined;
  const provider = providerRow ? toUIProvider(providerRow) : null;
  const startAt = new Date(String(booking.start_at));
  const endAt = new Date(String(booking.end_at));
  const totalDue = bookingAmountDue(booking);
  const paid = moneyHeld({
    paymentStatus: paymentQ.data?.status,
    methodType: paymentQ.data?.payment_method_type,
    proofPath: paymentQ.data?.proof_path,
  });

  const joinAuth =
    userQ.data && booking
      ? authorizeSessionJoin(
          {
            id: booking.id,
            service_mode: String(booking.service_mode),
            status: String(booking.status),
            customer_id: String(booking.customer_id),
            provider_id: String(booking.provider_id),
            provider_profile_id: String(
              (booking as { provider_profile_id?: string | null }).provider_profile_id ?? "",
            ),
            start_at: String(booking.start_at),
            end_at: String(booking.end_at),
            payment_captured: paid,
          },
          userQ.data,
        )
      : { ok: false as const, code: "not_participant" };

  const joinWindow = sessionJoinWindow(startAt, endAt);
  const backTo = isProvider ? ONLINE_WEB_ROUTE_IDS.providerLessons : ONLINE_WEB_ROUTE_IDS.lessons;
  const customer = (booking as { customer?: { full_name?: string; avatar_url?: string } }).customer;

  return (
    <div className="space-y-6">
      <Link to={backTo} className="text-pro-14 font-bold text-brand">
        {t("common.back")}
      </Link>

      <LessonCard
        provider={provider}
        customer={customer}
        isProviderView={isProvider}
        booking={booking}
        locale={locale}
        startAt={startAt}
        t={t}
      />

      {isCustomer && String(booking.status) === "confirmed" && !paid ? (
        <OnlineWebLessonPaymentPanel
          bookingId={bookingId}
          total={totalDue}
          onPaid={() => void paymentQ.refetch()}
        />
      ) : null}

      {joinAuth.ok && joinWindow.open ? (
        <Link to="/online/lessons/$bookingId/room" params={{ bookingId }} search={{ paymob_return: undefined }}>
          <PrimaryButton className="h-12 w-full">{t("onlineWeb.walkthrough.joinNow")}</PrimaryButton>
        </Link>
      ) : null}

      {isCustomer && ["pending", "confirmed"].includes(String(booking.status)) ? (
        <button
          type="button"
          className="text-pro-13 font-bold text-coral underline-offset-2 hover:underline"
          onClick={() => setCancelOpen(true)}
        >
          {t("bookingDetail.cancel")}
        </button>
      ) : null}

      <p className="text-pro-12 text-muted-foreground">{t("onlineWeb.cancelPolicy.body")}</p>

      <CancelBookingDialog
        open={cancelOpen}
        actorType="customer"
        bookingStatus={String(booking.status)}
        title={t("bookingDetail.cancelReasonTitle")}
        body={t("onlineWeb.cancelPolicy.body")}
        reasonLabel={t("bookingDetail.cancelReasonLabel")}
        notePlaceholder={t("bookingDetail.cancelReasonPlaceholder")}
        confirmLabel={t("bookingDetail.confirmAction")}
        cancelLabel={t("bookingDetail.keep")}
        pending={cancel.isPending}
        onCancel={() => setCancelOpen(false)}
        onConfirm={(reasonId, note) =>
          cancel.mutate(
            { bookingId, reasonId, note },
            {
              onSuccess: () => {
                setCancelOpen(false);
                toast.success(t("admin.bookings.cancelSuccess"));
                void bookingQ.refetch();
              },
            },
          )
        }
      />
    </div>
  );
}

function LessonCard({
  provider,
  customer,
  isProviderView,
  booking,
  locale,
  startAt,
  t,
}: {
  provider: ReturnType<typeof toUIProvider> | null;
  customer?: { full_name?: string; avatar_url?: string } | null;
  isProviderView: boolean;
  booking: Record<string, unknown>;
  locale: string;
  startAt: Date;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const displayName = isProviderView
    ? customer?.full_name || t("pro.common.customer")
    : provider?.name || t("provider2.unnamed");
  const displayAvatar = isProviderView ? customer?.avatar_url : provider?.avatar;
  return (
    <div className="rounded-2xl border border-border/60 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <ProfileAvatar
          src={displayAvatar}
          name={displayName}
          className="h-12 w-12 rounded-full text-pro-16"
        />
        <div className="min-w-0 flex-1">
          <StatusPill tone="brand">{t(`status.${String(booking.status)}` as "status.pending")}</StatusPill>
          <p className="mt-1 text-pro-16 font-bold">{displayName}</p>
          <p className="mt-1 flex items-center gap-1.5 text-pro-13 text-muted-foreground">
            <Calendar className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
            {formatDate(startAt, { weekday: "short", day: "numeric", month: "short" }, locale)}
            <span aria-hidden>·</span>
            {formatTime(startAt, locale)}
          </p>
        </div>
      </div>
    </div>
  );
}