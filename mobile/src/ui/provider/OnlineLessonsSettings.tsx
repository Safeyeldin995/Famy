import { useMemo, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { isPriceInRange } from "@shared/provider/priceOptions";
import {
  isOfferingModeOptionDisabled,
  isOfferingModeSaveAllowed,
  normalizeOfferingMode,
  type ProviderOfferingMode,
} from "@shared/online/offeringMode";
import { isTutoringCategorySlug } from "@/lib/tutoring/teachingCapabilities";
import { localized, money } from "@/lib/presentation";
import {
  useCancelOnlinePriceChange,
  useRequestOnlinePriceChange,
  useSetOnlineServicePrice,
  useUpdateOfferingMode,
  useUpdateTeachingOnlinePrice,
} from "@/lib/provider/onlineLessonQueries";
import { ProviderPriceStepper } from "./ProviderPriceStepper";
import { BottomSheetSelect } from "./BottomSheetSelect";
import { proCard } from "./cards";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { ActionError } from "@/ui/Page";
import { space } from "@/ui/theme";

type ServiceRow = {
  service_id: string;
  status?: string;
  price_override?: number | null;
  online_price_override?: number | null;
  pending_online_price_override?: number | null;
  online_price_change_reason?: string | null;
  service?: {
    name_en?: string;
    name_ar?: string;
    online_allowed?: boolean;
    minimum_price?: number | null;
    maximum_price?: number | null;
    category?: { slug?: string; online_allowed?: boolean };
  } | null;
};

type CapRow = {
  id: string;
  service_id: string;
  session_price: number;
  online_session_price?: number | null;
  status: string;
  subject?: { name_en?: string; name_ar?: string } | null;
  level?: { name_en?: string; name_ar?: string } | null;
};

const MODE_OPTIONS: ProviderOfferingMode[] = ["in_person", "online", "both"];

export function OnlineLessonsSettings({
  providerId,
  isVerified,
  isApproved,
  offeringMode,
  services,
  capabilities,
}: {
  providerId: string;
  isVerified: boolean;
  isApproved: boolean;
  offeringMode: string | null | undefined;
  services: ServiceRow[];
  capabilities: CapRow[];
}) {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<ProviderOfferingMode>(normalizeOfferingMode(offeringMode));
  const [priceDrafts, setPriceDrafts] = useState<Record<string, number>>({});
  const [capDrafts, setCapDrafts] = useState<Record<string, number>>({});
  const [success, setSuccess] = useState("");
  const [actionError, setActionError] = useState(false);
  const saveMode = useUpdateOfferingMode();
  const setOnlinePrice = useSetOnlineServicePrice();
  const requestOnlinePrice = useRequestOnlinePriceChange();
  const cancelOnlinePrice = useCancelOnlinePriceChange();
  const saveCapPrice = useUpdateTeachingOnlinePrice();

  const onlineReady = useMemo(
    () =>
      services.filter(
        (row) =>
          row.status === "approved" &&
          row.service?.online_allowed &&
          row.service.category?.online_allowed,
      ),
    [services],
  );

  const approvedCaps = useMemo(
    () => capabilities.filter((row) => row.status === "approved"),
    [capabilities],
  );

  const canEnableOnline = isVerified && isApproved && onlineReady.length > 0;

  const modeOptions = MODE_OPTIONS.map((value) => ({
    value,
    label: t(
      `pro.onlineLessons.mode${value === "in_person" ? "InPerson" : value === "online" ? "Online" : "Both"}`,
    ),
    disabled: isOfferingModeOptionDisabled(value, canEnableOnline),
  }));

  const persistMode = async () => {
    setActionError(false);
    setSuccess("");
    if (!isOfferingModeSaveAllowed(mode, canEnableOnline)) {
      setActionError(true);
      return;
    }
    try {
      await saveMode.mutateAsync(mode);
      setSuccess(t("pro.onlineLessons.modeSaved"));
    } catch {
      setActionError(true);
    }
  };

  const saveServiceOnlinePrice = async (row: ServiceRow) => {
    const service = row.service;
    if (!service) return;
    const id = row.service_id;
    const min = service.minimum_price ?? 0;
    const max = service.maximum_price ?? null;
    const current =
      priceDrafts[id] ??
      row.pending_online_price_override ??
      row.online_price_override ??
      row.price_override ??
      min;
    if (!isPriceInRange(current, min, max)) {
      setActionError(true);
      return;
    }
    setActionError(false);
    setSuccess("");
    try {
      if (isApproved) {
        await requestOnlinePrice.mutateAsync({ providerId, serviceId: id, price: current });
        setSuccess(t("pro.onlineLessons.onlinePriceChangeSubmitted"));
      } else {
        await setOnlinePrice.mutateAsync({ providerId, serviceId: id, price: current });
        setSuccess(t("pro.onlineLessons.onlinePriceSaved"));
      }
    } catch {
      setActionError(true);
    }
  };

  const saveCapabilityOnlinePrice = async (cap: CapRow) => {
    const service = onlineReady.find((row) => row.service_id === cap.service_id)?.service;
    const min = service?.minimum_price ?? 0;
    const max = service?.maximum_price ?? null;
    const current = capDrafts[cap.id] ?? cap.online_session_price ?? cap.session_price;
    if (!isPriceInRange(current, min, max)) {
      setActionError(true);
      return;
    }
    setActionError(false);
    setSuccess("");
    try {
      await saveCapPrice.mutateAsync({
        providerId,
        capabilityId: cap.id,
        price: cap.online_session_price == null && current === cap.session_price ? null : current,
      });
      setSuccess(t("pro.onlineLessons.onlinePriceSaved"));
    } catch {
      setActionError(true);
    }
  };

  if (onlineReady.length === 0) {
    return (
      <View style={[proCard.card, { gap: space.md }]}>
        <Text weight="bold">{t("pro.onlineLessons.emptyTitle")}</Text>
        <Text tone="muted">{t("pro.onlineLessons.emptyBody")}</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: space.lg }}>
      <View style={[proCard.card, { gap: space.sm }]}>
        <Text weight="bold">{t("pro.onlineLessons.helpTitle")}</Text>
        <Text tone="muted">{t("pro.onlineLessons.helpBody")}</Text>
      </View>

      <View style={[proCard.card, { gap: space.md }]}>
        <Text weight="bold">{t("pro.onlineLessons.modeLabel")}</Text>
        <Text tone="muted" size="sm">
          {t("pro.onlineLessons.modeHint")}
        </Text>
        {!canEnableOnline ? (
          <Text tone="muted" size="sm">
            {t("pro.onlineLessons.verifyRequired")}
          </Text>
        ) : null}
        <BottomSheetSelect
          label={t("pro.onlineLessons.modeLabel")}
          value={mode}
          options={modeOptions}
          onChange={(value) => setMode(value as ProviderOfferingMode)}
        />
        <Button
          label={t("pro.onlineLessons.saveMode")}
          loading={saveMode.isPending}
          onPress={() => void persistMode()}
        />
      </View>

      {approvedCaps.map((cap) => {
        const service = onlineReady.find((row) => row.service_id === cap.service_id)?.service;
        const label = [
          localized(cap.subject, i18n.language),
          localized(cap.level, i18n.language),
        ]
          .filter(Boolean)
          .join(" · ");
        const current = capDrafts[cap.id] ?? cap.online_session_price ?? cap.session_price;
        return (
          <View key={cap.id} style={[proCard.card, { gap: space.md }]}>
            <Text weight="bold">{label}</Text>
            {cap.online_session_price == null ? (
              <Text tone="muted" size="sm">
                {t("pro.onlineLessons.usesInPersonPrice", {
                  price: money(cap.session_price, i18n.language),
                })}
              </Text>
            ) : null}
            <ProviderPriceStepper
              value={current}
              min={service?.minimum_price ?? null}
              max={service?.maximum_price ?? null}
              onChange={(next) => setCapDrafts((d) => ({ ...d, [cap.id]: next }))}
            />
            <Button
              label={t("pro.common.save")}
              loading={saveCapPrice.isPending}
              onPress={() => void saveCapabilityOnlinePrice(cap)}
            />
          </View>
        );
      })}

      {onlineReady
        .filter((row) => !isTutoringCategorySlug(row.service?.category?.slug))
        .map((row) => {
          const service = row.service!;
          const id = row.service_id;
          const min = service.minimum_price ?? 0;
          const max = service.maximum_price ?? null;
          const live = row.online_price_override ?? row.price_override;
          const pending = row.pending_online_price_override;
          const current = priceDrafts[id] ?? pending ?? live ?? min;
          return (
            <View key={id} style={[proCard.card, { gap: space.md }]}>
              <Text weight="bold">{localized(service, i18n.language)}</Text>
              <Text tone="muted" size="sm">
                {t("pro.onlineLessons.onlinePriceHint")}
              </Text>
              {pending != null && live != null ? (
                <Text tone="muted" size="sm">
                  {t("pro.onlineLessons.onlinePricePending", {
                    requested: money(pending, i18n.language),
                    current: money(live, i18n.language),
                  })}
                </Text>
              ) : null}
              <ProviderPriceStepper
                value={current}
                min={min}
                max={max}
                onChange={(next) => setPriceDrafts((d) => ({ ...d, [id]: next }))}
              />
              <View style={{ gap: space.sm }}>
                <Button
                  label={
                    isApproved
                      ? t("pro.onlineLessons.requestOnlinePriceChange")
                      : t("pro.common.save")
                  }
                  loading={setOnlinePrice.isPending || requestOnlinePrice.isPending}
                  onPress={() => void saveServiceOnlinePrice(row)}
                />
                {pending != null ? (
                  <Button
                    variant="secondary"
                    label={t("pro.onlineLessons.cancelOnlinePriceChange")}
                    loading={cancelOnlinePrice.isPending}
                    onPress={() =>
                      void cancelOnlinePrice
                        .mutateAsync({ providerId, serviceId: id })
                        .then(() => setSuccess(t("pro.onlineLessons.onlinePriceChangeCancelled")))
                        .catch(() => setActionError(true))
                    }
                  />
                ) : null}
              </View>
            </View>
          );
        })}

      {success ? (
        <Text tone="success" size="sm">
          {success}
        </Text>
      ) : null}
      <ActionError error={actionError} />
    </View>
  );
}