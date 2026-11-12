import { useCallback, useState } from "react";
import { Drawer } from "vaul";
import { ChevronDown, Tag, X, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { latinCustomerText } from "@/components/famio/customerProviders";
import { TextField } from "@/components/famio/TextField";
import { ICON_STROKE } from "@/lib/icons/constants";
import {
  useFeaturedPromoCodes,
  validatePromoCode,
  type FeaturedPromoCode,
} from "@/lib/db/promo-codes-queries";
import { promoDescription, promoDiscountLabel } from "@/lib/promo/display";
import { formatEGP } from "@/lib/format";
import "@/components/famio/providerApply.css";

export type AppliedCheckoutPromo = { id: string; discount: number; code: string };

export function CheckoutPromoPicker({
  serviceId,
  subtotal,
  applied,
  onApplied,
  bookingError,
  onClearBookingError,
}: {
  serviceId: string;
  subtotal: number;
  applied: AppliedCheckoutPromo | null;
  onApplied: (value: AppliedCheckoutPromo | null) => void;
  bookingError?: string;
  onClearBookingError?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const promos = useFeaturedPromoCodes();
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState("");
  const [checking, setChecking] = useState(false);
  const [sheetError, setSheetError] = useState("");
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const applyCode = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      setChecking(true);
      setSheetError("");
      onClearBookingError?.();
      try {
        const result = await validatePromoCode(trimmed, serviceId, subtotal);
        if (result.ok) {
          onApplied({ id: result.promo_code_id, discount: result.discount_amount, code: trimmed });
          setManual("");
          setOpen(false);
        } else {
          setSheetError(
            t(`bookFlow.promoError.${result.reason}`, t("bookFlow.promoError.not_found")),
          );
        }
      } catch {
        setSheetError(t("common.somethingWentWrong"));
      } finally {
        setChecking(false);
        setApplyingId(null);
      }
    },
    [onApplied, onClearBookingError, serviceId, subtotal, t],
  );

  const remove = () => {
    onApplied(null);
    setManual("");
    setSheetError("");
    onClearBookingError?.();
  };

  return (
    <div className="mb-4">
    {applied ? (
      <div className="flex items-center gap-2 rounded-2xl border border-brand/30 bg-brand/10 px-4 py-3">
        <Tag className="h-4 w-4 shrink-0 text-brand" strokeWidth={ICON_STROKE} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-pro-14 font-extrabold" dir="ltr">
            {applied.code}
          </p>
          <p className="text-pro-12 text-muted-foreground">
            {t("bookFlow.promoApplied", { amount: formatEGP(applied.discount) })}
          </p>
        </div>
        <button
          type="button"
          onClick={remove}
          aria-label={t("bookFlow.promoRemove")}
          className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/60"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    ) : (
      <button
        type="button"
        onClick={() => {
          setManual("");
          setSheetError("");
          setOpen(true);
        }}
        className="focus-ring flex w-full items-center justify-between rounded-2xl border border-border/60 bg-surface-2 px-4 py-3 text-pro-14 font-extrabold"
      >
        {t("customerBooking.promo")}
        <ChevronDown className="h-4 w-4 text-muted-foreground" strokeWidth={ICON_STROKE} />
      </button>
    )}
    {bookingError ? (
      <p className="mt-2 text-pro-12 font-semibold text-destructive" role="alert">
        {bookingError}
      </p>
    ) : null}
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-[rgba(15,13,16,.42)]" />
        <Drawer.Content
          className="apply-ui apply-sheet"
          dir={i18n?.dir?.() ?? "rtl"}
          aria-describedby={undefined}
        >
          <div className="apply-grab" />
          <div className="flex items-center justify-between">
            <Drawer.Title className="text-[18px] font-extrabold">
              {t("customerBooking.promo")}
            </Drawer.Title>
            <Drawer.Close className="apply-back" aria-label={t("providerApply.close")}>
              <X size={18} />
            </Drawer.Close>
          </div>
          <p className="text-pro-12 font-extrabold uppercase tracking-widest text-muted-foreground">
            {t("bookFlow.promoAvailableTitle")}
          </p>
          <div className="max-h-[42vh] space-y-3 overflow-y-auto">
            {promos.isLoading ? (
              <div className="h-24 animate-pulse rounded-2xl bg-surface-2" />
            ) : promos.isError ? (
              <p className="text-pro-13 text-muted-foreground">{t("common.tryAgain")}</p>
            ) : !promos.data?.length ? (
              <p className="text-pro-13 text-muted-foreground">{t("promoCodes.availableEmptyBody")}</p>
            ) : (
              promos.data.map((offer) => (
                <CheckoutPromoOfferCard
                  key={offer.id}
                  offer={offer}
                  busy={applyingId === offer.id}
                  onUse={() => {
                    setApplyingId(offer.id);
                    void applyCode(offer.code);
                  }}
                />
              ))
            )}
          </div>
          <div className="space-y-2 pt-2">
            <TextField
              label={t("bookFlow.promoPlaceholder")}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder={t("bookFlow.promoPlaceholder")}
              disabled={checking}
            />
            {sheetError ? (
              <p className="text-pro-12 font-semibold text-destructive" role="alert">
                {sheetError}
              </p>
            ) : null}
            <button
              type="button"
              disabled={!manual.trim() || checking}
              onClick={() => void applyCode(manual)}
              className="focus-ring flex h-12 w-full items-center justify-center rounded-full bg-brand text-pro-14 font-extrabold text-brand-foreground disabled:opacity-50"
            >
              {checking && !applyingId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("bookFlow.promoApply")
              )}
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
    </div>
  );
}

function CheckoutPromoOfferCard({
  offer,
  onUse,
  busy,
}: {
  offer: FeaturedPromoCode;
  onUse: () => void;
  busy: boolean;
}) {
  const { t, i18n } = useTranslation();
  const description = promoDescription(offer, i18n.language);
  const discount = promoDiscountLabel(offer, t);
  return (
    <div className="rounded-2xl border border-border/50 bg-surface-2 p-4">
      <p className="font-mono text-pro-14 font-extrabold" dir="ltr">
        {offer.code}
      </p>
      <p className="mt-1 text-pro-14 font-extrabold text-brand">{discount}</p>
      {description ? (
        <p className="mt-1 text-pro-13 text-muted-foreground">{latinCustomerText(description)}</p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={onUse}
        className="focus-ring tap-scale mt-3 inline-flex min-h-10 items-center rounded-full border border-border bg-surface px-4 text-pro-12 font-extrabold disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("bookFlow.promoUse")}
      </button>
    </div>
  );
}
