import { CustomerPageHeader } from "@/components/famio/CustomerPageHeader";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { previewPath } from "@/lib/preview/previewPath";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PhoneFrame, PrimaryButton, Card, Badge, BackButton, BookingTimeline, ReasonDialog, CancelBookingDialog, CaseDialog, SupportCasesCard, ErrorState, EmptyState } from "@/components/famio/ui";
import { PaymentBlock } from "@/components/famio/PaymentBlock";
import { RescheduleSection } from "@/components/famio/RescheduleSection";
import {
  useBooking,
  useFavoriteIds,
  useToggleFavorite,
  useBookingReview,
  useSubmitReview,
  useUpdateBookingStatus,
  useMyPushSubscriptions,
} from "@/lib/db/queries";
import { useCancelBooking, useBookingCancellation } from "@/lib/db/cancellation-queries";
import {
  useBookingDisputes, useOpenDispute, activeDispute,
  useBookingNoShowReports, useReportNoShow, activeNoShowReport,
  useBookingSupportTickets, useCreateSupportTicket,
  uploadCaseEvidence, type TicketCategory,
} from "@/lib/db/case-queries";
import { toUIProvider } from "@/lib/db/adapters";
import { customerRoleLabel } from "@/components/famio/customerProviders";
import { currentLang } from "@/lib/i18n";
import { formatEGP, formatDate, formatTime, formatDuration, formatLocale } from "@/lib/format";
import { Check, MapPin, Calendar, Clock, Phone, Download, HelpCircle, AlertTriangle, Star, ShieldCheck, Bell, UserCheck, X, LifeBuoy } from "lucide-react";
import { BookingChatPanel } from "@/components/famio/BookingChatPanel";
import { useBookingParty } from "@/lib/db/booking-parties";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { peekPendingPayment } from "@/lib/booking/post-create-payment";
import { isProviderNoResponseCancellation } from "@/lib/booking/pending-expiry";
import { PushEnablePrompt } from "@/components/famio/PushEnablePrompt";
import { shouldOfferPushPrompt } from "@/lib/push-prompt";


export const Route = createFileRoute("/booking/$id")({
  component: BookingDetail,
});

const TRACKABLE_STATUSES = ["on_the_way", "arrived", "arrival_confirmed", "in_progress", "completion_requested"];
const DISPUTE_ELIGIBLE_STATUSES = ["on_the_way", "arrived", "arrival_confirmed", "in_progress", "completion_requested"];
const SUPPORT_CATEGORIES: TicketCategory[] = ["payment", "service_quality", "provider_behavior", "booking_issue", "app_issue", "other"];

type CustomerDialog = "" | "cancel" | "no_show" | "confirmArrival" | "confirmCompletion" | "dispute" | "support";

function BookingDetail() {
  const { id } = Route.useParams();
  const locationSearch = Route.useSearch() as { paymob_return?: string; paymob_checkout?: string };
  return <BookingDetailContent bookingId={id} paymobReturn={locationSearch.paymob_return === "1"} paymobCheckout={locationSearch.paymob_checkout === "1"} />;
}

export function BookingDetailContent({ bookingId: id, paymobReturn = false, paymobCheckout = false }: { bookingId: string; paymobReturn?: boolean; paymobCheckout?: boolean }) {
  const { t } = useTranslation();
  const realQ = useBooking(id);
  const real = realQ.data;
  const status: string | undefined = real?.status;
  const lang = currentLang();
  const locale = formatLocale(lang);
  const updateStatus = useUpdateBookingStatus();
  const cancelBooking = useCancelBooking();
  const cancellationQ = useBookingCancellation(status === "cancelled" ? id : undefined);
  const [dialog, setDialog] = useState<CustomerDialog>("");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const favIdsQ = useFavoriteIds();
  const toggleFav = useToggleFavorite();
  const reviewQ = useBookingReview(status === "completed" ? id : undefined);
  const submitReview = useSubmitReview();
  const nav = useNavigate();
  const devicesQ = useMyPushSubscriptions();
  const [pushPromptOpen, setPushPromptOpen] = useState(false);

  useEffect(() => {
    if (devicesQ.isLoading) return;
    const hasDevice = (devicesQ.data ?? []).length > 0;
    if (shouldOfferPushPrompt("customer", { hasDeviceSubscription: hasDevice })) {
      setPushPromptOpen(true);
    }
  }, [devicesQ.isLoading, devicesQ.data]);

  const disputesQ = useBookingDisputes(id);
  const noShowReportsQ = useBookingNoShowReports(id);
  const supportTicketsQ = useBookingSupportTickets(id);
  const { party } = useBookingParty(id);
  const dispute = activeDispute(disputesQ.data);
  const noShowReport = activeNoShowReport(noShowReportsQ.data);
  const openDispute = useOpenDispute();
  const reportNoShowMut = useReportNoShow();
  const createTicket = useCreateSupportTicket();
  const pendingPaymentSelection = peekPendingPayment(id);

  const submitNoShow = async (reason: string, evidenceFile?: File) => {
    if (!real) return;
    try {
      const evidencePaths = evidenceFile ? [await uploadCaseEvidence(real.id, evidenceFile)] : [];
      await reportNoShowMut.mutateAsync({ bookingId: real.id, reason, evidencePaths });
      setDialog("");
      toast.success(t("bookingDetail.caseSubmitted"));
    } catch (e: any) {
      toast.error(e?.message ?? t("common.somethingWentWrong"));
    }
  };

  const submitDispute = async (reason: string, description: string, evidenceFile?: File) => {
    if (!real) return;
    try {
      const evidencePaths = evidenceFile ? [await uploadCaseEvidence(real.id, evidenceFile)] : [];
      await openDispute.mutateAsync({ bookingId: real.id, reason, description, evidencePaths });
      setDialog("");
      toast.success(t("bookingDetail.caseSubmitted"));
    } catch (e: any) {
      toast.error(e?.message ?? t("common.somethingWentWrong"));
    }
  };

  const submitSupport = async (category: TicketCategory, subject: string, description: string) => {
    if (!real) return;
    try {
      await createTicket.mutateAsync({ bookingId: real.id, category, subject, description });
      setDialog("");
      toast.success(t("bookingDetail.caseSubmitted"));
    } catch (e: any) {
      toast.error(e?.message ?? t("common.somethingWentWrong"));
    }
  };

  const run = (
    nextStatus: string,
    extra?: { reason?: string; noShowParty?: "customer" | "provider" },
    onSuccess?: () => void,
  ) => {
    if (!real) return;
    updateStatus.mutate(
      { id: real.id, status: nextStatus as any, ...extra },
      {
        onSuccess,
        onError: (e: any) => toast.error(e?.message ?? t("common.somethingWentWrong")),
      },
    );
  };

  // Loading / error / not-found — the real database booking is the only
  // source of truth here. No fallback to another booking is ever shown.
  if (realQ.isLoading) {
    return (
      <PhoneFrame>
        <div className="flex-1 space-y-4 px-6 pt-10">
          <div className="mx-auto h-28 w-28 animate-pulse rounded-full bg-surface-2" />
          <div className="h-40 animate-pulse rounded-3xl bg-surface-2" />
          <div className="h-24 animate-pulse rounded-3xl bg-surface-2" />
        </div>
      </PhoneFrame>
    );
  }

  if (realQ.isError) {
    return (
      <PhoneFrame>
        <ErrorState onRetry={() => realQ.refetch()} />
      </PhoneFrame>
    );
  }

  if (!real) {
    return (
      <PhoneFrame>
        <EmptyState
          icon="search"
          title={t("bookingDetail.notFound")}
          body={t("bookingDetail.notFoundBody")}
          action={<Link to={previewPath("/home")} className="focus-ring tap-scale inline-flex items-center rounded-full bg-brand px-5 py-3 text-sm font-extrabold text-brand-foreground">{t("bookingDetail.backHome")}</Link>}
        />
      </PhoneFrame>
    );
  }

  const provider = toUIProvider(real.provider ?? {});
  provider.id = real.provider_id;
  provider.name = party?.other_name || provider.name || t("provider2.unnamed");
  provider.avatar = party?.other_avatar_url || provider.avatar;
  const startAt = new Date(real.start_at);
  const endAt = new Date(real.end_at);
  const durationH = Math.round((+endAt - +startAt) / 36e5);

  const booking = {
    id: real.id.slice(0, 8).toUpperCase(),
    service: ((lang === "ar" ? real.service?.name_ar : real.service?.name_en) || "") as string,
    date: formatDate(startAt, { weekday: "short", month: "short", day: "numeric" }),
    time: formatTime(startAt),
    duration: formatDuration(durationH),
    address: real.location
      ? [real.location.street, real.location.building, real.location.compound, real.location.city].filter(Boolean).join(", ")
      : t("bookingDetail.addressMissing"),
    total: formatEGP(Number(real.price_total ?? 0)),
  };

  const overview = (headline: string) => <>
    <CustomerPageHeader title={t("customerDetail.title")} backTo="/bookings" right={<button type="button" onClick={() => setDialog("support")} aria-label={t("bookingDetail.support")} className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/60"><LifeBuoy className="h-5 w-5" /></button>} />
    <div className="space-y-4 px-5 pt-4">
      <section className="rounded-2xl border border-border/60 bg-surface-2 p-4">
        <p className="text-pro-12 font-bold text-muted-foreground">{t(`status.${status}`, { defaultValue: t("customerDetail.unknownStatus") })}</p>
        <h2 className="mt-1 text-pro-18 font-bold">{headline}</h2>
        <p className="mt-2 text-pro-12 text-muted-foreground">{t("customerDetail.code", { id: booking.id })}</p>
      </section>
      <div className="flex items-center gap-3">
        <ProfileAvatar src={provider.avatar} name={provider.name} className="h-14 w-14 rounded-full text-pro-18" />
        <div className="min-w-0 flex-1"><p className="break-words text-pro-16 font-bold">{provider.name}</p><p className="mt-1 text-pro-13 text-muted-foreground">{booking.service}</p></div>
        {party?.other_phone && <a href={`tel:${party.other_phone}`} aria-label={t("providerProfile.call")} className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/60"><Phone className="h-5 w-5" /></a>}
        <a href="#booking-chat" className="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center text-pro-13 font-bold text-brand">{t("provider.message")}</a>
      </div>
      <section className="rounded-2xl border border-border/60 p-4">
        <h2 className="mb-3 text-pro-16 font-bold">{t("customerDetail.summary")}</h2>
        <div className="space-y-3 text-pro-14">
          <Line icon={<Calendar className="h-4 w-4" />} label={booking.date} />
          <Line icon={<Clock className="h-4 w-4" />} label={`${booking.time} · ${booking.duration}`} />
          <Line icon={<MapPin className="h-4 w-4" />} label={booking.address} />
        </div>
        <div className="mt-4 flex justify-between gap-3 border-t border-border/60 pt-3 text-pro-16 font-bold"><span>{t("customerDetail.total")}</span><span>{booking.total}</span></div>
      </section>
    </div>
  </>;

  // The real database status is the only thing that decides which screen
  // renders — there is no manual/local toggle a customer must press to see
  // an action that needs their response.
  const view: "closed" | "completed" | "tracking" | "upcoming" =
    status === "completed" ? "completed"
    : status === "cancelled" || status === "no_show" || status === "disputed" ? "closed"
    : status && TRACKABLE_STATUSES.includes(status) ? "tracking"
    : "upcoming";

  if (view === "closed") {
    const cancellation = cancellationQ.data;
    const expired = isProviderNoResponseCancellation(real);
    const reason = expired
      ? t("bookingDetail.expiredReason")
      : cancellation
      ? (lang === "ar" ? cancellation.reason_name_ar : cancellation.reason_name_en)
      : real.cancellation_reason || real.no_show_reason || real.dispute_reason;
    const title =
      expired ? t("bookingDetail.expiredTitle")
      : status === "cancelled" ? t("bookingDetail.closedCancelledTitle")
      : status === "no_show" ? t("bookingDetail.closedNoShowTitle")
      : t("bookingDetail.closedDisputedTitle");
    return (
      <PhoneFrame bg="bg-white">
        {overview(title)}
        <div className="flex-1 px-5 pt-4">
          <Card className="mt-4 p-4">
            {reason && (
              <div className="mt-4 rounded-2xl bg-surface-2 p-3">
                <div className="text-pro-12 font-bold uppercase tracking-wider text-muted-foreground">{t("bookingDetail.reasonLabel")}</div>
                <p className="mt-1 text-sm">{reason}</p>
                {cancellation?.note && <p className="mt-1 text-sm text-muted-foreground">{cancellation.note}</p>}
              </div>
            )}
            {cancellation && (
              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                <p>
                  {t("bookingDetail.cancelledBy")}: {t(`bookingDetail.cancelledByRole.${cancellation.cancelled_by_role}`)}
                </p>
                <p>
                  {t("bookingDetail.cancelledAt")}: {new Date(cancellation.cancelled_at).toLocaleString(locale)}
                </p>
              </div>
            )}
          </Card>

          <SupportCasesCard tickets={supportTicketsQ.data ?? []} dispute={dispute} noShowReport={noShowReport} t={t} />
          <button onClick={() => setDialog("support")} className="mt-2 flex min-h-11 w-full items-center justify-center gap-1.5 py-2 text-xs font-semibold text-muted-foreground">
            <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" /> {t("bookingDetail.openSupportTicket")}
          </button>

          <div id="booking-chat"><BookingChatPanel bookingId={real.id} status={status} viewer="customer" /></div>
        </div>
        <div className="safe-bottom px-6 pt-4">
          {expired ? (
            <PrimaryButton onClick={() => nav({ to: "/home" })}>{t("bookingDetail.bookAnotherProvider")}</PrimaryButton>
          ) : (
            <PrimaryButton onClick={() => nav({ to: "/home" })}>{t("bookingDetail.backHome")}</PrimaryButton>
          )}
        </div>

        <CaseDialog
          key={`support-closed-${dialog}`}
          open={dialog === "support"}
          title={t("bookingDetail.supportDialogTitle")}
          body={t("bookingDetail.supportDialogBody")}
          categoryOptions={SUPPORT_CATEGORIES.map((c) => ({ value: c, label: t(`bookingDetail.supportCategories.${c}`) }))}
          categoryLabel={t("bookingDetail.categoryLabel")}
          subjectLabel={t("bookingDetail.subjectLabel")}
          subjectPlaceholder={t("bookingDetail.subjectPlaceholder")}
          descriptionLabel={t("bookingDetail.descriptionLabel")}
          descriptionPlaceholder={t("bookingDetail.supportDescriptionPlaceholder")}
          confirmLabel={t("bookingDetail.confirmAction")}
          cancelLabel={t("bookingDetail.keep")}
          pending={createTicket.isPending}
          onCancel={() => setDialog("")}
          onConfirm={({ category, subject, description }) => submitSupport(category as TicketCategory, subject ?? "", description ?? "")}
        />
      </PhoneFrame>
    );
  }

  if (view === "completed") {
    const existingReview = reviewQ.data;
    return (
      <PhoneFrame bg="bg-white">
        {overview(t("bookingDetail.completedTitle"))}
        <div className="flex-1 px-5 pt-4">
          <Card className="mt-4 p-4">
            {existingReview ? (
              <>
                <div className="mt-5 flex justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} className={`h-9 w-9 ${n <= existingReview.rating ? "fill-warning text-warning" : "text-border"}`} />
                  ))}
                </div>
                {existingReview.comment && (
                  <p className="mt-4 rounded-2xl bg-surface-2 p-3 text-sm text-muted-foreground">{existingReview.comment}</p>
                )}
                <div className="mt-3 text-center text-xs font-semibold text-success">{t("bookingDetail.reviewSubmitted")}</div>
              </>
            ) : (
              <>
                <div className="mt-5 flex justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button className="focus-ring grid h-11 w-11 place-items-center" key={n} onClick={() => setRating(n)} aria-label={`${n}`}>
                      <Star className={`h-9 w-9 ${n <= rating ? "fill-warning text-warning" : "text-border"}`} />
                    </button>
                  ))}
                </div>
                <textarea
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={t("bookingDetail.reviewPlaceholder")}
                  className="mt-4 w-full resize-none rounded-2xl bg-surface-2 p-3 text-sm outline-none"
                />
                <PrimaryButton
                  className="mt-3 h-12 text-sm"
                  disabled={rating === 0 || submitReview.isPending}
                  onClick={() => submitReview.mutate({ bookingId: real.id, providerId: provider.id, rating, comment })}
                >
                  {t("bookingDetail.submitReview")}
                </PrimaryButton>
              </>
            )}
            <button
              onClick={() => toggleFav.mutate({ providerId: provider.id, on: !(favIdsQ.data ?? []).includes(provider.id) })}
              className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-extrabold text-brand"
            >
              <Star className="h-4 w-4" /> {(favIdsQ.data ?? []).includes(provider.id) ? t("bookingDetail.savedFavorite") : t("bookingDetail.saveFavorite")}
            </button>
          </Card>

          <SupportCasesCard tickets={supportTicketsQ.data ?? []} dispute={dispute} noShowReport={noShowReport} t={t} />
          <button onClick={() => setDialog("support")} className="mt-2 flex min-h-11 w-full items-center justify-center gap-1.5 py-2 text-xs font-semibold text-muted-foreground">
            <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" /> {t("bookingDetail.openSupportTicket")}
          </button>

          <div id="booking-chat"><BookingChatPanel bookingId={real.id} status={status} viewer="customer" /></div>
        </div>
        <div className="safe-bottom space-y-2 px-6 pt-4">
          <PrimaryButton onClick={() => nav({ to: "/home" })}>{t("bookingDetail.submitBookAgain")}</PrimaryButton>
        </div>

        <CaseDialog
          key={`support-completed-${dialog}`}
          open={dialog === "support"}
          title={t("bookingDetail.supportDialogTitle")}
          body={t("bookingDetail.supportDialogBody")}
          categoryOptions={SUPPORT_CATEGORIES.map((c) => ({ value: c, label: t(`bookingDetail.supportCategories.${c}`) }))}
          categoryLabel={t("bookingDetail.categoryLabel")}
          subjectLabel={t("bookingDetail.subjectLabel")}
          subjectPlaceholder={t("bookingDetail.subjectPlaceholder")}
          descriptionLabel={t("bookingDetail.descriptionLabel")}
          descriptionPlaceholder={t("bookingDetail.supportDescriptionPlaceholder")}
          confirmLabel={t("bookingDetail.confirmAction")}
          cancelLabel={t("bookingDetail.keep")}
          pending={createTicket.isPending}
          onCancel={() => setDialog("")}
          onConfirm={({ category, subject, description }) => submitSupport(category as TicketCategory, subject ?? "", description ?? "")}
        />
      </PhoneFrame>
    );
  }

  if (view === "tracking") {
    const headline =
      status === "arrived" ? t("bookingDetail.arrivedBody", { name: provider.name })
      : status === "arrival_confirmed" ? t("bookingDetail.arrivalConfirmedBody", { name: provider.name })
      : status === "in_progress" ? t("bookingDetail.inProgressBody", { name: provider.name })
      : status === "completion_requested" ? t("bookingDetail.completionRequestedBody", { name: provider.name })
      : t("bookingDetail.arrivingBody", { name: provider.name });

    return (
      <PhoneFrame bg="bg-white">
        {overview(headline)}

        <div className="flex-1 px-5 pb-8 pt-5">
          <Card className="p-4">
            <BookingTimeline status={status ?? "on_the_way"} labelFor={(step) => t(`bookingDetail.timeline.${step}`)} />
          </Card>

          <p className="mt-3 rounded-2xl bg-surface-2 px-4 py-3 text-center text-xs font-semibold text-muted-foreground">
            {t("bookingDetail.cancelNoLongerAvailable")}
          </p>

          {status === "on_the_way" && !noShowReport && (
            <button onClick={() => setDialog("no_show")} disabled={reportNoShowMut.isPending} className="mt-4 w-full rounded-full py-3 text-sm font-extrabold text-brand disabled:opacity-50">
              {t("bookingDetail.reportNoShow")}
            </button>
          )}

          {status === "arrived" && (
            <div className="mt-4 space-y-2">
              <PrimaryButton onClick={() => setDialog("confirmArrival")} disabled={updateStatus.isPending}>{t("bookingDetail.confirmArrival")}</PrimaryButton>
              {!noShowReport && (
                <button onClick={() => setDialog("no_show")} disabled={reportNoShowMut.isPending} className="min-h-11 w-full py-2 text-xs font-extrabold text-brand disabled:opacity-50">
                  {t("bookingDetail.reportNoShow")}
                </button>
              )}
            </div>
          )}

          {status === "arrival_confirmed" && (
            <div className="mt-4 rounded-2xl bg-surface-2 py-3 text-center text-sm font-semibold text-muted-foreground">
              {t("bookingDetail.arrivalConfirmedBody", { name: provider.name })}
            </div>
          )}

          {status === "completion_requested" && (
            <PrimaryButton className="mt-4" onClick={() => setDialog("confirmCompletion")} disabled={updateStatus.isPending}>{t("bookingDetail.confirmCompletion")}</PrimaryButton>
          )}

          {DISPUTE_ELIGIBLE_STATUSES.includes(status ?? "") && !dispute && (
            <button onClick={() => setDialog("dispute")} disabled={openDispute.isPending} className="mt-2 min-h-11 w-full py-2 text-xs font-extrabold text-brand disabled:opacity-50">
              {t("bookingDetail.disputeCompletion")}
            </button>
          )}
          <button onClick={() => setDialog("support")} className="mt-1 flex min-h-11 w-full items-center justify-center gap-1.5 py-2 text-xs font-semibold text-muted-foreground">
            <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" /> {t("bookingDetail.openSupportTicket")}
          </button>

          <SupportCasesCard tickets={supportTicketsQ.data ?? []} dispute={dispute} noShowReport={noShowReport} t={t} />

          <div id="booking-chat"><BookingChatPanel bookingId={real.id} status={status} viewer="customer" /></div>
        </div>

        <CaseDialog
          key={`no-show-${dialog}`}
          open={dialog === "no_show"}
          title={t("bookingDetail.noShowReasonTitle")}
          body={t("bookingDetail.noShowIrreversible")}
          reasonLabel={t("bookingDetail.reasonLabel")}
          reasonPlaceholder={t("bookingDetail.noShowReasonPlaceholder")}
          showEvidence
          evidenceLabel={t("bookingDetail.attachEvidence")}
          confirmLabel={t("bookingDetail.confirmAction")}
          cancelLabel={t("bookingDetail.keep")}
          pending={reportNoShowMut.isPending}
          onCancel={() => setDialog("")}
          onConfirm={({ reason, evidenceFile }) => submitNoShow(reason, evidenceFile)}
        />
        <ReasonDialog
          key={`confirm-arrival-${dialog}`}
          open={dialog === "confirmArrival"}
          title={t("bookingDetail.confirmArrivalTitle")}
          body={t("bookingDetail.confirmArrivalBody")}
          confirmLabel={t("bookingDetail.confirmAction")}
          cancelLabel={t("bookingDetail.keep")}
          requireReason={false}
          confirmVariant="coral"
          pending={updateStatus.isPending}
          onCancel={() => setDialog("")}
          onConfirm={() => run("arrival_confirmed", undefined, () => setDialog(""))}
        />
        <ReasonDialog
          key={`confirm-completion-${dialog}`}
          open={dialog === "confirmCompletion"}
          title={t("bookingDetail.completionRequestedTitle")}
          body={t("bookingDetail.completionRequestedBody", { name: provider.name })}
          confirmLabel={t("bookingDetail.confirmCompletion")}
          cancelLabel={t("bookingDetail.keep")}
          requireReason={false}
          confirmVariant="coral"
          pending={updateStatus.isPending}
          onCancel={() => setDialog("")}
          onConfirm={() => run("completed", undefined, () => setDialog(""))}
        />
        <CaseDialog
          key={`dispute-${dialog}`}
          open={dialog === "dispute"}
          title={t("bookingDetail.disputeReasonTitle")}
          body={t("bookingDetail.disputeIrreversible")}
          reasonLabel={t("bookingDetail.reasonLabel")}
          reasonPlaceholder={t("bookingDetail.disputeReasonPlaceholder")}
          descriptionLabel={t("bookingDetail.descriptionLabel")}
          descriptionPlaceholder={t("bookingDetail.disputeDescriptionPlaceholder")}
          showEvidence
          evidenceLabel={t("bookingDetail.attachEvidence")}
          confirmLabel={t("bookingDetail.confirmAction")}
          cancelLabel={t("bookingDetail.keep")}
          pending={openDispute.isPending}
          onCancel={() => setDialog("")}
          onConfirm={({ reason, description, evidenceFile }) => submitDispute(reason, description ?? "", evidenceFile)}
        />
        <CaseDialog
          key={`support-${dialog}`}
          open={dialog === "support"}
          title={t("bookingDetail.supportDialogTitle")}
          body={t("bookingDetail.supportDialogBody")}
          categoryOptions={SUPPORT_CATEGORIES.map((c) => ({ value: c, label: t(`bookingDetail.supportCategories.${c}`) }))}
          categoryLabel={t("bookingDetail.categoryLabel")}
          subjectLabel={t("bookingDetail.subjectLabel")}
          subjectPlaceholder={t("bookingDetail.subjectPlaceholder")}
          descriptionLabel={t("bookingDetail.descriptionLabel")}
          descriptionPlaceholder={t("bookingDetail.supportDescriptionPlaceholder")}
          confirmLabel={t("bookingDetail.confirmAction")}
          cancelLabel={t("bookingDetail.keep")}
          pending={createTicket.isPending}
          onCancel={() => setDialog("")}
          onConfirm={({ category, subject, description }) => submitSupport(category as TicketCategory, subject ?? "", description ?? "")}
        />
      </PhoneFrame>
    );
  }

  // view === "upcoming" (pending / confirmed) — nothing to track yet.
  const cancellable = status === "pending" || status === "confirmed";

  return (
    <PhoneFrame bg="bg-white">
      {overview(status === "pending" ? t("customerDetail.pending") : t("bookingDetail.allSet"))}
      <div className="flex-1 px-5 pt-4">
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Action
            icon={<Download className="h-4 w-4" />}
            label={t("bookingDetail.receipt")}
            onClick={() => downloadReceipt({ id: booking.id, provider: provider.name, service: booking.service, date: booking.date, time: booking.time, duration: booking.duration, address: booking.address, total: booking.total })}
          />
          <Action
            icon={<Calendar className="h-4 w-4" />}
            label={t("bookingDetail.addCalendar")}
            onClick={() => downloadIcs({ id: booking.id, title: `Famy – ${booking.service}`, description: `Provider: ${provider.name}`, location: booking.address, start: startAt, end: endAt })}
          />
          <Action
            icon={<HelpCircle className="h-4 w-4" />}
            label={t("bookingDetail.support")}
            onClick={() => nav({ to: "/help" })}
          />
        </div>

        <div className="mt-4">
          <PaymentBlock
            bookingId={real.id}
            viewer="customer"
            bookingStatus={status}
            authoritativePriceTotal={real.price_total != null ? Number(real.price_total) : null}
            pendingPaymentSelection={pendingPaymentSelection}
            paymobReturn={paymobReturn}
            autoStartPaymobCheckout={paymobCheckout}
          />
        </div>

        <RescheduleSection
          bookingId={real.id}
          viewer="customer"
          customerId={real.customer_id}
          status={status!}
          currentStart={real.start_at}
          currentEnd={real.end_at}
        />

        <div id="booking-chat"><BookingChatPanel bookingId={real.id} status={status} viewer="customer" /></div>

        <SupportCasesCard tickets={supportTicketsQ.data ?? []} dispute={dispute} noShowReport={noShowReport} t={t} />
        <button onClick={() => setDialog("support")} className="mt-2 flex min-h-11 w-full items-center justify-center gap-1.5 py-2 text-xs font-semibold text-muted-foreground">
          <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" /> {t("bookingDetail.openSupportTicket")}
        </button>

        <Card className="mt-4 p-5">
          <div className="mb-3 text-pro-12 font-extrabold uppercase tracking-wider text-muted-foreground">{t("bookingDetail.whatsNext")}</div>
          <ol className="space-y-3">
            <NextStep icon={<Bell className="h-4 w-4" />} title={t("bookingDetail.nextRemindTitle")} body={t("bookingDetail.nextRemindBody")} />
            <NextStep icon={<UserCheck className="h-4 w-4" />} title={t("bookingDetail.nextArriveTitle", { name: provider.name.split(" ")[0] })} body={t("bookingDetail.nextArriveBody")} />
            <NextStep icon={<Check className="h-4 w-4" />} title={t("bookingDetail.nextPayTitle")} body={t("bookingDetail.nextPayBody")} />
          </ol>
        </Card>

        <div className="mt-4 flex items-start gap-3 rounded-3xl bg-mint/25 p-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-surface text-success shadow-soft">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-extrabold">{t("bookingDetail.guaranteeTitle")}</div>
            <p className="text-pro-12 leading-relaxed text-muted-foreground">{t("bookingDetail.guaranteeBody")}</p>
          </div>
        </div>
      </div>

      <div className="safe-bottom space-y-2 px-6 pt-4">
        <div className="rounded-2xl bg-surface-2 py-3 text-center text-sm font-semibold text-muted-foreground">
          {t("bookingDetail.waitingForProvider")}
        </div>
        {cancellable && (
          <button onClick={() => setDialog("cancel")} disabled={cancelBooking.isPending} className="w-full py-3 text-center text-sm font-semibold text-destructive disabled:opacity-50">
            {t("bookingDetail.cancel")}
          </button>
        )}
        <Link to={previewPath("/home")} className="block py-3 text-center text-sm font-semibold text-muted-foreground">{t("bookingDetail.backHome")}</Link>
      </div>

      <CancelBookingDialog
        open={dialog === "cancel"}
        actorType="customer"
        bookingStatus={status}
        title={t("bookingDetail.cancelReasonTitle")}
        body={t("bookingDetail.cancelIrreversible")}
        reasonLabel={t("bookingDetail.cancelReasonLabel")}
        notePlaceholder={t("bookingDetail.cancelReasonPlaceholder")}
        confirmLabel={t("bookingDetail.confirmAction")}
        cancelLabel={t("bookingDetail.keep")}
        pending={cancelBooking.isPending}
        onCancel={() => setDialog("")}
        onConfirm={(reasonId, note) =>
          cancelBooking.mutate(
            { bookingId: real.id, reasonId, note },
            {
              onSuccess: () => setDialog(""),
              onError: (e: any) => toast.error(e?.message ?? t("common.somethingWentWrong")),
            },
          )
        }
      />

      <CaseDialog
        key={`support-upcoming-${dialog}`}
        open={dialog === "support"}
        title={t("bookingDetail.supportDialogTitle")}
        body={t("bookingDetail.supportDialogBody")}
        categoryOptions={SUPPORT_CATEGORIES.map((c) => ({ value: c, label: t(`bookingDetail.supportCategories.${c}`) }))}
        categoryLabel={t("bookingDetail.categoryLabel")}
        subjectLabel={t("bookingDetail.subjectLabel")}
        subjectPlaceholder={t("bookingDetail.subjectPlaceholder")}
        descriptionLabel={t("bookingDetail.descriptionLabel")}
        descriptionPlaceholder={t("bookingDetail.supportDescriptionPlaceholder")}
        confirmLabel={t("bookingDetail.confirmAction")}
        cancelLabel={t("bookingDetail.keep")}
        pending={createTicket.isPending}
        onCancel={() => setDialog("")}
        onConfirm={({ category, subject, description }) => submitSupport(category as TicketCategory, subject ?? "", description ?? "")}
      />
      <PushEnablePrompt open={pushPromptOpen} audience="customer" onOpenChange={setPushPromptOpen} />
    </PhoneFrame>
  );
}

function Line({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">{icon}</div>
      <span className="pt-1.5 font-medium">{label}</span>
    </div>
  );
}

function Action({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="focus-ring rounded-[1.25rem] border border-border/50 bg-surface-elevated p-3 text-center shadow-xs active:scale-95">
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-brand/8 text-brand">{icon}</div>
      <div className="mt-1.5 text-pro-12 font-extrabold">{label}</div>
    </button>
  );
}

function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadReceipt(b: { id: string; provider: string; service: string; date: string; time: string; duration: string; address: string; total: string | number }) {
  const lines = [
    "FAMY — Booking Receipt",
    "========================",
    `Booking ID: #${b.id}`,
    `Service:    ${b.service}`,
    `Provider:   ${b.provider}`,
    `Date:       ${b.date}`,
    `Time:       ${b.time} (${b.duration})`,
    `Address:    ${b.address}`,
    `Total:      ${b.total}`,
    "",
    "Thank you for booking with Famy.",
  ].join("\n");
  triggerDownload(`famy-receipt-${b.id}.txt`, lines, "text/plain;charset=utf-8");
}

function fmtIcsDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function downloadIcs(b: { id: string; title: string; description: string; location: string; start: Date | null; end: Date | null }) {
  const start = b.start ?? new Date();
  const end = b.end ?? new Date(start.getTime() + 60 * 60 * 1000);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Famy//Booking//EN",
    "BEGIN:VEVENT",
    `UID:${b.id}@famy.app`,
    `DTSTAMP:${fmtIcsDate(new Date())}`,
    `DTSTART:${fmtIcsDate(start)}`,
    `DTEND:${fmtIcsDate(end)}`,
    `SUMMARY:${b.title}`,
    `DESCRIPTION:${b.description}`,
    `LOCATION:${b.location}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  triggerDownload(`famy-booking-${b.id}.ics`, ics, "text/calendar;charset=utf-8");
}

function NextStep({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <li className="flex items-start gap-3">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand/8 text-brand">{icon}</div>
      <div className="min-w-0">
        <div className="text-sm font-bold">{title}</div>
        <div className="text-pro-12 text-muted-foreground">{body}</div>
      </div>
    </li>
  );
}
