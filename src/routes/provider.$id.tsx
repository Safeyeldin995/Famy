import { isFixedPackage, packageLabel } from "@/lib/pricing/servicePackages";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PhoneFrame, EmptyState } from "@/components/famio/ui";
import { CustomerPageHero } from "@/components/famio/CustomerPageHero";
import { StickyCta } from "@/components/famio/StickyCta";
import { QueryError } from "@/components/famio/QueryError";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import {
  useBookableServiceIds,
  useDefaultAddress,
  useProvider,
  useProviderReviews,
  useProviderServices,
  useFavoriteIds,
  useToggleFavorite,
} from "@/lib/db/queries";
import { useApprovedTeachingCapabilities } from "@/lib/db/teaching-queries";
import {
  isTutoringCategorySlug,
  type TeachingCapabilityOption,
} from "@/lib/tutoring/teachingCapabilities";
import { levelRanges } from "@/lib/tutoring/levelRanges";
import { useProviderAvailability } from "@/lib/db/provider-queries";
import { workingHoursSummary } from "@/lib/provider/workingHoursSummary";
import { toUIProvider } from "@/lib/db/adapters";
import { useTranslation } from "react-i18next";
import { currentLang } from "@/lib/i18n";
import { formatDate, formatEGP, formatNumber } from "@/lib/format";
import { ArrowLeft, BadgeCheck, Heart, Share2, Star } from "lucide-react";
import { toast } from "sonner";
import { useProviderOnlyCustomerRedirect } from "@/lib/auth/providerOnlyCustomerGuard";
import { previewBookPath, previewPath } from "@/lib/preview/previewPath";

export const Route = createFileRoute("/provider/$id")({ component: ProviderProfile });

type ServiceRow = {
  price_override: number | null;
  service: {
    id: string;
    name_ar: string;
    name_en: string;
    pricing_model?: string | null;
    duration_min?: number | null;
    fixed_start_time?: string | null;
    category?: { slug?: string | null; name_ar?: string | null; name_en?: string | null } | null;
  };
};

const iconButton =
  "focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/60 bg-white text-foreground";

/** Subject + curriculum + duration + price groups, with grade ranges. */
function teachingGroups(caps: TeachingCapabilityOption[], ar: boolean) {
  const groups = new Map<string, TeachingCapabilityOption[]>();
  for (const cap of caps) {
    const key = [
      cap.serviceId,
      cap.subjectCode,
      cap.curriculumCode,
      cap.durationMin,
      cap.price,
    ].join("|");
    groups.set(key, [...(groups.get(key) ?? []), cap]);
  }
  return [...groups].map(([key, rows]) => ({
    key,
    subject: ar ? rows[0].subjectNameAr : rows[0].subjectNameEn,
    curriculum: ar ? rows[0].curriculumNameAr : rows[0].curriculumNameEn,
    durationMin: rows[0].durationMin,
    price: rows[0].price,
    ranges: levelRanges(
      rows.map((row) => ({ code: row.levelCode, name: ar ? row.levelNameAr : row.levelNameEn })),
    ),
  }));
}

export function ProviderProfileContent({ providerId }: { providerId: string }) {
  const { blocking } = useProviderOnlyCustomerRedirect();
  const id = providerId;
  const addressQ = useDefaultAddress();
  const provQ = useProvider(id, addressQ.data?.id);
  const reviewsQ = useProviderReviews(id);
  const servicesQ = useProviderServices(id);
  const bookableQ = useBookableServiceIds(id, addressQ.data?.id);
  const availQ = useProviderAvailability(id);
  const capsQ = useApprovedTeachingCapabilities(id);
  const favIdsQ = useFavoriteIds();
  const toggleFav = useToggleFavorite();
  const { t } = useTranslation();
  const nav = useNavigate();
  const ar = currentLang() === "ar";

  if (blocking) return null;

  if (provQ.isLoading) {
    return (
      <PhoneFrame bg="bg-background">
        <div className="safe-top px-5 pt-16">
          <div className="mx-auto h-24 w-24 animate-pulse rounded-full bg-surface-2" />
          <div className="mx-auto mt-4 h-6 w-40 animate-pulse rounded-full bg-surface-2" />
          <div className="mt-8 h-32 animate-pulse rounded-3xl bg-surface-2" />
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
  const name = p.name || t("provider2.unnamed");
  const firstName = name.split(" ")[0] || name;
  const reviews = reviewsQ.data ?? [];
  const isFav = (favIdsQ.data ?? []).includes(p.id);
  const bookable = bookableQ.data ?? null;
  const caps = capsQ.data ?? [];

  // Only services the customer can actually book. A tutoring service also
  // needs at least one approved subject group.
  const services = ((servicesQ.data ?? []) as ServiceRow[]).filter((row) => {
    if (bookable && !bookable.has(row.service.id)) return false;
    if (isTutoringCategorySlug(row.service.category?.slug))
      return caps.some((cap) => cap.serviceId === row.service.id);
    return true;
  });
  const careServices = services.filter(
    (row) => !isTutoringCategorySlug(row.service.category?.slug),
  );
  const tutoringServiceIds = new Set(
    services
      .filter((row) => isTutoringCategorySlug(row.service.category?.slug))
      .map((row) => row.service.id),
  );
  const groups = teachingGroups(
    caps.filter((cap) => tutoringServiceIds.has(cap.serviceId)),
    ar,
  );
  const categories = [
    ...new Set(
      services.map(
        (row) => (ar ? row.service.category?.name_ar : row.service.category?.name_en) ?? "",
      ),
    ),
  ].filter(Boolean);
  const hours = workingHoursSummary(availQ.data ?? [], t);
  const canBook = services.length > 0;

  const priceFor = (row: ServiceRow) => {
    const effective = bookable?.get(row.service.id) ?? null;
    const value = isFixedPackage(row.service)
      ? (row.price_override ?? effective)
      : (effective ?? row.price_override ?? p.hourlyRate);
    if (value == null) return null;
    return isFixedPackage(row.service)
      ? formatEGP(Number(value))
      : t("providerPage.perHour", { price: formatEGP(Number(value)) });
  };

  const onShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: name, url });
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

  const languageLabel = (code: string) =>
    code === "ar" ? t("common.arabic") : code === "en" ? t("common.english") : code;

  return (
    <PhoneFrame bg="bg-background">
      <header className="safe-top flex items-center justify-between px-4 pt-3">
        <Link
          to={previewPath("/home") as "/home"}
          aria-label={t("common.back")}
          className={iconButton}
        >
          <ArrowLeft data-rtl-flip="true" className="h-5 w-5" aria-hidden="true" />
        </Link>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onShare}
            aria-label={t("common.share")}
            className={iconButton}
          >
            <Share2 className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => toggleFav.mutate({ providerId: p.id, on: !isFav })}
            aria-label={isFav ? t("provider2.removeFromFavorites") : t("provider2.addToFavorites")}
            aria-pressed={isFav}
            className={iconButton}
          >
            <Heart
              className={`h-5 w-5 ${isFav ? "fill-brand text-brand" : ""}`}
              aria-hidden="true"
            />
          </button>
        </div>
      </header>

      <div className="px-5 pb-40">
        <section className="mt-2 flex flex-col items-center text-center">
          <ProfileAvatar
            src={p.avatar}
            name={name}
            className="h-24 w-24 rounded-full text-3xl ring-4 ring-brand/10"
          />
          <h1 className="mt-3 text-pro-22 font-extrabold leading-snug text-foreground">{name}</h1>
          {categories.length > 0 ? (
            <p className="mt-1 text-pro-14 text-muted-foreground">{categories.join(" · ")}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-pro-13 font-semibold">
            {p.reviews > 0 ? (
              <span className="inline-flex items-center gap-1 text-foreground">
                <Star className="h-4 w-4 fill-warning text-warning" aria-hidden="true" />
                {formatNumber(Number(p.rating.toFixed(1)))}
                <span className="font-normal text-muted-foreground">
                  ({t("providerPage.reviewCount", { count: p.reviews })})
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">{t("providerPage.newOnFamy")}</span>
            )}
            {p.badges.includes("ID Verified") ? (
              <span className="inline-flex items-center gap-1 text-success">
                <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                {t("providerPage.idVerified")}
              </span>
            ) : null}
          </div>
        </section>

        <dl className="mt-5 grid grid-cols-3 divide-x divide-border/60 rounded-2xl border border-border/60 bg-white py-3 text-center rtl:divide-x-reverse">
          <div>
            <dt className="text-pro-12 text-muted-foreground">{t("providerPage.completed")}</dt>
            <dd className="mt-0.5 text-pro-16 font-bold text-foreground">{formatNumber(p.jobs)}</dd>
          </div>
          <div>
            <dt className="text-pro-12 text-muted-foreground">{t("providerPage.experience")}</dt>
            <dd className="mt-0.5 text-pro-16 font-bold text-foreground">
              {t("providerPage.years", { count: p.yearsExp })}
            </dd>
          </div>
          <div>
            <dt className="text-pro-12 text-muted-foreground">{t("providerPage.area")}</dt>
            <dd className="mt-0.5 truncate px-2 text-pro-16 font-bold text-foreground">
              {p.areas[0] ?? "—"}
            </dd>
          </div>
        </dl>

        {careServices.length > 0 ? (
          <Section title={t("providerPage.services")}>
            <ul className="divide-y divide-border/60">
              {careServices.map((row) => {
                const price = priceFor(row);
                const label = isFixedPackage(row.service) ? packageLabel(row.service) : null;
                return (
                  <li key={row.service.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-pro-14 font-bold text-foreground">
                        {ar ? row.service.name_ar : row.service.name_en}
                      </p>
                      <p className="mt-0.5 text-pro-12 text-muted-foreground">
                        {label
                          ? label.key === "packages.fullDay"
                            ? t("providerPage.fullDayHint")
                            : label.key === "packages.overnight"
                              ? t("providerPage.overnightHint")
                              : t(label.key, label.values)
                          : t("providerPage.hourlyHint")}
                      </p>
                    </div>
                    {price ? (
                      <span className="shrink-0 text-pro-14 font-bold text-brand">{price}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Section>
        ) : null}

        {groups.length > 0 ? (
          <Section title={t("providerPage.teaches")}>
            <ul className="space-y-2.5">
              {groups.map((group) => (
                <li key={group.key} className="rounded-2xl bg-surface-2/70 p-3.5">
                  <p className="text-pro-14 font-bold text-foreground">
                    {group.subject} · {group.curriculum}
                  </p>
                  <p className="mt-1 text-pro-13 text-muted-foreground">
                    {group.ranges
                      .map((range) =>
                        range.to
                          ? t("providerPage.levelRange", { from: range.from, to: range.to })
                          : range.from,
                      )
                      .join("، ")}
                  </p>
                  <p className="mt-1.5 text-pro-13 font-bold text-brand">
                    {t("providerPage.session", {
                      price: formatEGP(group.price),
                      minutes: formatNumber(group.durationMin),
                    })}
                  </p>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {!canBook && !servicesQ.isLoading && !bookableQ.isLoading && !capsQ.isLoading ? (
          <p className="mt-5 rounded-2xl bg-surface-2 p-4 text-center text-pro-14 text-muted-foreground">
            {t("providerPage.notBookable", { name: firstName })}
          </p>
        ) : null}

        {p.bio ? (
          <Section title={t("providerPage.about", { name: firstName })}>
            <p className="whitespace-pre-line text-pro-14 leading-relaxed text-foreground/85">
              {p.bio}
            </p>
            {p.languages.length > 0 ? (
              <p className="mt-3 text-pro-13 text-muted-foreground">
                {t("providerPage.languages")}: {p.languages.map(languageLabel).join("، ")}
              </p>
            ) : null}
          </Section>
        ) : null}

        <Section title={t("providerPage.hours")}>
          {availQ.isLoading ? (
            <div className="h-10 animate-pulse rounded-xl bg-surface-2" />
          ) : hours.length > 0 ? (
            <ul className="space-y-1.5">
              {hours.map((line) => (
                <li key={line} className="text-pro-14 text-foreground">
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-pro-14 text-muted-foreground">{t("providerPage.noHours")}</p>
          )}
          <p className="mt-2 text-pro-12 text-muted-foreground">{t("providerPage.hoursHint")}</p>
        </Section>

        <Section
          title={
            reviews.length > 0
              ? t("providerPage.reviewsTitle", { count: reviews.length })
              : t("providerPage.reviewsTitleEmpty")
          }
        >
          {reviewsQ.isError ? (
            <QueryError compact onRetry={() => reviewsQ.refetch()} />
          ) : reviews.length === 0 ? (
            <p className="text-pro-14 text-muted-foreground">{t("providerPage.noReviews")}</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {reviews.slice(0, 5).map((r: any) => (
                <li key={r.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <ProfileAvatar
                        src={r.author_avatar}
                        name={r.author_name || t("providerProfile.anonymous")}
                        className="h-9 w-9 rounded-full text-pro-14"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-pro-14 font-bold text-foreground">
                          {r.author_name || t("providerProfile.anonymous")}
                        </p>
                        <p className="text-pro-12 text-muted-foreground">
                          {formatDate(new Date(r.created_at), {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-pro-13 font-bold">
                      <Star className="h-4 w-4 fill-warning text-warning" aria-hidden="true" />
                      {formatNumber(r.rating)}
                    </span>
                  </div>
                  {r.comment ? (
                    <p className="mt-2 text-pro-14 leading-relaxed text-foreground/85">
                      {r.comment}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {canBook ? (
        <StickyCta
          hint={t("providerProfile.freeCancel")}
          onClick={() => nav({ to: previewBookPath(p.id), search: { serviceId: undefined } })}
        >
          {t("providerProfile.bookWith", { name: firstName })}
        </StickyCta>
      ) : null}
    </PhoneFrame>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-pro-16 font-extrabold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function ProviderProfile() {
  const { id } = Route.useParams();
  return <ProviderProfileContent providerId={id} />;
}
