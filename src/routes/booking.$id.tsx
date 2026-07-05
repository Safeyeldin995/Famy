import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PhoneFrame, PrimaryButton, Card, Badge, BackButton } from "@/components/famio/ui";
import { PaymentBlock } from "@/components/famio/PaymentBlock";
import { mockBookings, getProvider } from "@/lib/mock/data";
import { useBooking, useFavoriteIds, useToggleFavorite } from "@/lib/db/queries";
import { toUIProvider } from "@/lib/db/adapters";
import { currentLang } from "@/lib/i18n";
import { formatEGP } from "@/lib/utils";
import { Check, MapPin, Calendar, Clock, Phone, MessageCircle, Download, HelpCircle, AlertTriangle, Star, ShieldCheck, Bell, UserCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";


export const Route = createFileRoute("/booking/$id")({
  component: BookingDetail,
});

function BookingDetail() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const realQ = useBooking(id);
  const real = realQ.data;
  const lang = currentLang();
  const locale = lang === "ar" ? "ar-EG" : "en-US";

  // Real booking takes priority; fall back to mock for legacy demo links.
  const fallback = mockBookings.find((b) => b.id === id) || mockBookings[0];
  const provider = real?.provider
    ? toUIProvider(real.provider)
    : getProvider(fallback.providerId)!;

  const startAt = real?.start_at ? new Date(real.start_at) : null;
  const endAt = real?.end_at ? new Date(real.end_at) : null;
  const durationH = startAt && endAt ? Math.round((+endAt - +startAt) / 36e5) : null;

  type BookingView = {
    id: string;
    service: string;
    date: string;
    time: string;
    duration: string;
    address: string;
    total: string;
  };

  const booking: BookingView = real
    ? {
        id: real.id.slice(0, 8).toUpperCase(),
        service: ((lang === "ar" ? real.service?.name_ar : real.service?.name_en) || fallback.service) as string,
        date: startAt!.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" }),
        time: startAt!.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }),
        duration: `${durationH}h`,
        address: real.address ? `${real.address.line1}, ${real.address.city}` : fallback.address,
        total: formatEGP(Number(real.price_total ?? 0)),
      }
    : {
        id: fallback.id,
        service: fallback.service,
        date: fallback.date,
        time: fallback.time,
        duration: fallback.duration,
        address: fallback.address,
        total: formatEGP(fallback.price),
      };


  const [view, setView] = useState<"confirmation" | "active" | "completed">("confirmation");
  const [rating, setRating] = useState(0);
  const favIdsQ = useFavoriteIds();
  const toggleFav = useToggleFavorite();
  const nav = useNavigate();

  if (view === "completed") {
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
            <div className="flex items-center gap-3">
              <img src={provider.avatar} className="h-14 w-14 rounded-2xl object-cover" />
              <div>
                <div className="font-bold">{provider.name}</div>
                <div className="text-xs text-muted-foreground">{booking.service}</div>
              </div>
            </div>
            <div className="mt-5 flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setRating(n)}>
                  <Star className={`h-9 w-9 ${n <= rating ? "fill-warning text-warning" : "text-border"}`} />
                </button>
              ))}
            </div>
            <textarea
              rows={3}
              placeholder={t("bookingDetail.reviewPlaceholder")}
              className="mt-4 w-full resize-none rounded-2xl bg-surface-2 p-3 text-sm outline-none"
            />
            <button
              onClick={() => toggleFav.mutate({ providerId: provider.id, on: !(favIdsQ.data ?? []).includes(provider.id) })}
              className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-coral"
            >
              <Star className="h-4 w-4" /> {(favIdsQ.data ?? []).includes(provider.id) ? t("bookingDetail.savedFavorite") : t("bookingDetail.saveFavorite")}
            </button>
          </Card>
        </div>
        <div className="safe-bottom space-y-2 px-6 pt-4">
          <PrimaryButton onClick={() => nav({ to: "/home" })}>{t("bookingDetail.submitBookAgain")}</PrimaryButton>
        </div>
      </PhoneFrame>
    );
  }

  if (view === "active") {
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
            <BackButton back={() => setView("confirmation")} />
            <button
              aria-label={t("bookingDetail.emergency")}
              className="focus-ring grid h-11 w-11 place-items-center rounded-full bg-coral text-coral-foreground shadow-card active:scale-95 transition-transform"
            >
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="-mt-10 flex-1 rounded-t-3xl bg-surface px-5 pb-8 pt-5">
          <Badge tone="mint"><span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> {t("bookingDetail.onTheWay")}</Badge>
          <div className="mt-2 text-2xl font-extrabold">{t("bookingDetail.arrivingIn", { mins: 14 })}</div>
          <p className="text-sm text-muted-foreground">{t("bookingDetail.arrivingBody", { name: provider.name })}</p>

          <Card className="mt-5 p-4">
            <div className="flex items-center gap-3">
              <img src={provider.avatar} className="h-14 w-14 rounded-2xl object-cover" />
              <div className="min-w-0 flex-1">
                <div className="font-bold">{provider.name}</div>
                <div className="text-xs text-muted-foreground">★ {provider.rating} · {provider.role}</div>
              </div>
              <div className="flex gap-2">
                <Link
                  to="/messages/$id"
                  params={{ id: "m1" }}
                  aria-label={`${t("chat.title")} ${provider.name}`}
                  className="focus-ring grid h-11 w-11 place-items-center rounded-full bg-navy text-navy-foreground active:scale-95 transition-transform"
                >
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                </Link>
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
            <Timeline />
          </Card>

          <button onClick={() => setView("completed")} className="mt-4 w-full rounded-2xl bg-surface-2 py-3 text-sm font-semibold text-muted-foreground">
            {t("bookingDetail.demoComplete")}
          </button>
          <button className="mt-2 w-full rounded-2xl py-3 text-sm font-semibold text-destructive">{t("bookingDetail.cancel")}</button>
        </div>
      </PhoneFrame>
    );
  }

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
            <img src={provider.avatar} alt={provider.name} className="h-14 w-14 rounded-2xl object-cover" />
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

        {real && (
          <div className="mt-4">
            <PaymentBlock bookingId={real.id} viewer="customer" />
          </div>
        )}

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
        <PrimaryButton onClick={() => setView("active")}>{t("bookingDetail.trackBooking")}</PrimaryButton>
        <Link to="/home" className="block py-3 text-center text-sm font-semibold text-muted-foreground">{t("bookingDetail.backHome")}</Link>
      </div>
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

function Timeline() {
  const { t } = useTranslation();
  const items = [
    { label: t("bookingDetail.timeline.confirmed"), time: t("bookingDetail.timeline.yesterday", { time: "8:12 PM" }), done: true },
    { label: t("bookingDetail.timeline.matched"), time: t("bookingDetail.timeline.today", { time: "8:45 AM" }), done: true },
    { label: t("bookingDetail.timeline.onway"), time: t("bookingDetail.timeline.now"), done: true, active: true },
    { label: t("bookingDetail.timeline.arrival"), time: t("bookingDetail.timeline.eta", { time: "9:30 AM" }), done: false },
    { label: t("bookingDetail.timeline.inProgress"), time: t("bookingDetail.timeline.dash"), done: false },
    { label: t("bookingDetail.timeline.completed"), time: t("bookingDetail.timeline.dash"), done: false },
  ];
  return (
    <ol className="relative">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 pb-4 last:pb-0">
          <div className="flex flex-col items-center">
            <span className={`grid h-6 w-6 place-items-center rounded-full ${it.done ? "bg-navy text-navy-foreground" : "bg-muted text-muted-foreground"} ${it.active ? "ring-4 ring-coral/30" : ""}`}>
              {it.done ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            </span>
            {i < items.length - 1 && <span className={`mt-1 w-0.5 flex-1 ${it.done ? "bg-navy" : "bg-border"}`} />}
          </div>
          <div className="pb-2">
            <div className={`text-sm font-bold ${it.done ? "" : "text-muted-foreground"}`}>{it.label}</div>
            <div className="text-[11px] text-muted-foreground">{it.time}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
