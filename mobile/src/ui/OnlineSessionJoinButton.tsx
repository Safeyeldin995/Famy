import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  authorizeSessionJoin,
  paymentCapturedForJoin,
  type SessionBookingSnapshot,
} from "@shared/livekit/sessionAccess";
import { Button } from "./Button";
import { Text } from "./Text";
import { space } from "./theme";
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
  party,
  onJoin,
}: Props) {
  const { t } = useTranslation();

  const paymentCaptured = paymentCapturedForJoin({
    status: paymentStatus,
    payment_method_type: paymentMethodType,
  });

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
      payment_captured: paymentCaptured,
    };
  }, [booking, paymentCaptured, providerProfileId, viewerUserId]);

  const authz = useMemo(() => {
    if (!snapshot || !viewerUserId) return null;
    return authorizeSessionJoin(snapshot, viewerUserId);
  }, [snapshot, viewerUserId]);

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

  if (booking.service_mode !== "online" || !windowOpen) return null;

  if (!authz?.ok) {
    if (party === "provider" && authz?.code === "payment_required") {
      return (
        <Text size="sm" tone="muted">
          {t("onlineSession.paymentRequiredProvider")}
        </Text>
      );
    }
    return null;
  }

  const label =
    party === "customer" ? t("onlineSession.joinCustomer") : t("onlineSession.joinProvider");

  return (
    <View style={{ gap: space.xs }}>
      <Button label={label} onPress={onJoin} />
    </View>
  );
}