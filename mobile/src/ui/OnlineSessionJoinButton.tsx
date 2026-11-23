import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  authorizeSessionJoin,
  sessionJoinWindow,
  type SessionBookingSnapshot,
} from "@shared/livekit/sessionAccess";
import { moneyHeld } from "@shared/payments/refundOwed";
import { Button } from "./Button";

type BookingLike = {
  id: string;
  service_mode?: string | null;
  status: string;
  customer_id: string;
  start_at: string;
  end_at: string;
};

type Props = {
  booking: BookingLike;
  providerProfileId: string | undefined;
  viewerUserId: string | undefined;
  paymentStatus?: string | null;
  paymentMethodType?: string | null;
  proofPath?: string | null;
  party: "customer" | "provider";
  onJoin: () => void;
};

export function OnlineSessionJoinButton({
  booking,
  providerProfileId,
  viewerUserId,
  paymentStatus,
  paymentMethodType,
  proofPath,
  party,
  onJoin,
}: Props) {
  const { t } = useTranslation();

  const snapshot: SessionBookingSnapshot | null = useMemo(() => {
    if (!viewerUserId || !providerProfileId || booking.service_mode !== "online") return null;
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
  }, [booking, paymentMethodType, paymentStatus, proofPath, providerProfileId, viewerUserId]);

  const authz = useMemo(() => {
    if (!snapshot || !viewerUserId) return null;
    return authorizeSessionJoin(snapshot, viewerUserId);
  }, [snapshot, viewerUserId]);

  const windowOpen = useMemo(() => {
    const start = new Date(booking.start_at);
    const end = new Date(booking.end_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
    return sessionJoinWindow(start, end).open;
  }, [booking.end_at, booking.start_at]);

  if (booking.service_mode !== "online" || !windowOpen || !authz?.ok) return null;

  const label =
    party === "customer"
      ? t("onlineSession.joinCustomer")
      : t("onlineSession.joinProvider");

  return <Button label={label} onPress={onJoin} />;
}