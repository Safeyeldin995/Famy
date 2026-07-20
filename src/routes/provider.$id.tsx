import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PhoneFrame, TopBar, PrimaryButton, Badge, EmptyState } from "@/components/famio/ui";
import { useDefaultAddress, useProvider, useProviderReviews, useFavoriteIds, useToggleFavorite } from "@/lib/db/queries";
import { toUIProvider } from "@/lib/db/adapters";
import { useTranslation } from "react-i18next";
import { formatEGP, formatNumber } from "@/lib/utils";
import { Heart, Share2, Star, ShieldCheck, MapPin, Languages, Briefcase, Calendar } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/provider/$id")({ component: ProviderProfile });

function badgeKey(b: string) {
  return b.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function ProviderProfile() {
  const { id } = Route.useParams();
  const addressQ = useDefaultAddress();
  const provQ = useProvider(id, addressQ.data?.id);
  const reviewsQ = useProviderReviews(id);
  const favIdsQ = useFavoriteIds();
  const toggleFav = useToggleFavorite();
  const { t } = useTranslation();
  const nav = useNavigate();

  if (provQ.isLoading) {
    return <PhoneFrame><div className="px-5 py-10"><div className="h-72 rounded-3xl bg-surface animate-pulse" /></div></PhoneFrame>;
  }
  if (!provQ.data) {
    return <PhoneFrame><TopBar back={{ to: "/home" }} /><EmptyState emoji="🙈" title={t("provider2.notFound", "Pro not found")} /></PhoneFrame>;
  }

  const p = toUIProvider(provQ.data);
  const reviews = reviewsQ.data ?? [];
  const isFav = (favIdsQ.data ?? []).includes(p.id);
  const dayKeys = ["mon","tue","wed","thu","fri","sat","sun"] as const;
  const roleLabel = t(p.role === "Angel" ? "roles.angel" : "roles.professional");

  const onShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title: p.name, url }); } catch {}
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("common.linkCopied"));
    } catch {}
  };

  return (
    <PhoneFrame>
      <div className="relative">
        <div className="h-48 w-full overflow-hidden">
          <img src={p.avatar} alt={p.name || t("provider2.unnamed", "Provider")} className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        </div>
        <TopBar
          back={{ to: "/home" }}
          transparent
          right={
            <div className="flex gap-2">
              <button onClick={onShare} aria-label={t("common.share", "Share")} className="focus-ring grid h-10 w-10 place-items-center rounded-full bg-white/95 shadow-soft active:scale-95 transition-transform">
                <Share2 className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                onClick={() => toggleFav.mutate({ providerId: p.id, on: !isFav })}
                aria-label={isFav ? t("provider2.removeFromFavorites") : t("provider2.addToFavorites")}
                aria-pressed={isFav}
                className="focus-ring grid h-10 w-10 place-items-center rounded-full bg-white/95 shadow-soft active:scale-95 transition-transform"
              >
                <Heart key={String(isFav)} className={`h-4 w-4 ${isFav ? "fill-coral text-coral animate-heart-pop" : ""}`} aria-hidden="true" />
              </button>
            </div>
          }
        />
        <div className="pointer-events-none absolute inset-x-5 bottom-3 text-white">
          <div className="flex items-center gap-2">
            <Badge tone={p.role === "Angel" ? "coral" : "navy"}>{roleLabel}</Badge>
            <Badge tone="mint"><ShieldCheck className="h-3 w-3" /> {t("providerProfile.trust", { score: formatNumber(p.trustScore) })}</Badge>
          </div>
        </div>
      </div>

      <div className="px-5 pt-3 pb-1">
        <h1 className="text-xl font-extrabold leading-tight text-foreground">{p.name || t("provider2.unnamed", "Provider")}</h1>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 fill-warning text-warning" /> {formatNumber(p.rating)} ({formatNumber(p.reviews)})</span>
          <span>·</span>
          <span className="font-semibold text-foreground">{formatEGP(p.hourlyRate, { perHour: true })}</span>
        </div>
      </div>

      <div className="mt-2 flex-1 rounded-t-3xl bg-surface-2 px-5 pt-5 pb-28">

        <div className="grid grid-cols-3 gap-2">
          <Stat icon={<Briefcase className="h-4 w-4" />} label={t("providerProfile.jobs")} value={formatNumber(p.jobs)} />
          <Stat icon={<Calendar className="h-4 w-4" />} label={t("providerProfile.years")} value={formatNumber(p.yearsExp)} />
          <Stat icon={<Star className="h-4 w-4" />} label={t("providerProfile.rating")} value={formatNumber(Number(p.rating.toFixed(1)))} />
        </div>

        <div className="mt-4 -mx-5 overflow-x-auto no-scrollbar">
          <div className="flex gap-2 px-5">
            {p.badges.map((b) => (
              <span key={b} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-[11px] font-semibold shadow-soft">
                <ShieldCheck className="h-3 w-3 text-success" aria-hidden="true" /> {t(`badges.${badgeKey(b)}`, b)}
              </span>
            ))}
          </div>
        </div>

        <Section title={t("providerProfile.about")}>
          <p className="text-sm leading-relaxed text-foreground">{p.bio}</p>
        </Section>

        <Section title={t("providerProfile.languages")}>
          <div className="flex items-center gap-2 text-sm">
            <Languages className="h-4 w-4 text-muted-foreground" />
            {p.languages.map((l: string) => t(`pro.onboarding.langs.${l.toLowerCase()}`, l)).join(" · ")}
          </div>
        </Section>

        <Section title={t("providerProfile.areas")}>
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="h-4 w-4 text-coral" />
            {p.areas.join(" · ")}
          </div>
        </Section>

        <Section title={t("providerProfile.gallery")}>
          <div className="-mx-5 overflow-x-auto no-scrollbar">
            <div className="flex gap-3 px-5">
              {p.gallery.map((g, i) => (
                <img key={g} src={g} alt={`${p.name} ${i + 1}`} loading="lazy" className="h-28 w-40 shrink-0 rounded-2xl object-cover" />
              ))}
            </div>
          </div>
        </Section>

        <Section title={t("providerProfile.availability")}>
          <div className="grid grid-cols-7 gap-1.5">
            {dayKeys.map((d, i) => {
              const busy = i === 4;
              return (
                <div
                  key={d}
                  className={`flex flex-col items-center gap-0.5 rounded-2xl px-1 py-2 text-center ${
                    busy
                      ? "bg-destructive/10 text-destructive"
                      : "bg-success/15 text-success"
                  }`}
                >
                  <div className="text-[10px] font-bold uppercase leading-none">{t(`providerProfile.days.${d}`)}</div>
                  <div className="text-[10px] leading-none">{busy ? t("providerProfile.busy") : t("providerProfile.free")}</div>
                </div>
              );
            })}
          </div>
        </Section>


        <Section title={t("providerProfile.reviewsCount", { count: reviews.length })}>
          {reviews.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("providerProfile.noReviews", "No reviews yet.")}</p>
          ) : (
            <div className="space-y-3">
              {reviews.slice(0, 5).map((r: any) => (
                <div key={r.id} className="rounded-2xl bg-surface p-3 shadow-soft">
                  <div className="flex items-center gap-1 text-warning">
                    {Array.from({ length: r.rating }).map((_, i) => <Star key={i} className="h-3 w-3 fill-warning text-warning" />)}
                  </div>
                  <p className="mt-1 text-sm">{r.comment}</p>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t border-border bg-surface px-5 pt-3">
        <div className="mb-2 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
          <ShieldCheck className="h-3 w-3 text-success" aria-hidden="true" />
          {t("providerProfile.freeCancel")}
        </div>
        <PrimaryButton variant="coral" onClick={() => nav({ to: "/book/$providerId", params: { providerId: p.id }, search: { serviceId: undefined } })}>
          {t("providerProfile.bookNow", { price: formatEGP(p.hourlyRate, { perHour: true }) })}
        </PrimaryButton>
      </div>
    </PhoneFrame>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface p-3 text-center shadow-soft">
      <div className="mx-auto grid h-8 w-8 place-items-center rounded-xl bg-navy/10 text-navy">{icon}</div>
      <div className="mt-1.5 text-base font-extrabold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </div>
  );
}
