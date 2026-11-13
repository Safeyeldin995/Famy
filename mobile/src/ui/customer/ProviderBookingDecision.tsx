import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  useBookableServiceIds,
  useDefaultAddress,
  useApprovedTeachingCapabilities,
} from "@/lib/queries";
import {
  useAvailableSlots,
  useProviderBookingSettings,
} from "@/lib/bookingQueries";
import { filterFixedStartSlots, isFixedPackage } from "@shared/pricing/servicePackages";
import {
  formatProviderNextSlotLine,
  nextProviderScanDay,
} from "@shared/booking/providerNextSlot";
import {
  providerProfileHighlightService,
  providerProfilePriceLine,
  providerProfileQualificationLine,
} from "@shared/booking/providerProfileDecision";
import { Text } from "@/ui/Text";
import { colors } from "@/ui/theme";
import { customerStyle } from "@/ui/customer/Primitives";

type ServiceRow = {
  price_override: number | null;
  service: {
    id: string;
    name_ar?: string | null;
    name_en?: string | null;
    category?: { slug?: string | null } | null;
    duration_min?: number | null;
    fixed_start_time?: string | null;
    pricing_model?: string | null;
  };
};

export function ProviderBookingDecision({
  providerId,
  services,
  preferredServiceId,
  hourlyRate,
}: {
  providerId: string;
  services: ServiceRow[];
  preferredServiceId?: string | null;
  hourlyRate: number;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const address = useDefaultAddress();
  const row = providerProfileHighlightService(services, preferredServiceId);
  const bookable = useBookableServiceIds(providerId, address.data?.id);
  const caps = useApprovedTeachingCapabilities(providerId, row?.service.id);
  const capability = caps.data?.[0] ?? null;
  const fixed = row ? isFixedPackage(row.service) : false;
  const tutoring = row?.service.category?.slug === "tutoring";
  const duration = capability
    ? capability.durationMin
    : fixed
      ? Number(row?.service.duration_min ?? 60)
      : 120;
  const [scanDate, setScanDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const settings = useProviderBookingSettings(providerId, {
    serviceId: row?.service.id ?? null,
    addressId: address.data?.id ?? null,
  });
  const slots = useAvailableSlots(providerId, scanDate, duration, {
    serviceId: row?.service.id,
    addressId: address.data?.id ?? null,
    cairoTime: fixed,
    fixedStartTime: fixed ? row?.service.fixed_start_time : null,
  });
  const available = useMemo(
    () => (row ? filterFixedStartSlots(slots.data ?? [], row.service) : []),
    [row, slots.data],
  );
  useEffect(() => {
    const next = nextProviderScanDay(scanDate, settings.data?.max_advance_days ?? 12, {
      loading: slots.isLoading || slots.isFetching,
      slotCount: available.length,
    });
    if (next) setScanDate(next);
  }, [
    scanDate,
    settings.data?.max_advance_days,
    available.length,
    slots.isLoading,
    slots.isFetching,
  ]);

  if (!row) return null;
  const price = providerProfilePriceLine(row, lang, t, {
    hourlyRate,
    bookableRate: bookable.data?.get(row.service.id) ?? null,
    capability: tutoring ? capability : null,
  });
  const qualification = providerProfileQualificationLine(row, caps.data ?? [], lang, t);
  const when =
    available[0] && !slots.isLoading
      ? t("providerPage.nextSlot", {
          when: formatProviderNextSlotLine(available[0], lang, fixed),
        })
      : slots.isError
        ? t("bookFlow.slotsLoadError")
        : slots.isLoading || slots.isFetching
          ? t("common.loading")
          : t("providerPage.noSlotYet");

  return (
    <View style={[customerStyle.card, { gap: 6 }]}>
      <Text size="xs" tone="muted" weight="bold">
        {t("providerPage.decisionPrice")}
      </Text>
      <Text weight="heavy">{price}</Text>
      <Text>{when}</Text>
      {qualification ? (
        <Text size="sm" tone="muted">
          {qualification}
        </Text>
      ) : null}
    </View>
  );
}
