import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PhoneFrame, TopBar, PrimaryButton, Card, EmptyState } from "@/components/famio/ui";
import {
  useProvider, useProviderServices, useCreateBooking, useAddresses,
} from "@/lib/db/queries";
import { useCreatePayment } from "@/lib/db/payment-queries";
import { useBillingSettings, DEFAULT_BILLING_SETTINGS } from "@/lib/db/settings-queries";
import { toUIProvider } from "@/lib/db/adapters";
import { currentLang } from "@/lib/i18n";
import { MapPin, Banknote, Check, Loader2 } from "lucide-react";
import instapayLogo from "@/assets/instapay.png.asset.json";
import { useTranslation } from "react-i18next";
import { formatEGP, formatNumber } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/book/$providerId")({ component: Book });

function Book() {
  const { providerId } = Route.useParams();
  const provQ = useProvider(providerId);
  const servicesQ = useProviderServices(providerId);
  const billingQ = useBillingSettings();
  const addrsQ = useAddresses();
  const createBooking = useCreateBooking();
  const createPayment = useCreatePayment();
  const { t } = useTranslation();
  const nav = useNavigate();

  const stepKeys = ["service", "duration", "date", "time", "address", "notes", "summary", "payment"] as const;
  const [step, setStep] = useState(0);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [duration, setDuration] = useState("4h");
  const [date, setDate] = useState<Date | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [addressId, setAddressId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [pay, setPay] = useState<"cash" | "instapay">("cash");

  // Seed the address step from the customer's real default/most-recent saved
  // address once it loads — replaces the old Zustand `profile.address` read
  // (Sprint 1 Phase 2, adjustment #1). Only runs once, before the customer
  // has interacted with this step, so it never clobbers their own edits.
  useEffect(() => {
    if (addressId === null && address === "" && (addrsQ.data?.length ?? 0) > 0) {
      const def = addrsQ.data!.find((a: any) => a.is_default) ?? addrsQ.data![0];
      setAddressId(def.id);
      setAddress(`${def.line1}${def.line2 ? ", " + def.line2 : ""}, ${def.city}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addrsQ.data]);


  const p = provQ.data ? toUIProvider(provQ.data) : null;
  const services = servicesQ.data ?? [];
  const lang = currentLang();
  const activeService = useMemo(
    () => services.find((s: any) => s.service?.id === serviceId) ?? services[0],
    [services, serviceId],
  );

  if (provQ.isLoading || servicesQ.isLoading) {
    return <PhoneFrame><div className="grid flex-1 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-navy" /></div></PhoneFrame>;
  }
  if (!p) {
    return <PhoneFrame><EmptyState emoji="🙈" title={t("bookFlow.notFound")} /></PhoneFrame>;
  }

  const hours = parseInt(duration);
  const ratePerHour = Number(activeService?.price_override ?? p.hourlyRate);
  const subtotal = ratePerHour * hours;
  const fee = billingQ.data?.platform_fee ?? DEFAULT_BILLING_SETTINGS.platform_fee;
  const vat = Math.round(subtotal * ((billingQ.data?.vat_percent ?? DEFAULT_BILLING_SETTINGS.vat_percent) / 100));
  const total = subtotal + fee + vat;

  const durations = ["2h", "4h", "6h", "8h"];
  const timeSlots = ["8:00 AM", "10:00 AM", "12:00 PM", "2:00 PM", "4:00 PM", "6:00 PM"];

  const canNext = () => {
    if (step === 0) return !!activeService;
    if (step === 2) return !!date;
    if (step === 3) return !!time;
    if (step === 4) return address.trim().length > 3;
    return true;
  };

  const submit = async () => {
    if (!activeService?.service?.id || !date || !time) return;
    // Combine date + time
    const [hh, mm, ampm] = time.match(/(\d+):(\d+)\s*(\w+)/)!.slice(1);
    let h = parseInt(hh); if (ampm.toUpperCase() === "PM" && h !== 12) h += 12;
    const start = new Date(date);
    start.setHours(h, parseInt(mm), 0, 0);
    const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
    try {
      // COD goes straight to confirmed per spec; InstaPay stays pending until proof reviewed.
      const bookingStatus = pay === "cash" ? "confirmed" : "pending";
      const booking = await createBooking.mutateAsync({
        provider_id: p.id,
        service_id: activeService.service.id,
        address_id: addressId,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        price_subtotal: subtotal,
        price_discount: 0,
        price_total: total,
        currency: "EGP",
        status: bookingStatus,
        notes: notes || null,
      } as any);
      // Create the matching payment row (pending for COD, pending_review for InstaPay).
      try {
        await createPayment.mutateAsync({ bookingId: booking.id, method: pay, amount: total });
      } catch (pe: any) {
        // Don't lose the booking if the payment row insert fails — surface to the user but continue.
        console.error("payment row insert failed", pe);
        toast.error(pe?.message || t("bookFlow.paymentFailed", "Could not record payment method"));
      }
      toast.success(t("bookFlow.created", "Booking created"));
      nav({ to: "/booking/$id", params: { id: booking.id } });
    } catch (e: any) {
      toast.error(e?.message || t("bookFlow.failed", "Could not create booking"));
    }
  };

  const next = () => {
    if (step < stepKeys.length - 1) setStep(step + 1);
    else submit();
  };

  const back = step === 0 ? { to: "/provider/$id" as const, params: { id: p.id } } : () => setStep(step - 1);
  const locale = lang === "ar" ? "ar-EG" : "en-US";

  return (
    <PhoneFrame>
      <TopBar back={typeof back === "function" ? back : { to: `/provider/${p.id}` }} title={t(`bookFlow.stepName.${stepKeys[step]}`)} />
      <div className="px-5">
        <div className="mb-5 text-xs font-semibold text-muted-foreground">
          {t("bookFlow.stepLabel", { current: formatNumber(step + 1), total: formatNumber(stepKeys.length) })}
        </div>
      </div>

      <div className="flex-1 px-5 pb-28">
        {step === 0 && (
          <Step title={t("bookFlow.serviceTitle")} sub={t("bookFlow.serviceSub")}>
            {services.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("bookFlow.noServices", "This pro hasn't published services yet.")}</p>
            ) : (
              <div className="space-y-3">
                {services.map((s: any) => {
                  const label = (lang === "ar" ? s.service?.name_ar : s.service?.name_en) || s.service?.name_en;
                  const active = (serviceId ?? services[0].service?.id) === s.service?.id;
                  return <Option key={s.service.id} active={active} onClick={() => setServiceId(s.service.id)} label={label} />;
                })}
              </div>
            )}
          </Step>
        )}

        {step === 1 && (
          <Step title={t("bookFlow.durationTitle")} sub={t("bookFlow.durationSub")}>
            <div className="grid grid-cols-2 gap-3">
              {durations.map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={`rounded-2xl p-5 text-start transition-all ${duration === d ? "bg-navy text-navy-foreground" : "bg-surface shadow-soft"}`}
                >
                  <div className="text-2xl font-extrabold">{d}</div>
                  <div className={`text-xs ${duration === d ? "text-white/70" : "text-muted-foreground"}`}>{formatEGP(ratePerHour * parseInt(d))}</div>
                </button>
              ))}
            </div>
          </Step>
        )}

        {step === 2 && (
          <Step title={t("bookFlow.dateTitle")} sub={t("bookFlow.dateSub")}>
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 12 }).map((_, i) => {
                const d = new Date();
                d.setDate(d.getDate() + i);
                d.setHours(0, 0, 0, 0);
                const isSel = date?.toDateString() === d.toDateString();
                return (
                  <button
                    key={i}
                    onClick={() => setDate(d)}
                    className={`flex flex-col items-center rounded-2xl px-2 py-3 transition-all ${isSel ? "bg-coral text-coral-foreground" : "bg-surface shadow-soft"}`}
                  >
                    <span className="text-[10px] font-bold uppercase">{d.toLocaleString(locale, { weekday: "short" })}</span>
                    <span className="text-xl font-extrabold">{formatNumber(d.getDate())}</span>
                    <span className="text-[10px]">{d.toLocaleString(locale, { month: "short" })}</span>
                  </button>
                );
              })}
            </div>
          </Step>
        )}

        {step === 3 && (
          <Step title={t("bookFlow.timeTitle")} sub={t("bookFlow.timeSub")}>
            <div className="grid grid-cols-3 gap-2">
              {timeSlots.map((tm) => (
                <button
                  key={tm}
                  onClick={() => setTime(tm)}
                  className={`rounded-2xl py-3 text-sm font-bold ${time === tm ? "bg-navy text-navy-foreground" : "bg-surface shadow-soft"}`}
                >
                  {tm}
                </button>
              ))}
            </div>
          </Step>
        )}

        {step === 4 && (
          <Step title={t("bookFlow.addressTitle")} sub={t("bookFlow.addressSub")}>
            {(addrsQ.data ?? []).length > 0 && (
              <div className="mb-3 space-y-2">
                {(addrsQ.data ?? []).map((a: any) => (
                  <button
                    key={a.id}
                    onClick={() => { setAddressId(a.id); setAddress(`${a.line1}${a.line2 ? ", " + a.line2 : ""}, ${a.city}`); }}
                    className={`flex w-full items-center gap-3 rounded-2xl p-3 text-start transition-all ${addressId === a.id ? "bg-surface ring-2 ring-navy" : "bg-surface shadow-soft"}`}
                  >
                    <MapPin className="h-4 w-4 text-coral" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold">{a.label || a.city}</div>
                      <div className="truncate text-xs text-muted-foreground">{a.line1}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <Card className="overflow-hidden">
              <div aria-hidden="true" className="relative h-32" style={{ backgroundImage: "linear-gradient(135deg, hsl(var(--navy)) 0%, hsl(var(--navy) / 0.7) 60%, hsl(var(--mint) / 0.4) 100%)" }}>
                <div className="h-full w-full bg-gradient-to-b from-transparent to-surface/80" />
              </div>
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-coral" />
                  <textarea
                    rows={3}
                    value={address}
                    onChange={(e) => { setAddress(e.target.value); setAddressId(null); }}
                    placeholder={t("bookFlow.addressSub")}
                    className="min-w-0 flex-1 resize-none bg-transparent text-sm font-medium outline-none"
                  />
                </div>
              </div>
            </Card>
          </Step>
        )}

        {step === 5 && (
          <Step title={t("bookFlow.notesTitle")} sub={t("bookFlow.notesSub")}>
            <textarea
              rows={6}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("bookFlow.notesPlaceholder")}
              className="w-full resize-none rounded-2xl border border-border bg-surface p-4 text-[15px] outline-none focus:border-navy"
            />
          </Step>
        )}

        {step === 6 && (
          <Step title={t("bookFlow.summaryTitle")}>
            <Card className="p-4">
              <div className="flex items-center gap-3 border-b border-border pb-3">
                <img src={p.avatar} className="h-14 w-14 rounded-2xl object-cover" />
                <div className="min-w-0">
                  <div className="font-bold">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {(lang === "ar" ? activeService?.service?.name_ar : activeService?.service?.name_en) || ""} · {duration}
                  </div>
                </div>
              </div>
              <Row label={t("bookFlow.rowDate")} value={date ? date.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" }) : t("bookFlow.dash")} />
              <Row label={t("bookFlow.rowTime")} value={time || t("bookFlow.dash")} />
              <Row label={t("bookFlow.rowAddress")} value={address || t("bookFlow.dash")} />
              {notes && <Row label={t("bookFlow.rowNotes")} value={notes} />}
              <div className="mt-3 border-t border-border pt-3 space-y-1.5 text-sm">
                <Row label={t("bookFlow.rateLine", { rate: formatEGP(ratePerHour), hours: formatNumber(hours) })} value={formatEGP(subtotal)} small />
                <Row label={t("bookFlow.serviceFee")} value={formatEGP(fee)} small />
                <Row label={t("bookFlow.vat")} value={formatEGP(vat)} small />
                <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                  <span className="text-sm font-bold">{t("bookFlow.total")}</span>
                  <span className="text-lg font-extrabold text-navy">{formatEGP(total)}</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  <Check className="h-3 w-3 text-success" aria-hidden="true" />
                  {t("bookFlow.freeCancel")}
                </div>
              </div>
            </Card>
          </Step>
        )}

        {step === 7 && (
          <Step title={t("bookFlow.paymentTitle")} sub={t("bookFlow.paymentSub")}>
            <div className="space-y-3">
              <PayOption icon={<Banknote className="h-5 w-5" />} label={t("bookFlow.payCash")} sub={t("bookFlow.payCashSub")} active={pay === "cash"} onClick={() => setPay("cash")} />
              <PayOption icon={<img src={instapayLogo.url} alt="InstaPay" className="h-full w-full rounded-xl object-cover" />} label={t("bookFlow.payInstapay")} sub={t("bookFlow.payInstapaySub")} active={pay === "instapay"} onClick={() => setPay("instapay")} />
            </div>
            <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
              <Check className="h-3 w-3 text-success" aria-hidden="true" />
              {t("bookFlow.encrypted")}
            </div>
          </Step>
        )}
      </div>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t border-border bg-surface px-5 pt-3">
        {step === 7 && (
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("bookFlow.total")}</span>
            <span className="text-lg font-extrabold text-navy">{formatEGP(total)}</span>
          </div>
        )}
        <PrimaryButton variant={step === 7 ? "coral" : "navy"} onClick={next} disabled={!canNext() || createBooking.isPending}>
          {createBooking.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : step === 7 ? t("bookFlow.payCta", { price: formatEGP(total) }) : step === 6 ? t("bookFlow.continueToPayment") : t("bookFlow.continue")}
        </PrimaryButton>
      </div>
    </PhoneFrame>
  );
}

function Step({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="animate-rise">
      <h2 className="text-2xl font-extrabold tracking-tight">{title}</h2>
      {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      <div className="mt-6">{children}</div>
    </div>
  );
}

function Option({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-2xl p-4 text-start transition-all ${active ? "bg-navy text-navy-foreground" : "bg-surface shadow-soft"}`}
    >
      <span className="font-bold">{label}</span>
      <span className={`grid h-6 w-6 place-items-center rounded-full border-2 ${active ? "border-white bg-white text-navy" : "border-border"}`}>
        {active && <Check className="h-3.5 w-3.5" />}
      </span>
    </button>
  );
}

function PayOption({ icon, label, sub, active, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl p-4 text-start transition-all ${active ? "bg-surface ring-2 ring-navy" : "bg-surface shadow-soft"}`}
    >
      <div className="grid h-11 w-11 place-items-center rounded-xl bg-navy/10 text-navy">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold">{label}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </div>
      <span className={`grid h-6 w-6 place-items-center rounded-full border-2 ${active ? "border-navy bg-navy text-white" : "border-border"}`}>
        {active && <Check className="h-3.5 w-3.5" />}
      </span>
    </button>
  );
}

function Row({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className={`mt-2 flex items-start justify-between gap-3 ${small ? "text-xs text-muted-foreground" : "text-sm"}`}>
      <span>{label}</span>
      <span className={small ? "" : "font-semibold text-end"}>{value}</span>
    </div>
  );
}
