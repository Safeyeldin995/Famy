import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  computeRebookFormBootstrap,
  rebookBootstrapQueriesLoading,
  rebookPrefillBlockedByServices,
  rebookSourceUnavailable,
  type RebookFormInitial,
} from "@shared/booking/rebookFormBootstrap";
import type { RebookPrefillNotice } from "@shared/booking/rebookPrefill";
import {
  useActiveFamilyMembers,
  useAddresses,
  useApprovedTeachingCapabilities,
  useBookableServiceIds,
  useBooking,
  useProviderServices,
} from "@/lib/queries";
import { useRequirementsForService } from "@/lib/bookingQueries";
import { Text } from "@/ui/Text";

export function BookRebookGate({
  providerId,
  rebookFrom,
  children,
}: {
  providerId: string;
  rebookFrom?: string;
  children: (args: {
    mountKey: string;
    rebookInitial: RebookFormInitial | null;
    rebookNotices: RebookPrefillNotice[];
  }) => ReactNode;
}) {
  const { t } = useTranslation();
  const rebookBooking = useBooking(rebookFrom);
  const servicesQ = useProviderServices(providerId);
  const addresses = useAddresses();
  const members = useActiveFamilyMembers();
  const rebookRequirements = useRequirementsForService(
    rebookFrom ? (rebookBooking.data?.service_id as string | undefined) : undefined,
  );
  const rebookCaps = useApprovedTeachingCapabilities(
    providerId,
    rebookFrom ? (rebookBooking.data?.service_id as string | undefined) : undefined,
  );

  const pinned = useMemo(
    () => (addresses.data ?? []).filter((a) => a.lat != null && a.lng != null),
    [addresses.data],
  );
  const defaultAddressId = useMemo(
    () => pinned.find((a) => a.is_default)?.id ?? pinned[0]?.id ?? null,
    [pinned],
  );

  const rebookEligibilityAddressId = useMemo(() => {
    if (!rebookFrom) return defaultAddressId;
    const bookingAddr = rebookBooking.data?.address_id as string | undefined;
    if (bookingAddr && pinned.some((a) => a.id === bookingAddr)) return bookingAddr;
    return defaultAddressId;
  }, [rebookFrom, rebookBooking.data?.address_id, pinned, defaultAddressId]);

  const rebookBookable = useBookableServiceIds(
    rebookFrom ? providerId : undefined,
    rebookEligibilityAddressId || undefined,
  );

  const loading = rebookBootstrapQueriesLoading({
    rebookFrom,
    bookingLoading: rebookBooking.isLoading,
    bookingSuccess: rebookBooking.isSuccess,
    servicesLoading: servicesQ.isLoading,
    servicesError: servicesQ.isError,
    servicesReady: servicesQ.isSuccess && !servicesQ.isLoading,
    addressesLoading: addresses.isLoading,
    membersLoading: members.isLoading,
    capsLoading: rebookCaps.isLoading,
    requirementsLoading: rebookRequirements.isLoading,
    bookableLoading: rebookBookable.isLoading,
  });

  const prefillBlockedByServices = rebookPrefillBlockedByServices({
    rebookFrom,
    bookingSuccess: rebookBooking.isSuccess,
    bookingData: rebookBooking.data,
    servicesLoading: servicesQ.isLoading,
    servicesError: servicesQ.isError,
  });

  const bootstrap = useMemo(() => {
    if (!rebookFrom || !rebookBooking.data) return null;
    return computeRebookFormBootstrap({
      rebookFrom,
      providerId,
      booking: rebookBooking.data as any,
      services: servicesQ.data ?? [],
      bookableServiceIds: new Set([...(rebookBookable.data?.keys() ?? [])]),
      addresses: pinned,
      familyMembers: members.data ?? [],
      capabilities: (rebookCaps.data ?? []).map((cap) => ({
        id: cap.id,
        serviceId: cap.serviceId,
        status: cap.status,
        curriculumId: cap.curriculumId,
        levelId: cap.levelId,
      })),
      bookingRequirements: rebookRequirements.data ?? [],
      fallbackAddressId: defaultAddressId,
    });
  }, [
    rebookFrom,
    providerId,
    rebookBooking.data,
    servicesQ.data,
    rebookBookable.data,
    pinned,
    members.data,
    rebookCaps.data,
    rebookRequirements.data,
    defaultAddressId,
  ]);

  if (!rebookFrom) {
    return children({ mountKey: "new-booking", rebookInitial: null, rebookNotices: [] });
  }

  const freshBooking = {
    mountKey: "new-booking" as const,
    rebookInitial: null,
    rebookNotices: [] as RebookPrefillNotice[],
  };

  if (prefillBlockedByServices) {
    return children(freshBooking);
  }

  if (
    rebookSourceUnavailable({
      rebookFrom,
      bookingLoading: rebookBooking.isLoading,
      bookingSuccess: rebookBooking.isSuccess,
      bookingData: rebookBooking.data,
    }) ||
    (!loading && rebookBooking.isSuccess && !bootstrap)
  ) {
    return (
      <>
        <Text style={{ marginBottom: 8 }}>{t("bookFlow.rebookSourceUnavailable")}</Text>
        {children(freshBooking)}
      </>
    );
  }

  if (loading || !bootstrap) {
    return <Text>{t("pro.common.loading")}</Text>;
  }

  return children({
    mountKey: `rebook-${rebookFrom}`,
    rebookInitial: bootstrap,
    rebookNotices: bootstrap.notices,
  });
}
