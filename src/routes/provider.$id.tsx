import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PhoneFrame, PrimaryButton, EmptyState, Avatar, StatusPill } from "@/components/famio/ui";
import { CustomerPageHero } from "@/components/famio/CustomerPageHero";
import { CustomerFloatingPanel } from "@/components/famio/CustomerFloatingPanel";
import { QueryError } from "@/components/famio/QueryError";
import {
  useDefaultAddress,
  useProvider,
  useProviderReviews,
  useFavoriteIds,
  useToggleFavorite,
} from "@/lib/db/queries";
import { useProviderAvailability } from "@/lib/db/provider-queries";
import { toUIProvider } from "@/lib/db/adapters";
import { useTranslation } from "react-i18next";
import { currentLang } from "@/lib/i18n";
import { formatEGP, formatNumber } from "@/lib/utils";
import {
  Heart,
  Share2,
  Star,
  ShieldCheck,
  MapPin,
  Languages,
  Briefcase,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { previewBookPath } from "@/lib/preview/previewPath";

export const Route = createFileRoute("/provider/$id")({ component: ProviderProfile });

const DISPLAY_DAYS = [
  { key: "mon", weekday: 1 },
  { key: "tue", weekday: 2 },
  { key: "wed", weekday: 3 },
  { key: "thu", weekday: 4 },
  { key: "fri", weekday: 5 },
  { key: "sat", weekday: 6 },
  { key: "sun", weekday: 0 },
] as const;

function heroActionClass() {
  return "focus-ring tap-scale grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/25 bg-white/15 text-white backdrop-blur-sm";
}

export function ProviderProfileContent({ providerId }: { providerId: string }) {
  const id = providerId;
  const addressQ = useDefaultAddress();
  const provQ = useProvider(id, addressQ.data?.id);
  const reviewsQ = useProviderReviews(id);
  const availQ = useProviderAvailability(id);
  const favIdsQ = useFavoriteIds();
  const toggleFav = useToggleFavorite();
  const { t } = useTranslation();
  const nav = useNavigate();
  const lang = currentLang();

  if (provQ.isLoading) {
    return (
      <PhoneFrame bg="bg-background">
        <div className="brand-hero safe-top h-40 rounded-b-[2.5rem] animate-pulse" />
        <div className="px-5">
          <div className="-mt-10 h-36 animate-pulse rounded-[1.5rem] bg-surface-2" />
          <div className="mt-5 grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-[1.25rem] bg-surface-2" />
            ))}
          </div>
        </div>
      </PhoneFrame>
    );
  }
  if (provQ.isError) {
    return (
      <PhoneFrame bg="bg-background">
        <CustomerPageHero title={t("common.errorTitle")} backTo="/home" />
        <QueryError onRetry={() => provQ.refetch()} />
      </PhoneFrame>
    );
  }
  if (!provQ.data) {
    return (
      <PhoneFrame bg="bg-background">
        <CustomerPageHero title={t("provider2.notFound")} backTo="/home" />
        <EmptyState icon="user-x" title={t("provider2.notFound")} />
      </PhoneFrame>
    );
  }

  const p = toUIProvider(provQ.data);
  const reviews = reviewsQ.data ?? [];
  const isFav = (favIdsQ.data ?? []).includes(p.id);
  const availableWeekdays = new Set((availQ.data ?? []).map((r) => r.weekday));
  const hasAvailability = availableWeekdays.size > 0;
  const categoryLabel =
    p.services.find((s) => s.status === "approved")?.name ||
    p.categorySlug.replace(/-/g, " ");

  const onShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: p.name, url });
      } catch {
        /* user dismissed */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("common.linkCopied"));
    } catch {
      /* clipboard unavailable */
    }
  };

  const languageLabel = (code: string) => {
    if (code === "ar") return t("common.arabic");
    if (code === "en") return t("common.english");
    return code;
  };

  return (
    <PhoneFrame bg="bg-background">
      <CustomerPageHero
        title={p.name || t("provider2.unnamed")}
        subtitle={categoryLabel}
        backTo="/home"
        right={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onShare}
              aria-label={t("common.share")}
              className={heroActionClass()}
            >
              <Share2 className="h-4 w-4" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => toggleFav.mutate({ providerId: p.id, on: !isFav })}
              aria-label={
                isFav ? t("provider2.removeFromFavorites") : t("provider2.addToFavorites")
              }
              className={heroActionClass()}
            >
              <Heart
                className={`h-4 w-4 ${isFav ? "fill-white text-white" : ""}`}
                strokeWidth={ICON_STROKE_BOLD}
                aria-hidden="true"
              />
            </button>
          </div>
        }
      />

      <div className="px-5">
        <CustomerFloatingPanel>
          <div className="flex items-start gap-4">
            <Avatar
              src={p.avatar}
              alt={p.name}
              className="h-20 w-20 shrink-0 rounded-[1.25rem] object-cover ring-2 ring-brand/15 shadow-sm"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {p.rating >= 4.8 ? (
                  <StatusPill tone="brand">{t("providerProfile.topRated")}</StatusPill>
                ) : null}
                {p.badges.includes("ID Verified") ? (
                  <StatusPill tone="success">{t("providerProfile.idVerified")}</StatusPill>
                ) : null}
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <Star className="h-4 w-4 fill-warning text-warning" aria-hidden="true" />
                <span className="text-base font-extrabold text-foreground">
                  {formatNumber(p.rating)}
                </span>
                <span className="text-sm font-semibold text-muted-foreground">
                  ({formatNumber(p.reviews)} {t("providerProfile.reviewsOnly")})
                </span>
              </div>
              <p className="mt-2 text-2xl font-black text-brand">
                {formatEGP(p.hourlyRate, { perHour: true })}
              </p>
            </div>
          </div>
        </CustomerFloatingPanel>
      </div>

      <div className="space-y-4 px-5 pb-36 pt-5">
        <div className="grid grid-cols-3 gap-3">
          <Stat
            icon={<Briefcase className="h-4 w-4" />}
            label={t("providerProfile.jobs")}
            value={formatNumber(p.jobs)}
          />
          <Stat
            icon={<Calendar className="h-4 w-4" />}
            label={t("providerProfile.years")}
            value={formatNumber(p.yearsExp)}
          />
          <Stat
            icon={<Star className="h-4 w-4" />}
            label={t("providerProfile.rating")}
            value={formatNumber(Number(p.rating.toFixed(1)))}
          />
        </div>

        {p.services.length > 0 ? (
          <ProfileCard title={t("providerProfile.servicesOffered")}>
            <div className="flex flex-wrap gap-2">
              {p.services.map((service) => (
                <span
                  key={service.name}
                  className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-extrabold ${
                    service.status === "approved"
                      ? "bg-brand/8 text-brand"
                      : "bg-surface-2 text-muted-foreground"
                  }`}
                >
                  {service.name}
                  {service.status !== "approved" ? (
                    <span className="ms-1 opacity-70">
                      · {t("providerProfile.servicePendingReview")}
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
          </ProfileCard>
        ) : null}

        {p.bio ? (
          <ProfileCard title={t("providerProfile.about")}>
            <p className="text-sm font-medium leading-relaxed text-muted-foreground">{p.bio}</p>
          </ProfileCard>
        ) : null}

        {(p.languages.length > 0 || p.areas.length > 0) && (
          <ProfileCard title={t("providerProfile.verifiedByFamio")}>
            <div className="space-y-3">
              {p.languages.length > 0 ? (
                <InfoRow
                  icon={<Languages className="h-4 w-4" />}
                  label={t("providerProfile.languages")}
                  value={p.languages.map(languageLabel).join(" · ")}
                />
              ) : null}
              {p.areas.length > 0 ? (
                <InfoRow
                  icon={<MapPin className="h-4 w-4" />}
                  label={t("providerProfile.areas")}
                  value={p.areas.join(" · ")}
                />
              ) : null}
            </div>
          </ProfileCard>
        )}

        <ProfileCard title={t("providerProfile.availability")}>
          {availQ.isLoading ? (
            <div className="grid grid-cols-7 gap-1.5">
              {DISPLAY_DAYS.map((d) => (
                <div key={d.key} className="h-14 animate-pulse rounded-xl bg-surface-2" />
              ))}
            </div>
          ) : !hasAvailability ? (
            <p className="text-sm font-medium text-muted-foreground">
              {t("providerProfile.noAvailability")}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1.5">
                {DISPLAY_DAYS.map((d) => {
                  const open = hasAvailability && availableWeekdays.has(d.weekday);
                  return (
                    <div
                      key={d.key}
                      className={`flex flex-col items-center gap-1 rounded-xl px-1 py-3 text-center transition-colors ${
                        open ? "bg-brand/10 text-brand" : "bg-surface-2 text-muted-foreground"
                      }`}
                    >
                      <div className="text-[10px] font-extrabold uppercase leading-none">
                        {t(`providerProfile.days.${d.key}`)}
                      </div>
                      <div
                        className={`h-1.5 w-1.5 rounded-full ${open ? "bg-brand" : "bg-border"}`}
                        aria-hidden="true"
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center justify-center gap-4 text-[11px] font-bold text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-brand" aria-hidden="true" />
                  {t("providerProfile.free")}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-border" aria-hidden="true" />
                  {t("providerProfile.busy")}
                </span>
              </div>
            </>
          )}
        </ProfileCard>

        {p.gallery.length > 0 ? (
          <ProfileCard title={t("providerProfile.gallery")}>
            <div className="-mx-1 overflow-x-auto no-scrollbar">
              <div className="flex gap-3 px-1">
                {p.gallery.map((g, i) => (
                  <img
                    key={g}
                    src={g}
                    alt={t("providerProfile.galleryImageAlt", { name: p.name, index: i + 1 })}
                    loading="lazy"
                    className="h-32 w-40 shrink-0 rounded-[1.25rem] object-cover shadow-sm"
                  />
                ))}
              </div>
            </div>
          </ProfileCard>
        ) : null}

        <ProfileCard title={t("providerProfile.reviewsCount", { count: reviews.length })}>
          {reviewsQ.isError ? (
            <QueryError compact onRetry={() => reviewsQ.refetch()} />
          ) : reviews.length === 0 ? (
            <p className="text-sm font-medium text-muted-foreground">
              {t("providerProfile.noReviews")}
            </p>
          ) : (
            <div className="space-y-2.5">
              {reviews.slice(0, 5).map((r: any) => (
                <div
                  key={r.id}
                  className="rounded-[1.25rem] border border-border/40 bg-surface-2/80 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar src={r.author_avatar} className="h-10 w-10 rounded-full" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-foreground">
                          {r.author_name || t("providerProfile.anonymous")}
                        </p>
                        <p className="text-xs font-medium text-muted-foreground">
                          {new Date(r.created_at).toLocaleDateString(
                            lang === "ar" ? "ar-EG" : "en-US",
                            { month: "short", day: "numeric", year: "numeric" },
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 text-sm font-extrabold">
                      <Star className="h-4 w-4 fill-warning text-warning" aria-hidden="true" />
                      {r.rating}
                    </div>
                  </div>
                  {r.comment ? (
                    <p className="mt-3 text-sm font-medium leading-relaxed text-foreground">
                      {r.comment}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </ProfileCard>
      </div>

      <div className="action-bar safe-bottom border-t border-border/40 bg-background/95 px-5 pb-5 pt-4 backdrop-blur-sm">
        <div className="mb-3 flex items-center justify-center gap-1.5 text-xs font-bold text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />
          {t("providerProfile.freeCancel")}
        </div>
        <PrimaryButton
          className="h-14 w-full rounded-full text-base shadow-float"
          onClick={() =>
            nav({
              to: previewBookPath(p.id),
              search: { serviceId: undefined },
            })
          }
        >
          {t("providerProfile.bookWith", { name: p.name.split(" ")[0] || p.name })}
        </PrimaryButton>
      </div>
    </PhoneFrame>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[1.25rem] border border-border/50 bg-surface-elevated p-3 text-center shadow-sm">
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-brand/10 text-brand">
        {icon}
      </div>
      <div className="mt-2 text-lg font-black text-foreground">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function ProfileCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[1.75rem] border border-border/50 bg-surface-elevated p-4 shadow-sm">
      <h2 className="mb-3 text-xs font-black uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand/8 text-brand">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-0.5 text-sm font-semibold text-foreground">{value}</p>
      </div>
    </div>
  );
}

function ProviderProfile() {
  const { id } = Route.useParams();
  return <ProviderProfileContent providerId={id} />;
}
