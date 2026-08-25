import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PhoneFrame, TopBar, PrimaryButton, EmptyState, Avatar, StatusPill } from "@/components/famio/ui";
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
    return <PhoneFrame><TopBar back={{ to: "/home" }} /><EmptyState icon="user-x" title={t("provider2.notFound")} /></PhoneFrame>;
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
          <Avatar src={p.avatar} alt={p.name || t("provider2.unnamed")} className="h-full w-full" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        </div>
        <TopBar
          back={{ to: "/home" }}
          transparent
          right={
            <div className="flex gap-2">
              <button onClick={onShare} aria-label={t("common.share")} className="focus-ring tap-scale grid h-10 w-10 place-items-center rounded-full bg-white/95 shadow-soft active:scale-95 transition-transform">
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
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={p.role === "Angel" ? "brand" : "ink"}>{roleLabel}</StatusPill>
            <StatusPill tone="success">{t("providerProfile.trust", { score: formatNumber(p.trustScore) })}</StatusPill>
          </div>
        </div>
      </div>

      <div className="px-5 pt-3 pb-1">
        <h1 className="text-title text-foreground">{p.name || t("provider2.unnamed")}</h1>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 fill-warning text-warning" /> {formatNumber(p.rating)} ({formatNumber(p.reviews)})</span>
          <span>·</span>
          <span className="font-semibold text-foreground">{formatEGP(p.hourlyRate, { perHour: true })}</span>
        </div>
      </div>

      <div className="mt-1 flex-1 rounded-t-[2rem] bg-background px-5 pt-5 pb-28">
        <div className="grid grid-cols-3 gap-2.5">
          <Stat icon={<Briefcase className="h-4 w-4" />} label={t("providerProfile.jobs")} value={formatNumber(p.jobs)} />
          <Stat icon={<Calendar className="h-4 w-4" />} label={t("providerProfile.years")} value={formatNumber(p.yearsExp)} />
          <Stat icon={<Star className="h-4 w-4" />} label={t("providerProfile.rating")} value={formatNumber(Number(p.rating.toFixed(1)))} />
        </div>

        <div className="mt-4 -mx-1 overflow-x-auto no-scrollbar">
          <div className="flex gap-2 px-1">
            {p.badges.map((b) => (
              <span key={b} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/70 bg-surface px-3 py-1.5 text-[11px] font-semibold shadow-xs">
                <ShieldCheck className="h-3 w-3 text-brand" aria-hidden="true" /> {t(`badges.${badgeKey(b)}`, b)}
              </span>
            ))}
          </div>
        </div>

        <ProfileSection title={t("providerProfile.about")}>
          <p className="text-body leading-relaxed text-foreground">{p.bio}</p>
        </ProfileSection>

        <ProfileSection title={t("providerProfile.languages")}>
          <div className="flex items-center gap-2 text-sm">
            <Languages className="h-4 w-4 text-brand" />
            {p.languages.map((l: string) => t(`pro.onboarding.langs.${l.toLowerCase()}`, l)).join(" · ")}
          </div>
        </ProfileSection>

        <ProfileSection title={t("providerProfile.areas")}>
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="h-4 w-4 text-brand" />
            {p.areas.join(" · ")}
          </div>
        </ProfileSection>

        <ProfileSection title={t("providerProfile.gallery")}>
          <div className="-mx-1 overflow-x-auto no-scrollbar">
            <div className="flex gap-3 px-1">
              {p.gallery.map((g, i) => (
                <img
                  key={g}
                  src={g}
                  alt={t("providerProfile.galleryImageAlt", { name: p.name, index: i + 1 })}
                  loading="lazy"
                  className="h-28 w-40 shrink-0 rounded-2xl object-cover shadow-xs"
                />
              ))}
            </div>
          </div>
        </ProfileSection>

        <ProfileSection title={t("providerProfile.availability")}>
          <div className="grid grid-cols-7 gap-1.5">
            {dayKeys.map((d, i) => {
              const busy = i === 4;
              return (
                <div
                  key={d}
                  className={`flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-center ${
                    busy ? "bg-destructive/10 text-destructive" : "bg-success/12 text-success"
                  }`}
                >
                  <div className="text-[10px] font-bold uppercase leading-none">{t(`providerProfile.days.${d}`)}</div>
                  <div className="text-[10px] leading-none">{busy ? t("providerProfile.busy") : t("providerProfile.free")}</div>
                </div>
              );
            })}
          </div>
        </ProfileSection>

        <ProfileSection title={t("providerProfile.reviewsCount", { count: reviews.length })}>
          {reviews.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("providerProfile.noReviews")}</p>
          ) : (
            <div className="space-y-3">
              {reviews.slice(0, 5).map((r: any) => (
                <div key={r.id} className="rounded-xl border border-border/70 bg-surface-2 p-3">
                  <div className="flex items-center gap-1 text-warning">
                    {Array.from({ length: r.rating }).map((_, i) => <Star key={i} className="h-3 w-3 fill-warning text-warning" />)}
                  </div>
                  <p className="mt-1 text-sm">{r.comment}</p>
                </div>
              ))}
            </div>
          )}
        </ProfileSection>
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
    <div className="surface-card p-3 text-center shadow-xs">
      <div className="mx-auto grid h-9 w-9 place-items-center rounded-xl bg-ink/10 text-ink">{icon}</div>
      <div className="mt-1.5 text-base font-extrabold text-foreground">{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function ProfileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-overline mb-2">{title}</h2>
      <div className="surface-card p-4 shadow-xs">{children}</div>
    </section>
  );
}
