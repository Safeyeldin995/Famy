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
import { authorizeSessionJoin, paymentCapturedForJoin, sessionJoinWindow } from "@/lib/livekit/sessionAccess";
import { formatDate, formatTime, formatLocale, formatEGP, formatNumber } from "@/lib/format";
import { ONLINE_WEB_TIME_ZONE } from "@/lib/online/onlineWebCairoTime";
import { onlineLessonDetailGuidance } from "@/lib/online/onlineLessonDetailUx";
import { currentLang } from "@/lib/i18n";
import { ICON_STROKE } from "@/lib/icons/constants";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useBookingPayment } from "@/lib/db/payment-queries";
import { moneyHeld } from "@/lib/payments/refundOwed";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { usePaymobReturnPaymentPoll } from "@/hooks/usePaymobReturnPaymentPoll";
import { useNowTick } from "@/hooks/useNowTick";

export const Route = createFileRoute("/online/lessons/$bookingId/")({
  component: OnlineLessonDetail,
});

function OnlineLessonDetail() {
  const { bookingId } = Route.useParams();
  const { paymob_return } = Route.useSearch();
  const { t } = useTranslation();
  const bookingQ = useBooking(bookingId);
  const userQ = useQuery({
    queryKey: ["online-lesson-user"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
  });
  const userId = userQ.data;
  const providerProfileId = bookingQ.data
    ? String((bookingQ.data as { provider_profile_id?: string | null }).provider_profile_id ?? "")
    : "";
  const isProviderViewer = !!userId && userId === providerProfileId;
  const paymentQ = useBookingPayment(bookingId, { providerSafe: isProviderViewer });
  const cancel = useCancelBooking();
  const [cancelOpen, setCancelOpen] = useState(false);
  const lang = currentLang();
  const locale = formatLocale(lang);

  usePaymobReturnPaymentPoll(paymob_return, paymentQ.refetch);
  // Join eligibility is computed from the clock at render; tick so the Join button appears when the window opens.
  useNowTick(30_000);
  // Keep both sides current without a reload: the student waits for the tutor to
  // confirm (booking status), the tutor waits for the student to pay (payment
  // capture). Poll every 15s only while one of those is still outstanding.
  const bookingStatus = bookingQ.data ? String(bookingQ.data.status) : null;
  const awaitingCapture = !paymentCapturedForJoin(paymentQ.data);
  const refetchBooking = bookingQ.refetch;
  const refetchPayment = paymentQ.refetch;
  useEffect(() => {
    const waitingConfirm = bookingStatus === "pending";
    const waitingPayment = bookingStatus === "confirmed" && awaitingCapture;
    if (!waitingConfirm && !waitingPayment) return;
    const id = setInterval(() => {
      void refetchBooking();
      void refetchPayment();
    }, 15_000);
    return () => clearInterval(id);
  }, [bookingStatus, awaitingCapture, refetchBooking, refetchPayment]);

  if (bookingQ.isLoading) {
    return <p className="text-pro-14 text-muted-foreground">{t("common.loading")}</p>;
  }
  if (bookingQ.isError) {
    return (
      <div className="space-y-3">
        <p className="text-pro-14 text-coral">{t("onlineWeb.lessonDetail.loadError")}</p>
        <PrimaryButton className="h-10" onClick={() => void bookingQ.refetch()}>
          {t("common.tryAgain")}
        </PrimaryButton>
      </div>
    );
  }
  const booking = bookingQ.data;
  if (!booking) {
    return <p className="text-pro-14 text-muted-foreground">{t("onlineWeb.lessons.empty")}</p>;
  }

  const boundary = assertWebOnlineBookingRow(booking);
  if (!boundary.ok) {
    return <p className="text-pro-14 text-muted-foreground">{t("common.pageNotFound")}</p>;
  }

  const isCustomer = userId === String(booking.customer_id);
  const isProvider = isProviderViewer;
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
    proofPath: isProvider
      ? paymentQ.data && "has_proof" in paymentQ.data && paymentQ.data.has_proof
        ? "1"
        : null
      : paymentQ.data && "proof_path" in paymentQ.data
        ? paymentQ.data.proof_path
        : null,
  });

  // Joining needs a captured payment (server rule); a receipt in review only holds money.
  const captured = paymentCapturedForJoin(paymentQ.data);

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
            payment_captured: captured,
          },
          userQ.data,
        )
      : { ok: false as const, code: "not_participant" };

  const joinWindow = sessionJoinWindow(startAt, endAt);
  const backTo = isProvider ? ONLINE_WEB_ROUTE_IDS.providerLessons : ONLINE_WEB_ROUTE_IDS.lessons;
  const customer = (booking as { customer?: { full_name?: string; avatar_url?: string } }).customer;
  const serviceRow = booking.service as { name_ar?: string; name_en?: string } | null | undefined;
  const serviceLabel =
    lang === "ar"
      ? serviceRow?.name_ar || serviceRow?.name_en || ""
      : serviceRow?.name_en || serviceRow?.name_ar || "";
  const durationMin = Math.round((endAt.getTime() - startAt.getTime()) / 60_000);
  const confirmedAt = (booking as { confirmed_at?: string | null }).confirmed_at ?? null;
  const guidance = onlineLessonDetailGuidance({
    status: String(booking.status),
    paymentCaptured: captured,
    paidHeld: paid,
    confirmedAt,
    startAt,
    endAt,
    locale,
  });
  const paymobFailed =
    paymob_return === "1" && !paymentQ.isLoading && !captured && String(booking.status) === "confirmed";

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
        endAt={endAt}
        serviceLabel={serviceLabel}
        durationMin={durationMin}
        totalDue={totalDue}
        lang={lang}
        t={t}
      />

      {guidance ? (
        <div className="rounded-2xl border border-brand/20 bg-brand/5 p-4 text-pro-14">
          <p className="font-bold text-foreground">
            {t(guidance.messageKey, guidance.messageParams)}
          </p>
          <p className="mt-1 text-pro-12 text-muted-foreground">{t("onlineWeb.timezoneLabel")}</p>
        </div>
      ) : null}

      {paymobFailed ? (
        <p className="text-pro-14 font-bold text-coral">{t("onlineWeb.lessonDetail.paymobFailed")}</p>
      ) : null}

      {paymentQ.isError ? (
        <div className="space-y-2">
          <p className="text-pro-14 text-coral">{t("onlineWeb.lessonDetail.paymentLoadError")}</p>
          <button type="button" className="text-pro-13 font-bold text-brand underline" onClick={() => void paymentQ.refetch()}>
            {t("common.tryAgain")}
          </button>
        </div>
      ) : null}

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
      ) : guidance?.showJoinDisabled ? (
        <PrimaryButton className="h-12 w-full" disabled>
          {t("onlineWeb.walkthrough.joinNow")}
        </PrimaryButton>
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
              onError: () => toast.error(t("onlineWeb.lessonDetail.cancelFailed")),
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
  endAt,
  serviceLabel,
  durationMin,
  totalDue,
  lang,
  t,
}: {
  provider: ReturnType<typeof toUIProvider> | null;
  customer?: { full_name?: string; avatar_url?: string } | null;
  isProviderView: boolean;
  booking: Record<string, unknown>;
  locale: string;
  startAt: Date;
  endAt: Date;
  serviceLabel: string;
  durationMin: number;
  totalDue: number;
  lang: string;
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
            {formatDate(startAt, { weekday: "short", day: "numeric", month: "short" }, locale, ONLINE_WEB_TIME_ZONE)}
            <span aria-hidden>·</span>
            {formatTime(startAt, locale, ONLINE_WEB_TIME_ZONE)}
            <span aria-hidden>–</span>
            {formatTime(endAt, locale, ONLINE_WEB_TIME_ZONE)}
          </p>
          {serviceLabel ? (
            <p className="mt-1 text-pro-13 text-muted-foreground">{serviceLabel}</p>
          ) : null}
          <p className="mt-1 text-pro-13 font-bold tabular-nums">
            {t("bookFlow.sessionLine", { minutes: formatNumber(durationMin, lang) })} ·{" "}
            {formatEGP(totalDue, undefined, lang)}
          </p>
          <p className="text-pro-12 text-muted-foreground">{t("onlineWeb.timezoneLabel")}</p>
        </div>
      </div>
    </div>
  );
}