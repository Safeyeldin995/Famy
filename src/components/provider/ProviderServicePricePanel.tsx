import {
  ServicePricePicker,
  isPriceInRange,
  isSavedPriceOutOfRange,
} from "@/components/provider/ServicePricePicker";
import { profilePriceDirty } from "@/lib/provider/profilePriceDirty";
import {
  providerPriceChangeDirty,
  providerPriceNeedsAdminReview,
} from "@/lib/provider/providerPriceChangeRequest";
import { useTranslation } from "react-i18next";

type Props = {
  serviceId: string;
  onboardingStatus: string;
  serviceStatus: string;
  min: number | null;
  max: number | null;
  livePrice: number | null;
  pendingPrice: number | null;
  rejectionReason: string | null;
  draft: number | null | undefined;
  unitLabel: string;
  onDraftChange: (price: number) => void;
  onSaveDirect: () => void;
  onRequestChange: () => void;
  onCancelRequest: () => void;
  savePending: boolean;
  cancelPending: boolean;
  errorMessage?: string;
};

export function ProviderServicePricePanel({
  serviceId,
  onboardingStatus,
  serviceStatus,
  min,
  max,
  livePrice,
  pendingPrice,
  rejectionReason,
  draft,
  unitLabel,
  onDraftChange,
  onSaveDirect,
  onRequestChange,
  onCancelRequest,
  savePending,
  cancelPending,
  errorMessage,
}: Props) {
  const { t } = useTranslation();
  const needsReview = providerPriceNeedsAdminReview(onboardingStatus, serviceStatus);
  const pickerValue = draft ?? pendingPrice ?? livePrice ?? null;

  return (
    <div id={`price-${serviceId}`} className="mt-2 min-w-0 scroll-mt-4 space-y-2">
      {isSavedPriceOutOfRange(livePrice, min, max) && (
        <p className="rounded-xl bg-amber-100 p-2 text-xs font-semibold text-amber-800">
          {t("pricePicker.outOfRange")}
        </p>
      )}
      {rejectionReason && !pendingPrice ? (
        <p className="rounded-xl bg-coral/10 p-2 text-xs font-semibold text-coral">
          {t("pro.profile.priceChangeRejected", { reason: rejectionReason })}
        </p>
      ) : null}
      {pendingPrice != null ? (
        <p className="rounded-xl bg-brand/10 p-2 text-xs font-semibold text-brand">
          {t("pro.profile.priceChangePending", {
            requested: pendingPrice,
            current: livePrice ?? "—",
          })}
        </p>
      ) : null}
      <ServicePricePicker
        min={min}
        max={max}
        value={pickerValue}
        onChange={onDraftChange}
        unitLabel={unitLabel}
        disabled={pendingPrice != null}
      />
      {needsReview ? (
        <>
          {pendingPrice != null ? (
            <button
              type="button"
              onClick={onCancelRequest}
              disabled={cancelPending}
              className="min-h-11 rounded-lg border border-border px-3 py-2 text-xs font-bold disabled:opacity-50"
            >
              {t("pro.profile.cancelPriceChange")}
            </button>
          ) : providerPriceChangeDirty(draft, livePrice, pendingPrice) ? (
            <button
              type="button"
              onClick={onRequestChange}
              disabled={savePending || !isPriceInRange(draft, min, max)}
              className="min-h-11 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-brand-foreground disabled:opacity-50"
            >
              {t("pro.profile.requestPriceChange")}
            </button>
          ) : null}
        </>
      ) : profilePriceDirty(draft ?? undefined, livePrice) ? (
        <button
          type="button"
          onClick={onSaveDirect}
          disabled={savePending || !isPriceInRange(draft, min, max)}
          className="min-h-11 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-brand-foreground disabled:opacity-50"
        >
          {t("common.save")}
        </button>
      ) : null}
      {errorMessage ? <p className="text-pro-12 font-semibold text-coral">{errorMessage}</p> : null}
    </div>
  );
}
