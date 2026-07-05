import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { TopBar, Card, Badge, PrimaryButton, ErrorState } from "@/components/famio/ui";
import { PaymentBlock } from "@/components/famio/PaymentBlock";
import { useLang } from "@/components/famio/LanguageToggle";
import { useProviderBooking, useProviderUpdateBookingStatus } from "@/lib/db/provider-queries";
import { bookingStatusTone, formatEGP } from "@/lib/utils";
import { Calendar, Clock, MapPin, Phone, User as UserIcon } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/pro/booking/$id")({ component: ProBookingDetail });

function ProBookingDetail() {
  const { t } = useTranslation();
  const lang = useLang();
  const dateLoc = lang === "ar" ? "ar-EG" : "en-US";
  const { id } = Route.useParams();
  const nav = useNavigate();
  const q = useProviderBooking(id);
  const mut = useProviderUpdateBookingStatus();
  const [confirm, setConfirm] = useState<"" | "decline" | "cancel">("");

  if (q.isLoading) return <ProviderShell hideNav><TopBar back={{ to: "/pro/bookings" }} /><div className="h-64 animate-pulse rounded-3xl bg-surface mx-5" /></ProviderShell>;
  if (q.isError || !q.data) return <ProviderShell hideNav><TopBar back={{ to: "/pro/bookings" }} /><ErrorState title={t("pro.booking.notFound")} /></ProviderShell>;

  const b = q.data as any;
  const start = new Date(b.start_at);
  const end = new Date(b.end_at);
  const hours = Math.max(1, Math.round((+end - +start) / 36e5));
  const name = b.customer?.full_name || t("pro.common.customer");
  const addr = b.address;
  const addrLine = addr ? [addr.street, addr.building, addr.compound, addr.city].filter(Boolean).join(", ") : (b.notes ?? t("pro.booking.addressMissing"));
  const serviceName = lang === "ar" ? (b.service?.name_ar ?? b.service?.name_en) : (b.service?.name_en ?? b.service?.name_ar);

  const update = (status: string) => mut.mutate({ id, status });

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

        <Card className="space-y-2 p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("pro.booking.payment")}</div>
          <div className="flex items-center justify-between"><span className="text-sm">{t("pro.booking.subtotal")}</span><span>{formatEGP(Number(b.price_subtotal ?? 0))}</span></div>
          {Number(b.price_discount ?? 0) > 0 && <div className="flex items-center justify-between text-coral"><span className="text-sm">{t("pro.booking.discount")}</span><span>−{formatEGP(Number(b.price_discount))}</span></div>}
          <div className="flex items-center justify-between border-t border-border pt-2"><span className="text-sm font-bold">{t("pro.booking.total")}</span><span className="text-base font-extrabold text-navy">{formatEGP(Number(b.price_total ?? 0))}</span></div>
        </Card>

        <PaymentBlock bookingId={b.id} viewer="provider" />

      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-surface-2 via-surface-2/90 to-transparent pt-6 safe-bottom">
        <div className="mx-auto max-w-md px-5 pb-3">
          {b.status === "pending" && (
            <div className="flex gap-2">
              <button onClick={() => setConfirm("decline")} disabled={mut.isPending} className="focus-ring h-14 flex-1 rounded-2xl border border-coral bg-surface text-sm font-bold text-coral active:scale-[0.98]">{t("pro.booking.decline")}</button>
              <button onClick={() => update("confirmed")} disabled={mut.isPending} className="focus-ring h-14 flex-1 rounded-2xl bg-navy text-sm font-bold text-navy-foreground shadow-card active:scale-[0.98] disabled:opacity-50">{t("pro.booking.accept")}</button>
            </div>
          )}
          {b.status === "confirmed" && (
            <div className="space-y-2">
              <PrimaryButton onClick={() => update("in_progress")} disabled={mut.isPending}>{t("pro.booking.startJob")}</PrimaryButton>
              <button onClick={() => setConfirm("cancel")} className="w-full py-2 text-xs font-semibold text-muted-foreground">{t("pro.booking.cancelJob")}</button>
            </div>
          )}
          {b.status === "in_progress" && (
            <PrimaryButton onClick={() => update("completed")} disabled={mut.isPending} variant="coral">{t("pro.booking.markCompleted")}</PrimaryButton>
          )}
          {["completed", "cancelled", "no_show"].includes(b.status) && (
            <button onClick={() => nav({ to: "/pro/bookings" })} className="focus-ring h-14 w-full rounded-2xl border border-border bg-surface text-sm font-bold">{t("pro.booking.backToJobs")}</button>
          )}
        </div>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-6" onClick={() => setConfirm("")}>
          <Card className="w-full max-w-sm p-5" >
            <div className="text-base font-extrabold">{confirm === "decline" ? t("pro.booking.declineConfirm") : t("pro.booking.cancelConfirm")}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t("pro.booking.irreversible")}</div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setConfirm("")} className="h-12 flex-1 rounded-2xl border border-border bg-surface text-sm font-bold">{t("pro.booking.keep")}</button>
              <button
                onClick={() => { update("cancelled"); setConfirm(""); }}
                className="h-12 flex-1 rounded-2xl bg-coral text-sm font-bold text-coral-foreground"
              >{t("pro.booking.confirm")}</button>
            </div>
          </Card>
        </div>
      )}
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
