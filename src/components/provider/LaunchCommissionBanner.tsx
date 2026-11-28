import { useTranslation } from "react-i18next";
import { BadgePercent } from "lucide-react";
import { useMyLaunchCommission } from "@/lib/db/launch-offers-queries";
import { launchCommissionLastDay, launchCommissionPercentLabel } from "@/lib/offers/launchOffers";

/** «عمولتك أقل لحد {date}» while the new-tutor commission applies. */
export function LaunchCommissionBanner({ enabled = true }: { enabled?: boolean }) {
  const { t, i18n } = useTranslation();
  const q = useMyLaunchCommission(enabled);
  if (!q.data || !q.data.active) return null;
  const percent = launchCommissionPercentLabel(q.data);
  return (
    <section
      aria-label={t("launchCommission.banner", {
        date: launchCommissionLastDay(q.data.ends_at, i18n.language),
      })}
      className="flex items-start gap-3 rounded-2xl border border-success/30 bg-success/10 p-4"
    >
      <BadgePercent className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
      <div className="min-w-0">
        <p className="text-pro-14 font-extrabold text-foreground">
          {t("launchCommission.banner", {
            date: launchCommissionLastDay(q.data.ends_at, i18n.language),
          })}
        </p>
        {percent ? (
          <p className="mt-0.5 text-pro-12 text-muted-foreground">
            {t("launchCommission.bannerRate", { percent })}
          </p>
        ) : null}
      </div>
    </section>
  );
}
