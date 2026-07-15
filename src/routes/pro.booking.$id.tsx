import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { TopBar, Card, Badge, PrimaryButton, ErrorState, BookingTimeline, ReasonDialog, CancelBookingDialog, CaseDialog, SupportCasesCard } from "@/components/famio/ui";
import { PaymentBlock } from "@/components/famio/PaymentBlock";
import { RescheduleSection } from "@/components/famio/RescheduleSection";
import { BookingChatPanel } from "@/components/famio/BookingChatPanel";
import { useLang } from "@/components/famio/LanguageToggle";
import { useProviderBooking, useProviderUpdateBookingStatus } from "@/lib/db/provider-queries";
import { useCancelBooking, useBookingCancellation } from "@/lib/db/cancellation-queries";
import {
  useBookingDisputes, useOpenDispute, activeDispute,
  useBookingNoShowReports, useReportNoShow, activeNoShowReport,
  useBookingSupportTickets, useCreateSupportTicket,
  uploadCaseEvidence, type TicketCategory,
} from "@/lib/db/case-queries";
import { bookingStatusTone, formatEGP, BOOKING_TIMELINE_STEPS } from "@/lib/utils";
import { Calendar, Clock, MapPin, Phone, User as UserIcon, HeartPulse, AlertTriangle, LifeBuoy } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/pro/booking/$id")({ component: ProBookingDetail });

const DISPUTE_ELIGIBLE_STATUSES = ["on_the_way", "arrived", "arrival_confirmed", "in_progress", "completion_requested"];
const SUPPORT_CATEGORIES: TicketCategory[] = ["payment", "service_quality", "provider_behavior", "booking_issue", "app_issue", "other"];

type DialogKind = "" | "decline" | "cancel" | "no_show" | "dispute" | "support";

function ProBookingDetail() {
  const { t } = useTranslation();
  const lang = useLang();
  const dateLoc = lang === "ar" ? "ar-EG" : "en-US";
  const { id } = Route.useParams();
  const nav = useNavigate();
  const q = useProviderBooking(id);
  const mut = useProviderUpdateBookingStatus();
  const cancelBooking = useCancelBooking();
  const cancellationQ = useBookingCancellation(q.data?.status === "cancelled" ? id : undefined);
  const [dialog, setDialog] = useState<DialogKind>("");

  const disputesQ = useBookingDisputes(id);
  const noShowReportsQ = useBookingNoShowReports(id);
  const supportTicketsQ = useBookingSupportTickets(id);
  const dispute = activeDispute(disputesQ.data);
  const noShowReport = activeNoShowReport(noShowReportsQ.data);
  const openDispute = useOpenDispute();
  const reportNoShowMut = useReportNoShow();
  const createTicket = useCreateSupportTicket();

  const submitNoShow = async (reason: string, evidenceFile?: File) => {
    try {
      const evidencePaths = evidenceFile ? [await uploadCaseEvidence(id, evidenceFile)] : [];
      await reportNoShowMut.mutateAsync({ bookingId: id, reason, evidencePaths });
      setDialog("");
      toast.success(t("pro.booking.caseSubmitted"));
    } catch (e: any) {
      toast.error(e?.message ?? t("common.somethingWentWrong"));
    }
  };

  const submitDispute = async (reason: string, description: string, evidenceFile?: File) => {
    try {
      const evidencePaths = evidenceFile ? [await uploadCaseEvidence(id, evidenceFile)] : [];
      await openDispute.mutateAsync({ bookingId: id, reason, description, evidencePaths });
      setDialog("");
      toast.success(t("pro.booking.caseSubmitted"));
    } catch (e: any) {
      toast.error(e?.message ?? t("common.somethingWentWrong"));
    }
  };

  const submitSupport = async (category: TicketCategory, subject: string, description: string) => {
    try {
      await createTicket.mutateAsync({ bookingId: id, category, subject, description });
      setDialog("");
      toast.success(t("pro.booking.caseSubmitted"));
    } catch (e: any) {
      toast.error(e?.message ?? t("common.somethingWentWrong"));
    }
  };

  if (q.isLoading) return <ProviderShell hideNav><TopBar back={{ to: "/pro/bookings" }} /><div className="h-64 animate-pulse rounded-3xl bg-surface mx-5" /></ProviderShell>;
  if (q.isError || !q.data) return <ProviderShell hideNav><TopBar back={{ to: "/pro/bookings" }} /><ErrorState title={t("pro.booking.notFound")} /></ProviderShell>;

  const b = q.data as any;
  const start = new Date(b.start_at);
  const end = new Date(b.end_at);
  const hours = Math.max(1, Math.round((+end - +start) / 36e5));
  const name = b.customer?.full_name || t("pro.common.customer");
  const addr = b.location;
  const addrLine = addr ? [addr.street, addr.building, addr.compound, addr.city].filter(Boolean).join(", ") : t("pro.booking.addressMissing");
  const serviceName = lang === "ar" ? (b.service?.name_ar ?? b.service?.name_en) : (b.service?.name_en ?? b.service?.name_ar);
  const onTimeline = (BOOKING_TIMELINE_STEPS as readonly string[]).includes(b.status);
  const terminal = ["completed", "cancelled", "no_show", "disputed"].includes(b.status);

  const run = (
    status: string,
    extra?: { reason?: string; noShowParty?: "customer" | "provider" },
    onSuccess?: () => void,
  ) => {
    mut.mutate(
      { id, status, ...extra },
      {
        onSuccess,
        onError: (e: any) => toast.error(e?.message ?? t("common.somethingWentWrong")),
      },
    );
  };

  return (
    <ProviderShell hideNav>
      <TopBar back={{ to: "/pro/bookings" }} title={t("pro.booking.title")} />
      <div className="space-y-4 px-5 pb-32">
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <img src={b.customer?.avatar_url || `https://i.pravatar.cc/200?u=${b.customer_id}`} alt={name} className="h-16 w-16 rounded-2xl object-cover" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><div className="truncate text-base font-extrabold">{name}</div><Badge tone={bookingStatusTone(b.status)}>{String(t(`pro.statuses.${b.status}`, { defaultValue: b.status }))}</Badge></div>
              <div className="mt-1 text-xs text-muted-foreground">{t("pro.booking.bookingNumber", { id: b.id.slice(0, 8).toUpperCase() })}</div>
            </div>
          </div>
        </Card>

        {onTimeline && (
          <Card className="p-4">
            <BookingTimeline status={b.status} labelFor={(step) => t(`pro.booking.timeline.${step}`)} />
          </Card>
        )}

        {terminal && b.status !== "completed" && (
          <Card className="space-y-1 p-4">
            <div className="text-sm font-bold">
              {b.status === "disputed" ? t("pro.booking.disputedNotice") : String(t(`pro.statuses.${b.status}`, { defaultValue: b.status }))}
            </div>
            {b.status === "cancelled" && cancellationQ.data ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {lang === "ar" ? cancellationQ.data.reason_name_ar : cancellationQ.data.reason_name_en}
                </p>
                {cancellationQ.data.note && <p className="text-xs text-muted-foreground">{cancellationQ.data.note}</p>}
                <p className="text-[11px] text-muted-foreground">
                  {t("pro.booking.cancelledBy")}: {t(`pro.booking.cancelledByRole.${cancellationQ.data.cancelled_by_role}`)} · {new Date(cancellationQ.data.cancelled_at).toLocaleString(dateLoc)}
                </p>
              </>
            ) : (
              (b.cancellation_reason || b.no_show_reason || b.dispute_reason) && (
                <p className="text-xs text-muted-foreground">{b.cancellation_reason || b.no_show_reason || b.dispute_reason}</p>
              )
            )}
          </Card>
        )}

        <Card className="space-y-3 p-4">
          <Row icon={<UserIcon className="h-4 w-4" />} label={t("pro.booking.service")} value={serviceName ?? "—"} />
          <Row icon={<Calendar className="h-4 w-4" />} label={t("pro.booking.date")} value={start.toLocaleDateString(dateLoc, { weekday: "long", month: "short", day: "numeric", year: "numeric" })} />
          <Row icon={<Clock className="h-4 w-4" />} label={t("pro.booking.time")} value={`${start.toLocaleTimeString(dateLoc, { hour: "numeric", minute: "2-digit" })} · ${hours}h`} />
          <Row icon={<MapPin className="h-4 w-4" />} label={t("pro.booking.address")} value={addrLine} />
          {b.customer?.phone && <Row icon={<Phone className="h-4 w-4" />} label={t("pro.booking.phone")} value={<a href={`tel:${b.customer.phone}`} className="font-bold text-navy" dir="ltr">{b.customer.phone}</a>} />}
        </Card>

        {b.family_member && (
          <Card className="space-y-3 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("pro.booking.forWhom", "Service is for")}</div>
            <Row
              icon={<UserIcon className="h-4 w-4" />}
              label={b.family_member.full_name}
              value={
                b.family_member.relationship === "self"
                  ? t("pro.booking.forWhomMyself", "The customer")
                  : b.family_member.relationship === "other"
                    ? (b.family_member.relationship_other || t("familyMembers.relationships.other"))
                    : t(`familyMembers.relationships.${b.family_member.relationship}`)
              }
            />
            {b.family_member.allergies && (
              <Row icon={<HeartPulse className="h-4 w-4" />} label={t("pro.booking.allergies", "Allergies")} value={b.family_member.allergies} />
            )}
            {b.family_member.medical_notes && (
              <Row icon={<HeartPulse className="h-4 w-4" />} label={t("pro.booking.medicalNotes", "Medical notes")} value={b.family_member.medical_notes} />
            )}
            {b.family_member.access_notes && (
              <Row icon={<AlertTriangle className="h-4 w-4" />} label={t("pro.booking.accessNotes", "Access notes")} value={b.family_member.access_notes} />
            )}
            {b.family_member.emergency_contact_name && (
              <Row
                icon={<Phone className="h-4 w-4" />}
                label={t("pro.booking.emergencyContact", "Emergency contact")}
                value={
                  b.family_member.emergency_contact_phone
                    ? <a href={`tel:${b.family_member.emergency_contact_phone}`} className="font-bold text-navy" dir="ltr">{b.family_member.emergency_contact_name} · {b.family_member.emergency_contact_phone}</a>
                    : b.family_member.emergency_contact_name
                }
              />
            )}
          </Card>
        )}

        {b.notes && (
          <Card className="p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("pro.booking.customerNotes")}</div>
            <div className="mt-1 text-sm whitespace-pre-wrap">{b.notes}</div>
          </Card>
        )}

        {Array.isArray(b.requirement_choices) && b.requirement_choices.length > 0 && (
          <Card className="space-y-1.5 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("pro.booking.requirements", "Requirements")}</div>
            {b.requirement_choices.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between text-sm">
                <span>{lang === "ar" ? r.name_ar : r.name_en}</span>
                <span className="text-xs font-semibold text-muted-foreground">
                  {r.chosen_by === "provider" ? t("pro.booking.reqYouProvide", "You provide — {{fee}}", { fee: formatEGP(Number(r.extra_fee)) }) : t("pro.booking.reqCustomerProvides", "Customer provides")}
                </span>
              </div>
            ))}
          </Card>
        )}

        <RescheduleSection
          bookingId={b.id}
          viewer="provider"
          customerId={b.customer_id}
          status={b.status}
          currentStart={b.start_at}
          currentEnd={b.end_at}
        />

        <Card className="space-y-2 p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("pro.booking.payment")}</div>
          <div className="flex items-center justify-between"><span className="text-sm">{t("pro.booking.subtotal")}</span><span>{formatEGP(Number(b.price_subtotal ?? 0))}</span></div>
          {Number(b.price_discount ?? 0) > 0 && <div className="flex items-center justify-between text-coral"><span className="text-sm">{t("pro.booking.discount")}</span><span>−{formatEGP(Number(b.price_discount))}</span></div>}
          <div className="flex items-center justify-between border-t border-border pt-2"><span className="text-sm font-bold">{t("pro.booking.total")}</span><span className="text-base font-extrabold text-navy">{formatEGP(Number(b.price_total ?? 0))}</span></div>
        </Card>

        <PaymentBlock bookingId={b.id} viewer="provider" bookingStatus={b.status} />

        <BookingChatPanel bookingId={b.id} status={b.status} viewer="provider" />

        <SupportCasesCard tickets={supportTicketsQ.data ?? []} dispute={dispute} noShowReport={noShowReport} t={t} />
        <button onClick={() => setDialog("support")} className="mt-2 flex w-full items-center justify-center gap-1.5 py-2 text-xs font-semibold text-muted-foreground">
          <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" /> {t("pro.booking.openSupportTicket")}
        </button>

      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-surface-2 via-surface-2/90 to-transparent pt-6 safe-bottom">
        <div className="mx-auto max-w-md px-5 pb-3">
          {b.status === "pending" && (
            <div className="flex gap-2">
              <button onClick={() => setDialog("decline")} disabled={mut.isPending || cancelBooking.isPending} className="focus-ring h-14 flex-1 rounded-2xl border border-coral bg-surface text-sm font-bold text-coral active:scale-[0.98] disabled:opacity-50">{t("pro.booking.decline")}</button>
              <button onClick={() => run("confirmed")} disabled={mut.isPending} className="focus-ring h-14 flex-1 rounded-2xl bg-navy text-sm font-bold text-navy-foreground shadow-card active:scale-[0.98] disabled:opacity-50">{t("pro.booking.accept")}</button>
            </div>
          )}

          {b.status === "confirmed" && (
            <div className="space-y-2">
              <PrimaryButton onClick={() => run("on_the_way")} disabled={mut.isPending}>{t("pro.booking.onTheWay")}</PrimaryButton>
              <button onClick={() => setDialog("cancel")} disabled={mut.isPending || cancelBooking.isPending} className="w-full py-2 text-xs font-semibold text-muted-foreground disabled:opacity-50">{t("pro.booking.cancelJob")}</button>
            </div>
          )}

          {["on_the_way", "arrived", "arrival_confirmed", "in_progress", "completion_requested"].includes(b.status) && (
            <p className="mb-2 rounded-2xl bg-surface-2 px-4 py-3 text-center text-xs font-semibold text-muted-foreground">
              {t("pro.booking.cancelNoLongerAvailable")}
            </p>
          )}

          {b.status === "on_the_way" && (
            <div className="space-y-2">
              <PrimaryButton onClick={() => run("arrived")} disabled={mut.isPending}>{t("pro.booking.iHaveArrived")}</PrimaryButton>
              {!noShowReport && (
                <button onClick={() => setDialog("no_show")} disabled={reportNoShowMut.isPending} className="w-full py-2 text-xs font-semibold text-coral disabled:opacity-50">{t("pro.booking.reportNoShow")}</button>
              )}
            </div>
          )}

          {b.status === "arrived" && (
            <div className="space-y-2">
              <div className="rounded-2xl bg-surface-2 py-3 text-center text-sm font-semibold text-muted-foreground">{t("pro.booking.waitingArrivalConfirm")}</div>
              {!noShowReport && (
                <button onClick={() => setDialog("no_show")} disabled={reportNoShowMut.isPending} className="w-full py-2 text-xs font-semibold text-coral disabled:opacity-50">{t("pro.booking.reportNoShow")}</button>
              )}
            </div>
          )}

          {b.status === "arrival_confirmed" && (
            <PrimaryButton onClick={() => run("in_progress")} disabled={mut.isPending}>{t("pro.booking.startService")}</PrimaryButton>
          )}

          {b.status === "in_progress" && (
            <PrimaryButton onClick={() => run("completion_requested")} disabled={mut.isPending} variant="coral">{t("pro.booking.requestCompletion")}</PrimaryButton>
          )}

          {DISPUTE_ELIGIBLE_STATUSES.includes(b.status) && !dispute && (
            <button onClick={() => setDialog("dispute")} disabled={openDispute.isPending} className="mt-2 w-full py-2 text-xs font-semibold text-coral disabled:opacity-50">
              {t("pro.booking.disputeAction")}
            </button>
          )}

          {b.status === "completion_requested" && (
            <div className="rounded-2xl bg-surface-2 py-3 text-center text-sm font-semibold text-muted-foreground">{t("pro.booking.waitingCompletionConfirm")}</div>
          )}

          {terminal && (
            <button onClick={() => nav({ to: "/pro/bookings" })} className="focus-ring h-14 w-full rounded-2xl border border-border bg-surface text-sm font-bold">{t("pro.booking.backToJobs")}</button>
          )}
        </div>
      </div>

      <CancelBookingDialog
        open={dialog === "decline" || dialog === "cancel"}
        actorType="provider"
        bookingStatus={b.status}
        title={dialog === "decline" ? t("pro.booking.declineConfirm") : t("pro.booking.cancelConfirm")}
        body={t("pro.booking.irreversible")}
        reasonLabel={t("pro.booking.reasonLabel")}
        notePlaceholder={t("pro.booking.reasonPlaceholder")}
        confirmLabel={t("pro.booking.confirm")}
        cancelLabel={t("pro.booking.keep")}
        pending={cancelBooking.isPending}
        onCancel={() => setDialog("")}
        onConfirm={(reasonId, note) =>
          cancelBooking.mutate(
            { bookingId: b.id, reasonId, note },
            {
              onSuccess: () => setDialog(""),
              onError: (e: any) => toast.error(e?.message ?? t("common.somethingWentWrong")),
            },
          )
        }
      />

      <CaseDialog
        key={`no-show-${dialog}`}
        open={dialog === "no_show"}
        title={t("pro.booking.noShowConfirmTitle")}
        body={t("pro.booking.irreversible")}
        reasonLabel={t("pro.booking.reasonLabel")}
        reasonPlaceholder={t("pro.booking.reasonPlaceholder")}
        showEvidence
        evidenceLabel={t("pro.booking.attachEvidence")}
        confirmLabel={t("pro.booking.confirm")}
        cancelLabel={t("pro.booking.keep")}
        pending={reportNoShowMut.isPending}
        onCancel={() => setDialog("")}
        onConfirm={({ reason, evidenceFile }) => submitNoShow(reason, evidenceFile)}
      />
      <CaseDialog
        key={`dispute-${dialog}`}
        open={dialog === "dispute"}
        title={t("pro.booking.disputeReasonTitle")}
        body={t("pro.booking.disputeIrreversible")}
        reasonLabel={t("pro.booking.reasonLabel")}
        reasonPlaceholder={t("pro.booking.reasonPlaceholder")}
        descriptionLabel={t("pro.booking.descriptionLabel")}
        descriptionPlaceholder={t("pro.booking.disputeDescriptionPlaceholder")}
        showEvidence
        evidenceLabel={t("pro.booking.attachEvidence")}
        confirmLabel={t("pro.booking.confirm")}
        cancelLabel={t("pro.booking.keep")}
        pending={openDispute.isPending}
        onCancel={() => setDialog("")}
        onConfirm={({ reason, description, evidenceFile }) => submitDispute(reason, description ?? "", evidenceFile)}
      />
      <CaseDialog
        key={`support-${dialog}`}
        open={dialog === "support"}
        title={t("pro.booking.supportDialogTitle")}
        body={t("pro.booking.supportDialogBody")}
        categoryOptions={SUPPORT_CATEGORIES.map((c) => ({ value: c, label: t(`pro.booking.supportCategories.${c}`) }))}
        categoryLabel={t("pro.booking.categoryLabel")}
        subjectLabel={t("pro.booking.subjectLabel")}
        subjectPlaceholder={t("pro.booking.subjectPlaceholder")}
        descriptionLabel={t("pro.booking.descriptionLabel")}
        descriptionPlaceholder={t("pro.booking.supportDescriptionPlaceholder")}
        confirmLabel={t("pro.booking.confirm")}
        cancelLabel={t("pro.booking.keep")}
        pending={createTicket.isPending}
        onCancel={() => setDialog("")}
        onConfirm={({ category, subject, description }) => submitSupport(category as TicketCategory, subject ?? "", description ?? "")}
      />
    </ProviderShell>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-navy/10 text-navy">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold">{value}</div>
      </div>
    </div>
  );
}
