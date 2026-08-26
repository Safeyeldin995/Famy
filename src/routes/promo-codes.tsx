import { createFileRoute } from "@tanstack/react-router";
import { Copy, Tag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { EmptyState, PhoneFrame, StatusPill, TopBar } from "@/components/famio/ui";
import { ICON_STROKE } from "@/lib/icons/constants";
import {
  useFeaturedPromoCodes,
  useMyPromoRedemptions,
  type FeaturedPromoCode,
  type PromoRedemptionRow,
} from "@/lib/db/promo-codes-queries";
import { promoDescription, promoDiscountLabel, promoExpiryLabel } from "@/lib/promo/display";
import { formatDate, formatEGP } from "@/lib/utils";

export const Route = createFileRoute("/promo-codes")({ component: PromoCodes });

async function copyPromoCode(code: string, t: ReturnType<typeof useTranslation>["t"]) {
  try {
    await navigator.clipboard.writeText(code);
    toast.success(t("promoCodes.copied", { code }));
  } catch {
    toast.error(t("promoCodes.copyError"));
  }
}

function AvailablePromoCard({ offer }: { offer: FeaturedPromoCode }) {
  const { t, i18n } = useTranslation();
  const description = promoDescription(offer, i18n.language);
  const discount = promoDiscountLabel(offer, t);
  const expiry = promoExpiryLabel(offer.expires_at, t);

  return (
    <div className="rounded-[1.25rem] border border-border/60 bg-surface-elevated p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-extrabold text-foreground">{discount}</p>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
          {expiry ? <p className="mt-2 text-xs font-semibold text-muted-foreground">{expiry}</p> : null}
          {offer.minimum_booking_amount > 0 ? (
            <p className="mt-1 text-xs font-semibold text-muted-foreground">
              {t("promoCodes.minSpend", { amount: formatEGP(offer.minimum_booking_amount) })}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void copyPromoCode(offer.code, t)}
          aria-label={t("promoCodes.copyCode")}
          className="focus-ring tap-scale inline-flex shrink-0 items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-[11px] font-bold text-brand-foreground"
          dir="ltr"
        >
          {offer.code}
          <Copy className="h-3.5 w-3.5" strokeWidth={ICON_STROKE} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function UsedPromoRow({ row }: { row: PromoRedemptionRow }) {
  const { t, i18n } = useTranslation();
  const code = row.bookings?.promo_code ?? "—";
  const description = row.bookings
    ? promoDescription(
        {
          description_en: row.bookings.promo_description_en,
          description_ar: row.bookings.promo_description_ar,
        },
        i18n.language,
      )
    : null;

  return (
    <div className="rounded-[1.25rem] border border-border/60 bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-extrabold text-foreground" dir="ltr">{code}</span>
            <StatusPill tone="muted">{t("promoCodes.used")}</StatusPill>
          </div>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
          <p className="mt-2 text-xs font-semibold text-muted-foreground">
            {formatDate(new Date(row.redeemed_at), { day: "numeric", month: "short", year: "numeric" })}
            {" · "}
            {formatEGP(row.discount_amount)}
          </p>
        </div>
      </div>
    </div>
  );
}

function PromoCodes() {
  const { t } = useTranslation();
  const availableQ = useFeaturedPromoCodes();
  const historyQ = useMyPromoRedemptions();
  const available = availableQ.data ?? [];
  const history = historyQ.data ?? [];

  return (
    <PhoneFrame bg="bg-background">
      <TopBar back={{ to: "/profile" }} title={t("promoCodes.title")} />
      <div className="flex-1 space-y-8 px-5 pb-10">
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Tag className="h-4 w-4 text-brand" strokeWidth={ICON_STROKE} aria-hidden="true" />
            <h2 className="text-sm font-extrabold uppercase tracking-widest text-muted-foreground">
              {t("promoCodes.available")}
            </h2>
          </div>
          {availableQ.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-[1.25rem] bg-surface-2" />
              ))}
            </div>
          ) : availableQ.isError ? (
            <EmptyState icon="alert" title={t("common.errorTitle", "Something went wrong")} body={t("common.tryAgain", "Please try again.")} />
          ) : available.length === 0 ? (
            <EmptyState icon="default" title={t("promoCodes.availableEmpty")} body={t("promoCodes.availableEmptyBody")} />
          ) : (
            <div className="space-y-3">
              {available.map((offer) => (
                <AvailablePromoCard key={offer.id} offer={offer} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-extrabold uppercase tracking-widest text-muted-foreground">
            {t("promoCodes.history")}
          </h2>
          {historyQ.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-[1.25rem] bg-surface-2" />
              ))}
            </div>
          ) : historyQ.isError ? (
            <EmptyState icon="alert" title={t("common.errorTitle", "Something went wrong")} body={t("common.tryAgain", "Please try again.")} />
          ) : history.length === 0 ? (
            <EmptyState icon="default" title={t("promoCodes.historyEmpty")} body={t("promoCodes.historyEmptyBody")} />
          ) : (
            <div className="space-y-3">
              {history.map((row) => (
                <UsedPromoRow key={row.id} row={row} />
              ))}
            </div>
          )}
        </section>
      </div>
    </PhoneFrame>
  );
}
