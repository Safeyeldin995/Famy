import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import type { Provider } from "@/lib/mock/data";
import { useTranslation } from "react-i18next";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { ProviderRatingMeta } from "./ProviderListRow";
import { isPreviewRoute } from "@/lib/preview/constants";
import { formatEGP } from "@/lib/format";
import { customerRoleLabel } from "./customerProviders";

export function ProviderCard({
  p,
  subtitle,
  categoryLabel,
}: {
  p: Provider & { categorySlugs?: string[] };
  subtitle?: string;
  categoryLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <Link
      to={isPreviewRoute() ? "/preview/provider/$id" : "/provider/$id"}
      params={{ id: p.id }}
      className="focus-ring block min-h-11 rounded-2xl border border-border/60 bg-white p-4"
    >
      <div className="flex items-start gap-3">
        <ProfileAvatar
          src={p.avatar}
          name={p.name}
          className="h-14 w-14 rounded-full text-pro-18"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="break-words text-pro-16 font-bold">
              {p.name || t("provider2.unnamed")}
            </h3>
            {p.badges.includes("ID Verified") && (
              <ShieldCheck
                className="h-4 w-4 shrink-0 text-success"
                aria-label={t("common.verified")}
              />
            )}
          </div>
          <p className="mt-1 text-pro-13 text-muted-foreground">
            {categoryLabel || customerRoleLabel(p.categorySlugs ?? [p.category], t)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1 text-pro-12 text-muted-foreground">
            <ProviderRatingMeta rating={p.rating} reviews={p.reviews} />
          </div>
          <p className="mt-2 text-pro-14 font-bold">
            {subtitle || formatEGP(p.hourlyRate, { perHour: true })}
          </p>
        </div>
      </div>
    </Link>
  );
}

export function ProviderTile({ p }: { p: Provider }) {
  return (
    <div className="w-64 shrink-0">
      <ProviderCard p={p} />
    </div>
  );
}
