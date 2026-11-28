import { hasSelectedServicePrices, needsServicePrice } from "@shared/provider/priceOptions";
import { buildPriceOptions } from "@shared/provider/priceOptions";
import {
  applyBasicsReady,
  normalizeApplyWorkMode,
  serviceAllowedForMode,
  servicesForMode,
  type ApplyWorkMode,
} from "@shared/provider/applyWorkMode";

export type ApplyService = {
  id: string;
  slug?: string | null;
  name_en: string;
  name_ar: string;
  category?: { slug?: string | null; online_allowed?: boolean | null } | null;
  online_allowed?: boolean | null;
  provider_pricing_allowed?: boolean | null;
  minimum_price?: number | null;
  maximum_price?: number | null;
};

export type ApplyDraft = {
  name: string;
  /** How the provider will work; online only needs no service zone. */
  mode: ApplyWorkMode;
  /** Governorate of residence (code); required when working online. */
  governorate: string;
  zones: string[];
  services: string[];
  prices: Record<string, number | null>;
  front: boolean;
  back: boolean;
  agreed: boolean;
};

export function applyStepReady(step: number, draft: ApplyDraft, services: ApplyService[]) {
  if (step === 1) return applyBasicsReady(draft);
  if (step === 2) {
    return (
      draft.services.length > 0 && hasSelectedServicePrices(services, draft.services, draft.prices)
    );
  }
  return draft.front && draft.back && draft.agreed;
}

export function initialStepperPrice(min: number | null, max: number | null) {
  const options = buildPriceOptions(min, max);
  if (!options.length) return Math.min(max ?? Infinity, Math.max(50, min ?? 50));
  const midpoint = (min! + max!) / 2;
  return options.reduce((best, price) =>
    Math.abs(price - midpoint) < Math.abs(best - midpoint) ? price : best,
  );
}

export { needsServicePrice, normalizeApplyWorkMode, serviceAllowedForMode, servicesForMode };
export type { ApplyWorkMode };
