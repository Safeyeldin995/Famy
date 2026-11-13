import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  computeRebookFormBootstrap,
  rebookBootstrapQueriesLoading,
  type RebookFormInitial,
} from "@/lib/booking/rebookFormBootstrap";
import type { RebookPrefillNotice } from "@/lib/booking/rebookPrefill";
import {
  useAddresses,
  useBookableServiceIds,
  useBooking,
  useProviderServices,
} from "@/lib/db/queries";
import { useActiveFamilyMembers } from "@/lib/db/family-members-queries";
import { useRequirementsForService } from "@/lib/db/provider-queries";
import { useApprovedTeachingCapabilities } from "@/lib/db/teaching-queries";

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
  const rebookBookingQ = useBooking(rebookFrom);
  const servicesQ = useProviderServices(providerId);
  const addrsQ = useAddresses();
  const familyMembersQ = useActiveFamilyMembers();
  const rebookRequirementsQ = useRequirementsForService(
    rebookFrom ? (rebookBookingQ.data?.service_id ?? undefined) : undefined,
  );
  const rebookCapsQ = useApprovedTeachingCapabilities(
    providerId,
    rebookFrom ? (rebookBookingQ.data?.service_id ?? undefined) : undefined,
  );

  const bookableAddresses = useMemo(
    () => (addrsQ.data ?? []).filter((a) => a.lat != null && a.lng != null),
    [addrsQ.data],
  );
  const defaultBookableAddressId = useMemo(
    () =>
      bookableAddresses.find((a) => a.is_default)?.id ?? bookableAddresses[0]?.id ?? null,
    [bookableAddresses],
  );

  const rebookEligibilityAddressId = useMemo(() => {
    if (!rebookFrom) return defaultBookableAddressId;
    const bookingAddr = rebookBookingQ.data?.address_id;
    if (bookingAddr && bookableAddresses.some((a) => a.id === bookingAddr)) return bookingAddr;
    return defaultBookableAddressId;
  }, [rebookFrom, rebookBookingQ.data?.address_id, bookableAddresses, defaultBookableAddressId]);

  const rebookBookableQ = useBookableServiceIds(
    rebookFrom ? providerId : undefined,
    rebookEligibilityAddressId ?? undefined,
  );

  const loading = rebookBootstrapQueriesLoading({
    rebookFrom,
    bookingLoading: rebookBookingQ.isLoading,
    bookingSuccess: rebookBookingQ.isSuccess,
    servicesReady: servicesQ.isSuccess && !servicesQ.isLoading,
    addressesLoading: addrsQ.isLoading,
    membersLoading: familyMembersQ.isLoading,
    capsLoading: rebookCapsQ.isLoading,
    requirementsLoading: rebookRequirementsQ.isLoading,
    bookableLoading: rebookBookableQ.isLoading,
  });

  const bootstrap = useMemo(() => {
    if (!rebookFrom || !rebookBookingQ.data) return null;
    return computeRebookFormBootstrap({
      rebookFrom,
      providerId,
      booking: rebookBookingQ.data,
      services: servicesQ.data ?? [],
      bookableServiceIds: new Set([...(rebookBookableQ.data?.keys() ?? [])]),
      addresses: bookableAddresses,
      familyMembers: familyMembersQ.data ?? [],
      capabilities: (rebookCapsQ.data ?? []).map((cap) => ({
        id: cap.id,
        serviceId: cap.serviceId,
        status: cap.status,
        curriculumId: cap.curriculumId,
        levelId: cap.levelId,
      })),
      bookingRequirements: rebookRequirementsQ.data ?? [],
      fallbackAddressId: defaultBookableAddressId,
    });
  }, [
    rebookFrom,
    providerId,
    rebookBookingQ.data,
    servicesQ.data,
    rebookBookableQ.data,
    bookableAddresses,
    familyMembersQ.data,
    rebookCapsQ.data,
    rebookRequirementsQ.data,
    defaultBookableAddressId,
  ]);

  if (!rebookFrom) {
    return children({ mountKey: "new-booking", rebookInitial: null, rebookNotices: [] });
  }

  if (loading || !bootstrap) {
    return (
      <div className="apply-ui apply-screen p-5" role="status">
        {t("pro.common.loading")}
      </div>
    );
  }

  return children({
    mountKey: `rebook-${rebookFrom}`,
    rebookInitial: bootstrap,
    rebookNotices: bootstrap.notices,
  });
}
