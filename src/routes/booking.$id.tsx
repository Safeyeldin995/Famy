import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PhoneFrame, PrimaryButton, Card, Badge, BackButton, Avatar, BookingTimeline, ReasonDialog, CancelBookingDialog, CaseDialog, SupportCasesCard, ErrorState, EmptyState } from "@/components/famio/ui";
import { PaymentBlock } from "@/components/famio/PaymentBlock";
import { RescheduleSection } from "@/components/famio/RescheduleSection";
import { useBooking, useFavoriteIds, useToggleFavorite, useBookingReview, useSubmitReview, useUpdateBookingStatus } from "@/lib/db/queries";
import { useCancelBooking, useBookingCancellation } from "@/lib/db/cancellation-queries";
import {
  useBookingDisputes, useOpenDispute, activeDispute,
  useBookingNoShowReports, useReportNoShow, activeNoShowReport,
  useBookingSupportTickets, useCreateSupportTicket,
  uploadCaseEvidence, type TicketCategory,
} from "@/lib/db/case-queries";
import { toUIProvider } from "@/lib/db/adapters";
import { currentLang } from "@/lib/i18n";
import { formatEGP } from "@/lib/utils";
import { Check, MapPin, Calendar, Clock, Phone, Download, HelpCircle, AlertTriangle, Star, ShieldCheck, Bell, UserCheck, X, LifeBuoy } from "lucide-react";
import { BookingChatPanel } from "@/components/famio/BookingChatPanel";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";


export const Route = createFileRoute("/booking/$id")({
  component: BookingDetail,
});

const TRACKABLE_STATUSES = ["on_the_way", "arrived", "arrival_confirmed", "in_progress", "completion_requested"];
const DISPUTE_ELIGIBLE_STATUSES = ["on_the_way", "arrived", "arrival_confirmed", "in_progress", "completion_requested"];
const SUPPORT_CATEGORIES: TicketCategory[] = ["payment", "service_quality", "provider_behavior", "booking_issue", "app_issue", "other"];

type CustomerDialog = "" | "cancel" | "no_show" | "confirmArrival" | "confirmCompletion" | "dispute" | "support";

function BookingDetail() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const realQ = useBooking(id);
  const real = realQ.data;
  const status: string | undefined = real?.status;
  const lang = currentLang();
  const locale = lang === "ar" ? "ar-EG" : "en-US";
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

  const disputesQ = useBookingDisputes(id);
  const noShowReportsQ = useBookingNoShowReports(id);
  const supportTicketsQ = useBookingSupportTickets(id);
  const dispute = activeDispute(disputesQ.data);
  const noShowReport = activeNoShowReport(noShowReportsQ.data);
  const openDispute = useOpenDispute();
  const reportNoShowMut = useReportNoShow();
  const createTicket = useCreateSupportTicket();

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
          <div className="mx-auto h-28 w-28 animate-pulse rounded-full bg-surface" />
          <div className="h-40 animate-pulse rounded-3xl bg-surface" />
          <div className="h-24 animate-pulse rounded-3xl bg-surface" />
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
          emoji="🔍"
          title={t("bookingDetail.notFound")}
          body={t("bookingDetail.notFoundBody")}
          action={<Link to="/home" className="focus-ring inline-flex items-center rounded-2xl bg-navy px-4 py-3 text-sm font-bold text-navy-foreground">{t("bookingDetail.backHome")}</Link>}
        />
      </PhoneFrame>
    );
  }

  const provider = toUIProvider(real.provider);
  const startAt = new Date(real.start_at);
  const endAt = new Date(real.end_at);
  const durationH = Math.round((+endAt - +startAt) / 36e5);

  const booking = {
    id: real.id.slice(0, 8).toUpperCase(),
    service: ((lang === "ar" ? real.service?.name_ar : real.service?.name_en) || "") as string,
    date: startAt.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" }),
    time: startAt.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }),
    duration: `${durationH}h`,
    address: real.location
      ? [real.location.street, real.location.building, real.location.compound, real.location.city].filter(Boolean).join(", ")
      : t("bookingDetail.addressMissing"),
    total: formatEGP(Number(real.price_total ?? 0)),
  };

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
    const reason = cancellation
      ? (lang === "ar" ? cancellation.reason_name_ar : cancellation.reason_name_en)
      : real.cancellation_reason || real.no_show_reason || real.dispute_reason;
    const title =
      status === "cancelled" ? t("bookingDetail.closedCancelledTitle")
      : status === "no_show" ? t("bookingDetail.closedNoShowTitle")
      : t("bookingDetail.closedDisputedTitle");
    return (
      <PhoneFrame>
        <div className="safe-top flex-1 px-6 pt-10">
          <div className="text-center">
            <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-muted">
              <div className="grid h-16 w-16 place-items-center rounded-full bg-surface text-muted-foreground"><X className="h-8 w-8" /></div>
            </div>
            <h1 className="mt-5 text-2xl font-extrabold">{title}</h1>
            {status === "disputed" && <p className="mt-1 text-sm text-muted-foreground">{t("bookingDetail.closedDisputedBody")}</p>}
          </div>

          <Card className="mt-8 p-5">
            <div className="flex items-center gap-3 border-b border-border pb-4">
              <Avatar src={provider.avatar} className="h-14 w-14 rounded-2xl" />
              <div className="min-w-0 flex-1">
                <div className="font-bold">{provider.name}</div>
                <div className="text-xs text-muted-foreground">{booking.service}</div>
              </div>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <Line icon={<Calendar className="h-4 w-4" />} label={booking.date} />
              <Line icon={<Clock className="h-4 w-4" />} label={`${booking.time} · ${booking.duration}`} />
              <Line icon={<MapPin className="h-4 w-4" />} label={booking.address} />
            </div>
            {reason && (
              <div className="mt-4 rounded-2xl bg-surface-2 p-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t("bookingDetail.reasonLabel")}</div>
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
          <button onClick={() => setDialog("support")} className="mt-2 flex w-full items-center justify-center gap-1.5 py-2 text-xs font-semibold text-muted-foreground">
            <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" /> {t("bookingDetail.openSupportTicket")}
          </button>

          <BookingChatPanel bookingId={real.id} status={status} viewer="customer" />
        </div>
        <div className="safe-bottom px-6 pt-4">
          <PrimaryButton onClick={() => nav({ to: "/home" })}>{t("bookingDetail.backHome")}</PrimaryButton>
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
      <PhoneFrame>
        <div className="safe-top flex-1 px-6 pt-10">
          <div className="text-center">
            <div className="animate-pop mx-auto grid h-24 w-24 place-items-center rounded-full bg-mint/40">
              <div className="grid h-16 w-16 place-items-center rounded-full bg-success text-white"><Check className="h-8 w-8" /></div>
            </div>
            <h1 className="mt-5 text-2xl font-extrabold">{t("bookingDetail.completedTitle")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("bookingDetail.howWasIt", { name: provider.name })}</p>
          </div>

          <Card className="mt-8 p-5">
            <div className="flex items-center gap-3 border-b border-border pb-4">
              <Avatar src={provider.avatar} className="h-14 w-14 rounded-2xl" />
              <div className="min-w-0 flex-1">
                <div className="font-bold">{provider.name}</div>
                <div className="text-xs text-muted-foreground">{booking.service}</div>
              </div>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <Line icon={<Calendar className="h-4 w-4" />} label={booking.date} />
              <Line icon={<Clock className="h-4 w-4" />} label={`${booking.time} · ${booking.duration}`} />
              <Line icon={<MapPin className="h-4 w-4" />} label={booking.address} />
            </div>

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
                    <button key={n} onClick={() => setRating(n)} aria-label={`${n}`}>
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
              className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-coral"
            >
              <Star className="h-4 w-4" /> {(favIdsQ.data ?? []).includes(provider.id) ? t("bookingDetail.savedFavorite") : t("bookingDetail.saveFavorite")}
            </button>
          </Card>

          <SupportCasesCard tickets={supportTicketsQ.data ?? []} dispute={dispute} noShowReport={noShowReport} t={t} />
          <button onClick={() => setDialog("support")} className="mt-2 flex w-full items-center justify-center gap-1.5 py-2 text-xs font-semibold text-muted-foreground">
            <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" /> {t("bookingDetail.openSupportTicket")}
          </button>

          <BookingChatPanel bookingId={real.id} status={status} viewer="customer" />
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
      <PhoneFrame>
        <div className="relative h-64 w-full overflow-hidden bg-navy">
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-60"
            style={{
              backgroundImage:
                "linear-gradient(135deg, hsl(var(--navy)) 0%, hsl(var(--navy) / 0.7) 60%, hsl(var(--mint) / 0.4) 100%), repeating-linear-gradient(45deg, transparent 0 22px, rgba(255,255,255,0.06) 22px 23px), repeating-linear-gradient(-45deg, transparent 0 22px, rgba(255,255,255,0.06) 22px 23px)",
            }}
          />
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 600 400" preserveAspectRatio="none" aria-hidden="true">
            <path d="M60 340 Q 200 260 300 240 T 540 80" fill="none" stroke="hsl(var(--coral))" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 14" opacity="0.9" />
            <circle cx="60" cy="340" r="9" fill="hsl(var(--surface))" stroke="hsl(var(--navy))" strokeWidth="3" />
            <circle cx="540" cy="80" r="10" fill="hsl(var(--coral))" />
          </svg>
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-surface-2" />
          <div className="safe-top absolute inset-x-0 top-0 flex items-center justify-between px-5 py-3">
            <BackButton back={() => nav({ to: "/bookings" })} />
            <button
              aria-label={t("bookingDetail.emergency")}
              className="focus-ring grid h-11 w-11 place-items-center rounded-full bg-coral text-coral-foreground shadow-card active:scale-95 transition-transform"
            >
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="-mt-10 flex-1 rounded-t-3xl bg-surface px-5 pb-8 pt-5">
          <Badge tone="mint"><span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> {t(`status.${status}`, { defaultValue: status })}</Badge>
          <div className="mt-2 text-2xl font-extrabold">{t("bookingDetail.inProgress", "Service in progress")}</div>
          <p className="text-sm text-muted-foreground">{headline}</p>

          <Card className="mt-5 p-4">
            <div className="flex items-center gap-3">
              <Avatar src={provider.avatar} className="h-14 w-14 rounded-2xl" />
              <div className="min-w-0 flex-1">
                <div className="font-bold">{provider.name}</div>
                <div className="text-xs text-muted-foreground">★ {provider.rating} · {provider.role}</div>
              </div>
              <div className="flex gap-2">
                <button
                  aria-label={`${t("providerProfile.call")} ${provider.name}`}
                  className="focus-ring grid h-11 w-11 place-items-center rounded-full bg-coral text-coral-foreground active:scale-95 transition-transform"
                >
                  <Phone className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </Card>

          <Card className="mt-3 p-4">
            <BookingTimeline status={status ?? "on_the_way"} labelFor={(step) => t(`bookingDetail.timeline.${step}`)} />
          </Card>

          <p className="mt-3 rounded-2xl bg-surface-2 px-4 py-3 text-center text-xs font-semibold text-muted-foreground">
            {t("bookingDetail.cancelNoLongerAvailable")}
          </p>

          {status === "on_the_way" && !noShowReport && (
            <button onClick={() => setDialog("no_show")} disabled={reportNoShowMut.isPending} className="mt-4 w-full rounded-2xl py-3 text-sm font-semibold text-coral disabled:opacity-50">
              {t("bookingDetail.reportNoShow")}
            </button>
          )}

          {status === "arrived" && (
            <div className="mt-4 space-y-2">
              <PrimaryButton onClick={() => setDialog("confirmArrival")} disabled={updateStatus.isPending}>{t("bookingDetail.confirmArrival")}</PrimaryButton>
              {!noShowReport && (
                <button onClick={() => setDialog("no_show")} disabled={reportNoShowMut.isPending} className="w-full py-2 text-xs font-semibold text-coral disabled:opacity-50">
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
            <button onClick={() => setDialog("dispute")} disabled={openDispute.isPending} className="mt-2 w-full py-2 text-xs font-semibold text-coral disabled:opacity-50">
              {t("bookingDetail.disputeCompletion")}
            </button>
          )}
          <button onClick={() => setDialog("support")} className="mt-1 flex w-full items-center justify-center gap-1.5 py-2 text-xs font-semibold text-muted-foreground">
            <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" /> {t("bookingDetail.openSupportTicket")}
          </button>

          <SupportCasesCard tickets={supportTicketsQ.data ?? []} dispute={dispute} noShowReport={noShowReport} t={t} />

          <BookingChatPanel bookingId={real.id} status={status} viewer="customer" />
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
          confirmVariant="navy"
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
          confirmVariant="navy"
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
    <PhoneFrame>
      <div className="safe-top flex-1 px-6 pt-10">
        <div className="text-center">
          <div className="animate-pop mx-auto grid h-28 w-28 place-items-center rounded-full bg-coral/15">
            <div className="grid h-20 w-20 place-items-center rounded-full bg-coral text-coral-foreground shadow-card">
              <Check className="h-10 w-10" strokeWidth={3} />
            </div>
          </div>
          <h1 className="mt-6 text-2xl font-extrabold">{t("bookingDetail.allSet")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("bookingDetail.confirmedNumber", { id: booking.id })}</p>
        </div>

        <Card className="mt-8 p-5">
          <div className="flex items-center gap-3 border-b border-border pb-4">
            <Avatar src={provider.avatar} alt={provider.name} className="h-14 w-14 rounded-2xl" />
            <div className="min-w-0 flex-1">
              <div className="text-base font-bold">{provider.name}</div>
              <div className="text-xs text-muted-foreground">{booking.service}</div>
            </div>
            <Badge tone="navy">{provider.role}</Badge>
          </div>
          <div className="mt-4 space-y-3 text-sm">
            <Line icon={<Calendar className="h-4 w-4" />} label={booking.date} />
            <Line icon={<Clock className="h-4 w-4" />} label={`${booking.time} · ${booking.duration}`} />
            <Line icon={<MapPin className="h-4 w-4" />} label={booking.address} />
          </div>
        </Card>

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
          <PaymentBlock bookingId={real.id} viewer="customer" bookingStatus={status} />
        </div>

        <RescheduleSection
          bookingId={real.id}
          viewer="customer"
          customerId={real.customer_id}
          status={status!}
          currentStart={real.start_at}
          currentEnd={real.end_at}
        />

        <BookingChatPanel bookingId={real.id} status={status} viewer="customer" />

        <SupportCasesCard tickets={supportTicketsQ.data ?? []} dispute={dispute} noShowReport={noShowReport} t={t} />
        <button onClick={() => setDialog("support")} className="mt-2 flex w-full items-center justify-center gap-1.5 py-2 text-xs font-semibold text-muted-foreground">
          <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" /> {t("bookingDetail.openSupportTicket")}
        </button>

        <Card className="mt-4 p-5">
          <div className="mb-3 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{t("bookingDetail.whatsNext")}</div>
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
            <p className="text-[11px] leading-relaxed text-muted-foreground">{t("bookingDetail.guaranteeBody")}</p>
          </div>
        </div>
      </div>

      <div className="safe-bottom space-y-2 px-6 pt-4">
        <div className="rounded-2xl bg-surface-2 py-3 text-center text-sm font-semibold text-muted-foreground">
          {t("bookingDetail.waitingForProvider", "Tracking will be available once your provider is on the way.")}
        </div>
        {cancellable && (
          <button onClick={() => setDialog("cancel")} disabled={cancelBooking.isPending} className="w-full py-3 text-center text-sm font-semibold text-destructive disabled:opacity-50">
            {t("bookingDetail.cancel")}
          </button>
        )}
        <Link to="/home" className="block py-3 text-center text-sm font-semibold text-muted-foreground">{t("bookingDetail.backHome")}</Link>
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
    </PhoneFrame>
  );
}

function Line({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-navy/10 text-navy">{icon}</div>
      <span className="pt-1.5 font-medium">{label}</span>
    </div>
  );
}

function Action({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="rounded-2xl bg-surface p-3 text-center shadow-soft active:scale-95">
      <div className="mx-auto grid h-9 w-9 place-items-center rounded-xl bg-navy/10 text-navy">{icon}</div>
      <div className="mt-1.5 text-[11px] font-semibold">{label}</div>
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
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-navy/10 text-navy">{icon}</div>
      <div className="min-w-0">
        <div className="text-sm font-bold">{title}</div>
        <div className="text-[11px] text-muted-foreground">{body}</div>
      </div>
    </li>
  );
}
