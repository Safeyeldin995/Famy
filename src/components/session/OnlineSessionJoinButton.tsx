import { PrimaryButton } from "@/components/famio/ui";
import { authorizeSessionJoin, sessionJoinWindow, type SessionBookingSnapshot } from "@/lib/livekit/sessionAccess";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth/useAuth";
import { useMemo } from "react";
import { moneyHeld } from "@/lib/payments/refundOwed";

type Props = {
  booking: {
    id: string;
    service_mode?: string | null;
    status: string;
    customer_id: string;
    start_at: string;
    end_at: string;
  };
  providerProfileId: string | undefined;
  paymentStatus?: string | null;
  paymentMethodType?: string | null;
  proofPath?: string | null;
  party: "customer" | "provider";
};

export function OnlineSessionJoinButton({
  booking,
  providerProfileId,
  paymentStatus,
  paymentMethodType,
  proofPath,
  party,
}: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const snapshot: SessionBookingSnapshot | null = useMemo(() => {
    if (!user?.id || !providerProfileId || booking.service_mode !== "online") return null;
    return {
      id: booking.id,
      service_mode: "online",
      status: booking.status,
      customer_id: booking.customer_id,
      provider_id: "",
      provider_profile_id: providerProfileId,
      start_at: booking.start_at,
      end_at: booking.end_at,
      payment_captured: moneyHeld({
        paymentStatus,
        methodType: paymentMethodType,
        proofPath,
      }),
    };
  }, [booking, paymentMethodType, paymentStatus, proofPath, providerProfileId, user?.id]);

  const authz = useMemo(() => {
    if (!snapshot || !user?.id) return null;
    return authorizeSessionJoin(snapshot, user.id);
  }, [snapshot, user?.id]);

  const windowOpen = useMemo(() => {
    const start = new Date(booking.start_at);
    const end = new Date(booking.end_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
    return sessionJoinWindow(start, end).open;
  }, [booking.end_at, booking.start_at]);

  if (booking.service_mode !== "online" || !windowOpen || !authz?.ok) return null;

  return (
    <a href={`/booking/${booking.id}/session`} className="block w-full">
      <PrimaryButton type="button" className="w-full">
        {party === "customer" ? t("onlineSession.joinCustomer") : t("onlineSession.joinProvider")}
      </PrimaryButton>
    </a>
  );
}