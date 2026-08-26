import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PhoneFrame, TopBar, PrimaryButton, EmptyState, Avatar, StatusPill } from "@/components/famio/ui";
import { useDefaultAddress, useProvider, useProviderReviews, useFavoriteIds, useToggleFavorite } from "@/lib/db/queries";
import { toUIProvider } from "@/lib/db/adapters";
import { useTranslation } from "react-i18next";
import { formatEGP, formatNumber } from "@/lib/utils";
import { Heart, Share2, Star, ShieldCheck, MapPin, Languages, Briefcase, Calendar, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";

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
    <PhoneFrame bg="bg-background">
      <div className="absolute top-0 z-10 w-full px-5 pb-4 pt-6 safe-top flex justify-between items-center bg-gradient-to-b from-black/60 to-transparent">
        <button onClick={() => nav({ to: "/home" })} aria-label={t("common.back")} className="focus-ring tap-scale grid h-10 w-10 place-items-center rounded-full bg-white/20 backdrop-blur-md text-white" data-rtl-flip="true">
          <ArrowRight className="h-5 w-5" strokeWidth={ICON_STROKE_BOLD} />
        </button>
        <div className="flex gap-3">
          <button onClick={onShare} aria-label={t("common.share")} className="focus-ring tap-scale grid h-10 w-10 place-items-center rounded-full bg-white/20 backdrop-blur-md text-white">
            <Share2 className="h-4 w-4" />
          </button>
          <button onClick={() => toggleFav.mutate({ providerId: p.id, on: !isFav })} aria-label={t("provider2.addToFavorites")} className="focus-ring tap-scale grid h-10 w-10 place-items-center rounded-full bg-white/20 backdrop-blur-md text-white">
            <Heart className={`h-4 w-4 ${isFav ? "fill-brand text-brand" : ""}`} />
          </button>
        </div>
      </div>

      <div className="relative">
        <img src={p.avatar} alt="" className="h-[45vh] w-full object-cover" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background via-background/80 to-transparent" />
      </div>

      <div className="relative -mt-16 px-5 pb-40">
        {p.rating >= 4.8 && (
          <div className="mb-3">
            <StatusPill tone="brand">{t("providerProfile.topRated")}</StatusPill>
          </div>
        )}
        <h1 className="text-[2rem] font-extrabold tracking-tight text-foreground leading-[1.1]">{p.name || t("provider2.unnamed")}</h1>
        
        <div className="mt-4 flex items-center justify-between border-b border-border/60 pb-5">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-base font-extrabold text-foreground">
              <Star className="h-5 w-5 fill-warning text-warning" />
              <span>{formatNumber(p.rating)}</span>
              <span className="text-muted-foreground font-medium text-sm">({formatNumber(p.reviews)} {t("providerProfile.reviewsCount", { count: 0 }).replace(/[0-9]/g, "").trim()})</span>
            </div>
            <div className="flex gap-2 mt-1">
              <StatusPill tone="success">{t("providerProfile.idVerified")}</StatusPill>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-black text-brand">
              {formatEGP(p.hourlyRate, { perHour: true })}
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <Stat icon={<Briefcase className="h-4 w-4" />} label={t("providerProfile.jobs")} value={formatNumber(p.jobs)} />
          <Stat icon={<Calendar className="h-4 w-4" />} label={t("providerProfile.years")} value={formatNumber(p.yearsExp)} />
          <Stat icon={<Star className="h-4 w-4" />} label={t("providerProfile.rating")} value={formatNumber(Number(p.rating.toFixed(1)))} />
        </div>

        <div className="mt-6 space-y-6">
          <ProfileSection title={t("providerProfile.about")}>
            <p className="text-sm font-medium leading-relaxed text-muted-foreground">{p.bio}</p>
          </ProfileSection>

          {p.gallery.length > 0 && (
            <ProfileSection title={t("providerProfile.gallery")}>
              <div className="-mx-1 overflow-x-auto no-scrollbar">
                <div className="flex gap-3 px-1">
                  {p.gallery.map((g, i) => (
                    <img key={g} src={g} alt="" loading="lazy" className="h-32 w-40 shrink-0 rounded-2xl object-cover shadow-sm" />
                  ))}
                </div>
              </div>
            </ProfileSection>
          )}

          <ProfileSection title={t("providerProfile.availability")}>
            <div className="grid grid-cols-7 gap-1.5">
              {dayKeys.map((d, i) => {
                const busy = i === 4;
                return (
                  <div
                    key={d}
                    className={`flex flex-col items-center gap-1 rounded-xl px-1 py-3 text-center transition-colors ${
                      busy ? "bg-surface-2 text-muted-foreground" : "bg-brand/10 text-brand"
                    }`}
                  >
                    <div className="text-[10px] font-extrabold uppercase leading-none">{t(`common.dayShort.${d}`)}</div>
                    <div className={`h-1.5 w-1.5 rounded-full ${busy ? "bg-border" : "bg-brand"}`} />
                  </div>
                );
              })}
            </div>
          </ProfileSection>
          
          <ProfileSection title={t("providerProfile.reviewsCount", { count: reviews.length })}>
            {reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("providerProfile.noReviews")}</p>
            ) : (
              <div className="space-y-3">
                {reviews.slice(0, 5).map((r: any) => (
                  <div key={r.id} className="rounded-2xl border border-border/70 bg-surface p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Avatar src={r.author_avatar} className="h-10 w-10 rounded-full" />
                        <div>
                          <p className="text-sm font-bold text-foreground">{r.author_name || t("providerProfile.anonymous")}</p>
                          <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString(t("common.langShortEn") === "EN" ? "en" : "ar")}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-sm font-bold">
                        <Star className="h-4 w-4 fill-warning text-warning" />
                        {r.rating}
                      </div>
                    </div>
                    {r.comment && <p className="mt-3 text-sm font-medium leading-relaxed text-foreground">{r.comment}</p>}
                  </div>
                ))}
              </div>
            )}
          </ProfileSection>
        </div>
      </div>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md bg-background/90 px-5 pb-5 pt-4 backdrop-blur-xl border-t border-border/40 shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
        <div className="mb-3 flex items-center justify-center gap-1.5 text-xs font-bold text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />
          {t("providerProfile.freeCancel")}
        </div>
        <PrimaryButton className="w-full h-14 rounded-full text-lg shadow-float" onClick={() => nav({ to: "/book/$providerId", params: { providerId: p.id }, search: { serviceId: undefined } })}>
          {t("providerProfile.bookWith", { name: p.name.split(" ")[0] || p.name })}
        </PrimaryButton>
      </div>
    </PhoneFrame>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-3 text-center border border-border/50">
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-surface text-foreground shadow-sm">{icon}</div>
      <div className="mt-2 text-lg font-black text-foreground">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function ProfileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-extrabold tracking-tight text-foreground mb-3">{title}</h2>
      <div>{children}</div>
    </section>
  );
}
