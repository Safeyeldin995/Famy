import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { TopBar, Card, Badge, PrimaryButton, ErrorState, BookingTimeline, ReasonDialog } from "@/components/famio/ui";
import { PaymentBlock } from "@/components/famio/PaymentBlock";
import { RescheduleSection } from "@/components/famio/RescheduleSection";
import { useLang } from "@/components/famio/LanguageToggle";
import { useProviderBooking, useProviderUpdateBookingStatus } from "@/lib/db/provider-queries";
import { bookingStatusTone, formatEGP, BOOKING_TIMELINE_STEPS } from "@/lib/utils";
import { Calendar, Clock, MapPin, Phone, User as UserIcon } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/pro/booking/$id")({ component: ProBookingDetail });

type DialogKind = "" | "decline" | "cancel" | "no_show";

function ProBookingDetail() {
  const { t } = useTranslation();
  const lang = useLang();
  const dateLoc = lang === "ar" ? "ar-EG" : "en-US";
  const { id } = Route.useParams();
  const nav = useNavigate();
  const q = useProviderBooking(id);
  const mut = useProviderUpdateBookingStatus();
  const [dialog, setDialog] = useState<DialogKind>("");

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
            {(b.cancellation_reason || b.no_show_reason || b.dispute_reason) && (
              <p className="text-xs text-muted-foreground">{b.cancellation_reason || b.no_show_reason || b.dispute_reason}</p>
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

        {b.notes && (
          <Card className="p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("pro.booking.customerNotes")}</div>
            <div className="mt-1 text-sm whitespace-pre-wrap">{b.notes}</div>
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

      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-surface-2 via-surface-2/90 to-transparent pt-6 safe-bottom">
        <div className="mx-auto max-w-md px-5 pb-3">
          {b.status === "pending" && (
            <div className="flex gap-2">
              <button onClick={() => setDialog("decline")} disabled={mut.isPending} className="focus-ring h-14 flex-1 rounded-2xl border border-coral bg-surface text-sm font-bold text-coral active:scale-[0.98] disabled:opacity-50">{t("pro.booking.decline")}</button>
              <button onClick={() => run("confirmed")} disabled={mut.isPending} className="focus-ring h-14 flex-1 rounded-2xl bg-navy text-sm font-bold text-navy-foreground shadow-card active:scale-[0.98] disabled:opacity-50">{t("pro.booking.accept")}</button>
            </div>
          )}

          {b.status === "confirmed" && (
            <div className="space-y-2">
              <PrimaryButton onClick={() => run("on_the_way")} disabled={mut.isPending}>{t("pro.booking.onTheWay")}</PrimaryButton>
              <button onClick={() => setDialog("cancel")} disabled={mut.isPending} className="w-full py-2 text-xs font-semibold text-muted-foreground disabled:opacity-50">{t("pro.booking.cancelJob")}</button>
            </div>
          )}

          {b.status === "on_the_way" && (
            <div className="space-y-2">
              <PrimaryButton onClick={() => run("arrived")} disabled={mut.isPending}>{t("pro.booking.iHaveArrived")}</PrimaryButton>
              <button onClick={() => setDialog("no_show")} disabled={mut.isPending} className="w-full py-2 text-xs font-semibold text-coral disabled:opacity-50">{t("pro.booking.reportNoShow")}</button>
            </div>
          )}

          {b.status === "arrived" && (
            <div className="space-y-2">
              <div className="rounded-2xl bg-surface-2 py-3 text-center text-sm font-semibold text-muted-foreground">{t("pro.booking.waitingArrivalConfirm")}</div>
              <button onClick={() => setDialog("no_show")} disabled={mut.isPending} className="w-full py-2 text-xs font-semibold text-coral disabled:opacity-50">{t("pro.booking.reportNoShow")}</button>
            </div>
          )}

          {b.status === "arrival_confirmed" && (
            <PrimaryButton onClick={() => run("in_progress")} disabled={mut.isPending}>{t("pro.booking.startService")}</PrimaryButton>
          )}

          {b.status === "in_progress" && (
            <PrimaryButton onClick={() => run("completion_requested")} disabled={mut.isPending} variant="coral">{t("pro.booking.requestCompletion")}</PrimaryButton>
          )}

          {b.status === "completion_requested" && (
            <div className="rounded-2xl bg-surface-2 py-3 text-center text-sm font-semibold text-muted-foreground">{t("pro.booking.waitingCompletionConfirm")}</div>
          )}

          {terminal && (
            <button onClick={() => nav({ to: "/pro/bookings" })} className="focus-ring h-14 w-full rounded-2xl border border-border bg-surface text-sm font-bold">{t("pro.booking.backToJobs")}</button>
          )}
        </div>
      </div>

      <ReasonDialog
        key={`decline-cancel-${dialog}`}
        open={dialog === "decline" || dialog === "cancel"}
        title={dialog === "decline" ? t("pro.booking.declineConfirm") : t("pro.booking.cancelConfirm")}
        body={t("pro.booking.irreversible")}
        reasonPlaceholder={t("pro.booking.reasonPlaceholder")}
        confirmLabel={t("pro.booking.confirm")}
        cancelLabel={t("pro.booking.keep")}
        pending={mut.isPending}
        onCancel={() => setDialog("")}
        onConfirm={(reason) => run("cancelled", { reason }, () => setDialog(""))}
      />

      <ReasonDialog
        key={`no-show-${dialog}`}
        open={dialog === "no_show"}
        title={t("pro.booking.noShowConfirmTitle")}
        body={t("pro.booking.irreversible")}
        reasonPlaceholder={t("pro.booking.reasonPlaceholder")}
        confirmLabel={t("pro.booking.confirm")}
        cancelLabel={t("pro.booking.keep")}
        pending={mut.isPending}
        onCancel={() => setDialog("")}
        onConfirm={(reason) => run("no_show", { reason, noShowParty: "customer" }, () => setDialog(""))}
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
