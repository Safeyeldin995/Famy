import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useActivePaymentMethods, useCreatePayment } from "@/lib/bookingQueries";
import { useBookingPayment } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { useWalletBalances } from "@/lib/walletQueries";
import { startPaymob, peekPayment, stashPayment, clearPayment } from "@/lib/mobilePayments";
import type { PendingPaymentSelection } from "@/lib/bookingPure";
import { moneyHeld } from "@shared/payments/refundOwed";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { ui, moneyTextStyle } from "@/ui/Page";
import { money } from "@/lib/presentation";

type Props = {
  bookingId: string;
  total: number;
  onPaid: () => void;
};

export function OnlineLessonPaymentPanel({ bookingId, total, onPaid }: Props) {
  const { t, i18n } = useTranslation();
  const paymentQ = useBookingPayment(bookingId);
  const methods = useActivePaymentMethods();
  const wallet = useWalletBalances();
  const create = useCreatePayment();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const prepared = useRef(false);

  const onlineMethod = useMemo(
    () =>
      methods.data?.find((m) => m.is_default && m.method_type === "online") ??
      methods.data?.find((m) => m.method_type === "online"),
    [methods.data],
  );

  const available = Number(wallet.data?.available_amount ?? 0);
  const cardDue = Math.max(0, total - available);
  const walletOnly = cardDue <= 0.01;

  useEffect(() => {
    if (prepared.current || !onlineMethod) return;
    void peekPayment(bookingId).then((sel) => {
      if (!sel) {
        const payload: PendingPaymentSelection = {
          paymentMethodId: onlineMethod.id,
          methodType: "online",
        };
        void stashPayment(bookingId, payload);
      }
      prepared.current = true;
    });
  }, [bookingId, onlineMethod]);

  const captured = moneyHeld({
    paymentStatus: paymentQ.data?.status,
    methodType: paymentQ.data?.payment_method_type,
    proofPath: paymentQ.data?.proof_path,
  });

  if (captured || paymentQ.isLoading) return null;

  async function payOnce() {
    if (!onlineMethod) {
      setError(t("onlineLesson.payNoMethod"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      let paymentId = paymentQ.data?.id;
      if (!paymentId) {
        const payment = await create.mutateAsync({
          bookingId,
          paymentMethodId: onlineMethod.id,
          methodType: "online",
        });
        paymentId = payment.id;
        await clearPayment(bookingId);
      }
      const { data: walletResult, error: walletErr } = await supabase.rpc(
        "apply_customer_wallet_to_booking_payment",
        { p_payment_id: paymentId },
      );
      if (walletErr) throw walletErr;
      const captured =
        walletResult &&
        typeof walletResult === "object" &&
        (walletResult as { captured?: boolean }).captured === true;
      if (captured) {
        await paymentQ.refetch();
        onPaid();
        return;
      }
      await startPaymob(bookingId, paymentId, "card");
      const refetched = await paymentQ.refetch();
      if (
        moneyHeld({
          paymentStatus: refetched.data?.status,
          methodType: refetched.data?.payment_method_type,
          proofPath: refetched.data?.proof_path,
        })
      ) {
        onPaid();
      }
    } catch {
      setError(t("onlineLesson.payFailedNext"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[ui.card, { gap: 10 }]}>
      <Text size="xl" weight="heavy">
        {t("onlineLesson.payTitle")}
      </Text>
      {available > 0 ? (
        <Text size="sm" tone="muted">
          {t("onlineLesson.walletApplied", { amount: money(available, i18n.language) })}
        </Text>
      ) : null}
      <Text style={moneyTextStyle(i18n.language)} size="lg" weight="bold">
        {walletOnly
          ? t("onlineLesson.walletCoversTotal")
          : t("onlineLesson.cardDue", { amount: money(cardDue, i18n.language) })}
      </Text>
      {error ? <Text tone="danger">{error}</Text> : null}
      <Button
        label={walletOnly ? t("onlineLesson.confirmWalletPay") : t("onlineLesson.payNowOneTap")}
        loading={busy}
        onPress={() => void payOnce()}
      />
    </View>
  );
}