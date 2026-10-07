import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Baby, BookOpen, Check, LockKeyhole, Sun } from "lucide-react";
import { StepHeader } from "@/components/famio/StepHeader";
import { StickyCta } from "@/components/famio/StickyCta";
import { TextField } from "@/components/famio/TextField";
import { CheckChip } from "@/components/famio/CheckChip";
import { ServiceCard } from "@/components/famio/ServiceCard";
import { PriceStepper, initialStepperPrice } from "@/components/famio/PriceStepper";
import { IdCaptureCard } from "@/components/famio/IdCaptureCard";
import { hasSelectedServicePrices, needsServicePrice } from "@/lib/provider/priceOptions";
import { isFixedPackage, servicePriceUnit } from "@/lib/pricing/servicePackages";
import { applyServiceSubtitle } from "@/lib/provider/applyServiceSubtitle";

export type ApplyService = {
  id: string;
  name_en: string;
  name_ar: string;
  category?: { slug?: string | null } | null;
  provider_pricing_allowed?: boolean | null;
  minimum_price?: number | null;
  maximum_price?: number | null;
  pricing_model?: string | null;
  duration_min?: number | null;
  fixed_start_time?: string | null;
};
export type ApplyDraft = {
  name: string;
  zones: string[];
  services: string[];
  prices: Record<string, number | null>;
  front: boolean;
  back: boolean;
  agreed: boolean;
};
export function applyStepReady(step: number, draft: ApplyDraft, services: ApplyService[]) {
  if (step === 1) return !!draft.name.trim() && draft.zones.length > 0;
  if (step === 2)
    return (
      draft.services.length > 0 && hasSelectedServicePrices(services, draft.services, draft.prices)
    );
  return draft.front && draft.back && draft.agreed;
}
export function ProviderApplyFlow({
  initial,
  zones,
  services,
  lockedServices = [],
  onSave,
  onCapture,
}: {
  initial: ApplyDraft;
  zones: { id: string; name_en: string; name_ar: string }[];
  services: ApplyService[];
  lockedServices?: string[];
  onSave: (step: number, draft: ApplyDraft) => Promise<void>;
  onCapture: (type: "id_card_front" | "id_card_back", file: File) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ar = i18n.language.startsWith("ar");
  const ready = applyStepReady(step, draft, services);
  const advance = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSave(step, draft);
      if (step < 3) setStep(step + 1);
    } catch {
      setError(t("providerApply.saveError"));
    } finally {
      setBusy(false);
    }
  };
  const capture = async (type: "id_card_front" | "id_card_back", file: File) => {
    setBusy(true);
    setError("");
    try {
      await onCapture(type, file);
      setDraft((d) => ({ ...d, [type === "id_card_front" ? "front" : "back"]: true }));
    } catch {
      setError(t("providerApply.saveError"));
    } finally {
      setBusy(false);
    }
  };
  const toggleService = (service: ApplyService) =>
    setDraft((d) => ({
      ...d,
      services: d.services.includes(service.id)
        ? d.services.filter((id) => id !== service.id)
        : [...d.services, service.id],
      prices: {
        ...d.prices,
        [service.id]:
          d.prices[service.id] ??
          initialStepperPrice(service.minimum_price ?? null, service.maximum_price ?? null),
      },
    }));
  return (
    <main className="apply-ui apply-screen" dir={ar ? "rtl" : "ltr"}>
      <StepHeader
        step={step}
        onBack={
          step > 1 && !busy
            ? () => {
                setError("");
                setStep(step - 1);
              }
            : undefined
        }
      />
      <div className="apply-content">
        <h1 className="apply-title">
          {t(`providerApply.${step === 1 ? "welcome" : step === 2 ? "services" : "identity"}`)}
        </h1>
        <p className="apply-subtitle">
          {t(
            `providerApply.${step === 1 ? "welcomeHint" : step === 2 ? "servicesHint" : "identityHint"}`,
          )}
        </p>
        {step === 1 && (
          <>
            <TextField
              autoComplete="name"
              label={t("providerApply.name")}
              value={draft.name}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
            <div>
              <span className="apply-label">{t("providerApply.zones")}</span>
              <div className="apply-chips">
                {zones.map((zone) => (
                  <CheckChip
                    key={zone.id}
                    selected={draft.zones.includes(zone.id)}
                    disabled={busy}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        zones: d.zones.includes(zone.id)
                          ? d.zones.filter((id) => id !== zone.id)
                          : [...d.zones, zone.id],
                      }))
                    }
                  >
                    {ar ? zone.name_ar : zone.name_en}
                  </CheckChip>
                ))}
              </div>
              <p className="mt-2 text-[12.5px] text-muted-foreground">
                {t("providerApply.zonesHint")}
              </p>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            {services.length === 0 && <p>{t("providerApply.noServices")}</p>}
            {services.map((service) => {
              const tutoring = service.category?.slug === "tutoring";
              const fixed = isFixedPackage(service);
              const unit = servicePriceUnit(service);
              const unitText = tutoring ? t("pricePicker.sessionUnit") : t(unit.key, unit.values);
              return (
                <ServiceCard
                  key={service.id}
                  title={ar ? service.name_ar : service.name_en}
                  subtitle={applyServiceSubtitle(service, t)}
                  selected={draft.services.includes(service.id)}
                  disabled={busy || lockedServices.includes(service.id)}
                  onClick={() => toggleService(service)}
                  icon={
                    tutoring ? (
                      <BookOpen size={22} />
                    ) : fixed ? (
                      <Sun size={22} />
                    ) : (
                      <Baby size={22} />
                    )
                  }
                >
                  {tutoring ? (
                    <p className="text-xs text-muted-foreground">
                      {t("providerApply.teachingLater")}
                    </p>
                  ) : needsServicePrice(service) ? (
                    <PriceStepper
                      min={service.minimum_price ?? null}
                      max={service.maximum_price ?? null}
                      value={draft.prices[service.id] ?? null}
                      onChange={(price) =>
                        setDraft((d) => ({ ...d, prices: { ...d.prices, [service.id]: price } }))
                      }
                      unitLabel={unitText}
                      disabled={busy}
                    />
                  ) : null}
                </ServiceCard>
              );
            })}
          </>
        )}
        {step === 3 && (
          <>
            <IdCaptureCard
              title={t("providerApply.front")}
              captured={draft.front}
              disabled={busy}
              onCapture={(file) => void capture("id_card_front", file)}
            />
            <IdCaptureCard
              title={t("providerApply.back")}
              captured={draft.back}
              disabled={busy}
              onCapture={(file) => void capture("id_card_back", file)}
            />
            <p className="apply-note">
              <LockKeyhole size={18} className="shrink-0" />
              {t("providerApply.privacy")}
            </p>
            <label className="apply-agree">
              <input
                className="sr-only"
                type="checkbox"
                disabled={busy}
                checked={draft.agreed}
                onChange={(e) => setDraft((d) => ({ ...d, agreed: e.target.checked }))}
              />
              <span className={`apply-checkbox ${draft.agreed ? "on" : ""}`}>
                {draft.agreed && <Check size={14} />}
              </span>
              {t("providerApply.agreement")}
            </label>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-coral">
            {error}
          </p>
        )}
      </div>
      <StickyCta
        disabled={!ready || busy}
        onClick={() => void advance()}
        hint={
          !ready
            ? t(
                `providerApply.${step === 1 ? "missingBasics" : step === 2 ? "missingServices" : "missingIdentity"}`,
              )
            : undefined
        }
      >
        {t(
          busy
            ? "providerApply.saving"
            : step === 3
              ? "providerApply.submit"
              : "providerApply.next",
        )}
      </StickyCta>
    </main>
  );
}
