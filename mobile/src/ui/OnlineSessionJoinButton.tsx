import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { authorizeSessionJoin, type SessionBookingSnapshot } from "@shared/livekit/sessionAccess";
import { moneyHeld } from "@shared/payments/refundOwed";
import { Button } from "./Button";
import { isJoinWindowOpen, JOIN_WINDOW_TICK_MS } from "@/lib/onlineSessionUi";

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

  // Re-check the window while the screen stays open, so the button appears on time.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (booking.service_mode !== "online") return;
    const id = setInterval(() => setNow(new Date()), JOIN_WINDOW_TICK_MS);
    return () => clearInterval(id);
  }, [booking.service_mode]);

  const windowOpen = useMemo(
    () => isJoinWindowOpen(booking.start_at, booking.end_at, now),
    [booking.end_at, booking.start_at, now],
  );

  if (booking.service_mode !== "online" || !windowOpen || !authz?.ok) return null;

  const label =
    party === "customer"
      ? t("onlineSession.joinCustomer")
      : t("onlineSession.joinProvider");

  return <Button label={label} onPress={onJoin} />;
}