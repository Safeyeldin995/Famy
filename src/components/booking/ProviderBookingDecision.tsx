import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useBookableServiceIds,
  useDefaultAddress,
  useProviderBookingSettings,
  useAvailableSlots,
} from "@/lib/db/queries";
import { useApprovedTeachingCapabilities } from "@/lib/db/teaching-queries";
import { currentLang } from "@/lib/i18n";
import { filterFixedStartSlots, isFixedPackage } from "@/lib/pricing/servicePackages";
import {
  formatProviderNextSlotLine,
  nextProviderScanDay,
} from "@/lib/booking/providerNextSlot";
import {
  providerProfileHighlightService,
  providerProfilePriceLine,
  providerProfileQualificationLine,
} from "@/lib/booking/providerProfileDecision";

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
  const { t } = useTranslation();
  const lang = currentLang();
  const addressQ = useDefaultAddress();
  const row = providerProfileHighlightService(services, preferredServiceId);
  const bookableQ = useBookableServiceIds(providerId, addressQ.data?.id);
  const capsQ = useApprovedTeachingCapabilities(providerId, row?.service.id);
  const capability = capsQ.data?.[0] ?? null;
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
  const settingsQ = useProviderBookingSettings(providerId, {
    serviceId: row?.service.id ?? null,
    addressId: addressQ.data?.id ?? null,
  });
  const slotsQ = useAvailableSlots(providerId, scanDate, duration, {
    serviceId: row?.service.id,
    addressId: addressQ.data?.id ?? null,
    cairoTime: fixed,
    fixedStartTime: fixed ? row?.service.fixed_start_time : null,
  });
  const slots = useMemo(
    () => (row ? filterFixedStartSlots(slotsQ.data ?? [], row.service) : []),
    [row, slotsQ.data],
  );
  useEffect(() => {
    const next = nextProviderScanDay(scanDate, settingsQ.data?.max_advance_days ?? 12, {
      loading: slotsQ.isLoading || slotsQ.isFetching,
      slotCount: slots.length,
    });
    if (next) setScanDate(next);
  }, [
    scanDate,
    settingsQ.data?.max_advance_days,
    slots.length,
    slotsQ.isLoading,
    slotsQ.isFetching,
  ]);

  if (!row) return null;
  const price = providerProfilePriceLine(row, lang, t, {
    hourlyRate,
    bookableRate: bookableQ.data?.get(row.service.id) ?? null,
    capability: tutoring ? capability : null,
  });
  const qualification = providerProfileQualificationLine(
    row,
    capsQ.data ?? [],
    lang,
    t,
  );
  const when =
    slots[0] && !slotsQ.isLoading
      ? t("providerPage.nextSlot", {
          when: formatProviderNextSlotLine(slots[0], lang, fixed),
        })
      : slotsQ.isError
        ? t("bookFlow.slotsLoadError")
        : slotsQ.isLoading || slotsQ.isFetching
          ? t("common.loading")
          : t("providerPage.noSlotYet");

  return (
    <div className="rounded-2xl border border-border/60 bg-white p-3.5 text-pro-13 shadow-sm">
      <p className="text-pro-12 font-bold text-muted-foreground">{t("providerPage.decisionPrice")}</p>
      <p className="mt-1 font-extrabold text-foreground">{price}</p>
      <p className="mt-2 text-foreground">{when}</p>
      {qualification ? <p className="mt-1 text-muted-foreground">{qualification}</p> : null}
    </div>
  );
}
