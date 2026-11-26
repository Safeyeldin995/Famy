import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Calendar } from "lucide-react";
import { PrimaryButton, StatusPill, CancelBookingDialog } from "@/components/famio/ui";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { OnlineWebLessonPaymentPanel } from "@/components/online/OnlineWebLessonPaymentPanel";
import { useBooking } from "@/lib/db/queries";
import { toUIProvider } from "@/lib/db/adapters";
import { useBookingCancellation, useCancelBooking } from "@/lib/db/cancellation-queries";
import { bookingTeachingSummary } from "@/lib/tutoring/bookingTeachingSummary";
import { onlineLessonJourneyIndex } from "@/lib/online/onlineLessonJourney";
import { cancelDialogCopy, cancelSuccessCopy } from "@/lib/online/onlineLessonCancelCopy";
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
import { OnlineProviderBookingSummary } from "@/components/online/OnlineProviderBookingSummary";
import type { OnlineProviderBookingSummaryRow } from "@/components/online/OnlineProviderBookingSummary";
import { OnlineWebLessonIssueReport } from "@/components/online/OnlineWebLessonIssueReport";
import { BookingRequestActions } from "@/components/provider/BookingRequestActions";
import { useOnlineCancellationPolicySummary } from "@/lib/online/useOnlineCancellationPolicy";
import { useBookingCancellationFee } from "@/lib/db/settings-queries";

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
  const cancelPolicyQ = useOnlineCancellationPolicySummary();
  const cancelFeeQ = useBookingCancellationFee(bookingId, cancelOpen);
  const cancellationQ = useBookingCancellation(
    bookingQ.data && String(bookingQ.data.status) === "cancelled" ? bookingId : undefined,
  );
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
  const cancelPolicyBody = cancelPolicyQ.summary;
  const cancelFee = cancelFeeQ.data;
  const isPendingRequest = String(booking.status) === "pending";
  const cancelDialog = cancelDialogCopy({
    pending: isPendingRequest,
    fee: cancelFee ?? null,
    policySummary: cancelPolicyBody,
    formatAmount: (n) => formatEGP(n, undefined, lang),
    t,
  });
  const journeyIndex = onlineLessonJourneyIndex(
    String(booking.status),
    captured,
    Date.now(),
    String(booking.start_at),
    String(booking.end_at),
  );
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

      {String(booking.status) === "cancelled" ? (
        <CancelledBanner
          cancellation={cancellationQ.data ?? null}
          isProviderView={isProvider}
          formatAmount={(n) => formatEGP(n, undefined, lang)}
          t={t}
        />
      ) : null}

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

      {isCustomer && journeyIndex >= 0 ? <LessonSteps current={journeyIndex} t={t} /> : null}

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

      {userId && (isCustomer || isProvider) ? (
        <OnlineWebLessonIssueReport
          bookingId={bookingId}
          startAt={String(booking.start_at)}
          endAt={String(booking.end_at)}
        />
      ) : null}

      {isProvider && String(booking.status) === "pending" ? (
        <BookingRequestActions id={bookingId} />
      ) : null}

      {isCustomer && ["pending", "confirmed"].includes(String(booking.status)) ? (
        <button
          type="button"
          className="text-pro-13 font-bold text-coral underline-offset-2 hover:underline"
          onClick={() => setCancelOpen(true)}
        >
          {isPendingRequest ? t("onlineWeb.cancel.requestAction") : t("onlineWeb.cancel.lessonAction")}
        </button>
      ) : null}

      <p className="text-pro-12 text-muted-foreground">{cancelPolicyBody}</p>

      <CancelBookingDialog
        open={cancelOpen}
        actorType="customer"
        bookingStatus={String(booking.status)}
        title={cancelDialog.title}
        body={cancelDialog.body}
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
                toast.success(
                  cancelSuccessCopy({
                    pending: isPendingRequest,
                    fee: cancelFee ?? null,
                    formatAmount: (n) => formatEGP(n, undefined, lang),
                    t,
                  }),
                  { duration: 8000 },
                );
                void bookingQ.refetch();
                void cancellationQ.refetch();
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
  const teachingLine = bookingTeachingSummary(
    booking as Parameters<typeof bookingTeachingSummary>[0],
    lang,
  );
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
          {isProviderView ? (
            <div className="mt-3">
              <OnlineProviderBookingSummary booking={booking as OnlineProviderBookingSummaryRow} />
            </div>
          ) : (
            <>
              {serviceLabel ? (
                <p className="mt-1 text-pro-13 text-muted-foreground">{serviceLabel}</p>
              ) : null}
              {teachingLine ? (
                <p className="mt-1 text-pro-13 font-semibold text-foreground">{teachingLine}</p>
              ) : null}
              <p className="mt-1 text-pro-13 font-bold tabular-nums">
                {t("bookFlow.sessionLine", { minutes: formatNumber(durationMin, lang) })} ·{" "}
                {formatEGP(totalDue, undefined, lang)}
              </p>
              <p className="text-pro-12 text-muted-foreground">{t("onlineWeb.timezoneLabel")}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CancelledBanner({
  cancellation,
  isProviderView,
  formatAmount,
  t,
}: {
  cancellation: { cancelled_by_role?: string | null; previous_status?: string | null; cancellation_fee?: number | string | null } | null;
  isProviderView: boolean;
  formatAmount: (n: number) => string;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const fee = Number(cancellation?.cancellation_fee ?? 0);
  const byCustomer = cancellation?.cancelled_by_role === "customer";
  const wasRequest = cancellation?.previous_status === "pending";
  const who = byCustomer
    ? isProviderView
      ? t("onlineWeb.cancelled.byStudent")
      : t("onlineWeb.cancelled.byYou")
    : cancellation?.cancelled_by_role === "provider"
      ? isProviderView
        ? t("onlineWeb.cancelled.byYou")
        : t("onlineWeb.cancelled.byTutor")
      : t("onlineWeb.cancelled.bySystem");
  return (
    <div className="space-y-1 rounded-2xl border border-coral/30 bg-coral/5 p-4" role="status">
      <p className="text-pro-16 font-bold text-foreground">
        {wasRequest ? t("onlineWeb.cancelled.requestTitle") : t("onlineWeb.cancelled.lessonTitle")}
      </p>
      {cancellation ? <p className="text-pro-13 text-muted-foreground">{who}</p> : null}
      {cancellation ? (
        <p className="text-pro-13 font-bold text-foreground">
          {fee > 0
            ? t("onlineWeb.cancelled.fee", { amount: formatAmount(fee) })
            : t("onlineWeb.cancelled.noFee")}
        </p>
      ) : null}
    </div>
  );
}

const LESSON_STEP_KEYS = ["requested", "accepted", "paid", "lesson"] as const;

function LessonSteps({ current, t }: { current: number; t: ReturnType<typeof useTranslation>["t"] }) {
  // Journey 0 requested, 1 accepted (pay now), 2-3 paid, 4-5 in or after the lesson.
  const active = current <= 0 ? 0 : current === 1 ? 1 : current <= 3 ? 2 : 3;
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label={t("onlineWeb.steps.label")}>
      {LESSON_STEP_KEYS.map((key, i) => {
        const done = i < active;
        const now = i === active;
        return (
          <li
            key={key}
            aria-current={now ? "step" : undefined}
            className={`min-w-0 rounded-2xl border p-3 text-center text-pro-12 font-bold ${
              now
                ? "border-brand bg-brand/10 text-brand"
                : done
                  ? "border-border bg-white text-foreground"
                  : "border-border/60 bg-white text-muted-foreground"
            }`}
          >
            <span className="block tabular-nums">{i + 1}</span>
            <span className="block truncate">{t(`onlineWeb.steps.${key}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}
