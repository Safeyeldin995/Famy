import { useState } from "react";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Baby, BookOpen, Check, Sun } from "lucide-react-native";
import {
  applyStepReady,
  initialStepperPrice,
  needsServicePrice,
  type ApplyDraft,
  type ApplyService,
} from "@/lib/provider/applyDraft";
import { localized } from "@/lib/presentation";
import { DocumentUploadCard } from "./DocumentUploadCard";
import { ProviderPriceStepper } from "./ProviderPriceStepper";
import { proCard } from "./cards";
import { Field, ui } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, space } from "@/ui/theme";
import type { PickedFile } from "@/lib/provider/documentUpload";

export function ProviderApplyFlow({
  initial,
  initialStep = 1,
  zones,
  services,
  lockedServices = [],
  onSave,
  onCapture,
}: {
  initial: ApplyDraft;
  initialStep?: 1 | 2 | 3;
  zones: { id: string; name_en: string; name_ar: string }[];
  services: ApplyService[];
  lockedServices?: string[];
  onSave: (step: number, draft: ApplyDraft) => Promise<void>;
  onCapture: (type: "id_card_front" | "id_card_back", file: PickedFile) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [step, setStep] = useState<1 | 2 | 3>(initialStep);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = applyStepReady(step, draft, services);

  const advance = async () => {
    if (busy) return;
    setAttempted(true);
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      await onSave(step, draft);
      if (step < 3) {
        setAttempted(false);
        setStep((step + 1) as 1 | 2 | 3);
      }
    } catch {
      setError(t("providerApply.saveError"));
    } finally {
      setBusy(false);
    }
  };

  const toggleZone = (id: string) =>
    setDraft((d) => ({
      ...d,
      zones: d.zones.includes(id) ? d.zones.filter((z) => z !== id) : [...d.zones, id],
    }));

  const toggleService = (service: ApplyService) => {
    if (lockedServices.includes(service.id)) return;
    setDraft((d) => {
      const on = d.services.includes(service.id);
      return {
        ...d,
        services: on ? d.services.filter((id) => id !== service.id) : [...d.services, service.id],
        prices: {
          ...d.prices,
          [service.id]:
            d.prices[service.id] ??
            initialStepperPrice(service.minimum_price ?? null, service.maximum_price ?? null),
        },
      };
    });
  };

  return (
    <View style={{ gap: space.lg }}>
      {step > 1 ? (
        <Button
          variant="ghost"
          label={t("common.back")}
          disabled={busy}
          onPress={() => {
            setError("");
            setAttempted(false);
            setStep((step - 1) as 1 | 2 | 3);
          }}
        />
      ) : null}
      <Text size="title" weight="heavy">
        {t(`providerApply.${step === 1 ? "welcome" : step === 2 ? "services" : "identity"}`)}
      </Text>
      <Text tone="muted">
        {t(
          `providerApply.${step === 1 ? "welcomeHint" : step === 2 ? "servicesHint" : "identityHint"}`,
        )}
      </Text>

      {step === 1 && (
        <>
          <Field
            label={t("providerApply.name")}
            value={draft.name}
            onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
            editable={!busy}
          />
          {attempted && !draft.name.trim() ? (
            <Text tone="danger" size="sm">
              {t("providerApply.missingBasics")}
            </Text>
          ) : null}
          <Text weight="bold">{t("providerApply.zones")}</Text>
          <View style={ui.wrap}>
            {zones.map((z) => {
              const selected = draft.zones.includes(z.id);
              return (
                <Pressable
                  key={z.id}
                  accessibilityRole="checkbox"
                  accessibilityLabel={localized(z, i18n.language)}
                  accessibilityState={{ checked: selected }}
                  onPress={() => toggleZone(z.id)}
                  style={[
                    ui.choice,
                    selected && {
                      backgroundColor: colors.brandTint,
                      borderColor: colors.brand,
                    },
                  ]}
                >
                  <Text tone={selected ? "brand" : "default"} weight="bold">
                    {localized(z, i18n.language)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {attempted && !draft.zones.length ? (
            <Text tone="danger" size="sm">
              {t("providerApply.missingBasics")}
            </Text>
          ) : null}
        </>
      )}

      {step === 2 && (
        <>
          {services.map((service) => {
            const selected = draft.services.includes(service.id);
            const locked = lockedServices.includes(service.id);
            const Icon =
              service.category?.slug === "tutoring"
                ? BookOpen
                : service.category?.slug === "babysitting"
                  ? Baby
                  : Sun;
            return (
              <View
                key={service.id}
                style={[proCard.card, selected && { borderWidth: 2, borderColor: colors.brand }]}
              >
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={localized(service, i18n.language)}
                  accessibilityState={{ checked: selected, disabled: locked }}
                  onPress={() => toggleService(service)}
                  disabled={busy || locked}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.md,
                    minHeight: 44,
                  }}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: selected ? colors.brandTint : colors.surface2,
                    }}
                  >
                    <Icon size={22} color={selected ? colors.brand : colors.muted} />
                  </View>
                  <Text weight="heavy" style={{ flex: 1 }}>
                    {localized(service, i18n.language)}
                    {locked ? ` (${t("mobilePro.serviceLocked")})` : ""}
                  </Text>
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 8,
                      borderWidth: selected ? 0 : 2,
                      borderColor: colors.border,
                      backgroundColor: selected ? colors.brand : colors.surface,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {selected ? <Check size={14} color={colors.brandForeground} /> : null}
                  </View>
                </Pressable>
                {selected && service.category?.slug === "tutoring" ? (
                  <Text size="xs" tone="muted">
                    {t("providerApply.teachingLater")}
                  </Text>
                ) : null}
                {selected && needsServicePrice(service) ? (
                  <ProviderPriceStepper
                    min={service.minimum_price ?? null}
                    max={service.maximum_price ?? null}
                    value={draft.prices[service.id] ?? null}
                    onChange={(price) =>
                      setDraft((d) => ({
                        ...d,
                        prices: { ...d.prices, [service.id]: price },
                      }))
                    }
                    disabled={busy}
                  />
                ) : null}
              </View>
            );
          })}
          {attempted && !draft.services.length ? (
            <Text tone="danger" size="sm">
              {t("providerApply.missingServices")}
            </Text>
          ) : null}
        </>
      )}

      {step === 3 && (
        <>
          <DocumentUploadCard
            title={t("providerDocuments.id_card_front")}
            statusLabel={t(`providerDocuments.${draft.front ? "pending" : "missing"}`)}
            captured={draft.front}
            disabled={busy}
            onPick={async (file) => {
              await onCapture("id_card_front", file);
              setDraft((d) => ({ ...d, front: true }));
            }}
          />
          <DocumentUploadCard
            title={t("providerDocuments.id_card_back")}
            statusLabel={t(`providerDocuments.${draft.back ? "pending" : "missing"}`)}
            captured={draft.back}
            disabled={busy}
            onPick={async (file) => {
              await onCapture("id_card_back", file);
              setDraft((d) => ({ ...d, back: true }));
            }}
          />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={t("providerApply.agreement")}
            accessibilityState={{ checked: draft.agreed }}
            onPress={() => setDraft((d) => ({ ...d, agreed: !d.agreed }))}
            style={[proCard.card, { flexDirection: "row", gap: space.md, alignItems: "center" }]}
          >
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                borderWidth: 2,
                borderColor: draft.agreed ? colors.brand : colors.border,
                backgroundColor: draft.agreed ? colors.brand : "transparent",
              }}
            />
            <Text style={{ flex: 1 }}>{t("providerApply.agreement")}</Text>
          </Pressable>
        </>
      )}

      {error ? <Text tone="danger">{error}</Text> : null}
      <Button
        label={t(step === 3 ? "providerApply.submit" : "providerApply.continue")}
        loading={busy}
        disabled={!ready && attempted}
        onPress={() => void advance()}
      />
    </View>
  );
}
