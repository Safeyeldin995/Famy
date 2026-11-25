import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PrimaryButton } from "@/components/famio/ui";
import { supabase } from "@/integrations/supabase/client";
import { useActivePaymentMethods } from "@/lib/db/payment-methods-queries";
import { useBookingPayment, useCreatePayment } from "@/lib/db/payment-queries";
import { PaymentBlock } from "@/components/famio/PaymentBlock";
import { onlineWebPayMode } from "@/lib/web/onlineWebPayMode";
import { redirectToPaymobCheckout } from "@/lib/paymob/paymobRedirect";
import { formatEGP } from "@/lib/format";

type Props = {
  bookingId: string;
  total: number;
  onPaid: () => void;
};

export function OnlineWebLessonPaymentPanel({ bookingId, total, onPaid }: Props) {
  const { t, i18n } = useTranslation();
  const paymentQ = useBookingPayment(bookingId);
  const methods = useActivePaymentMethods();
  const create = useCreatePayment();
  const [busy, setBusy] = useState(false);

  const balanceQ = useQuery({
    queryKey: ["customer-wallet-balance-web"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as (name: string, args?: object) => ReturnType<typeof supabase.rpc>)(
        "customer_wallet_balances",
      );
      if (error) throw error;
      const row = (data as { available_amount?: number }[] | null)?.[0];
      return Number(row?.available_amount ?? 0);
    },
  });
  const walletBalance = balanceQ.data ?? 0;

  const onlineMethod = useMemo(
    () =>
      methods.data?.find((m) => m.is_default && m.method_type === "online") ??
      methods.data?.find((m) => m.method_type === "online"),
    [methods.data],
  );

  const cardDue = Math.max(0, total - walletBalance);
  const walletOnly = cardDue <= 0.01;

  if (paymentQ.isLoading) return null;
  const mode = onlineWebPayMode(paymentQ.data);
  if (mode === "hidden") return null;
  // A transfer started elsewhere (e.g. the app) can't go through wallet/Paymob checkout;
  // show the same transfer instructions + receipt upload the booking page uses.
  if (mode === "manual_transfer") {
    return <PaymentBlock bookingId={bookingId} viewer="customer" bookingStatus="confirmed" />;
  }

  const payOnce = async () => {
    if (!onlineMethod) {
      toast.error(t("onlineLesson.payNoMethod"));
      return;
    }
    setBusy(true);
    try {
      let paymentId = paymentQ.data?.id;
      if (!paymentId) {
        const payment = await create.mutateAsync({
          bookingId,
          paymentMethodId: onlineMethod.id,
          methodType: "online",
        });
        paymentId = payment.id;
      }
      const { data: walletResult, error: walletErr } = await (supabase.rpc as (
        name: string,
        args?: object,
      ) => ReturnType<typeof supabase.rpc>)("customer_apply_wallet_at_checkout", {
        p_payment_id: paymentId,
      });
      if (walletErr) throw walletErr;
      const payload =
        walletResult && typeof walletResult === "object"
          ? (walletResult as { paid_via_wallet_only?: boolean; card_amount?: number })
          : null;
      const walletCaptured =
        payload?.paid_via_wallet_only === true ||
        (payload?.card_amount != null && Number(payload.card_amount) <= 0.01);
      if (walletCaptured) {
        await paymentQ.refetch();
        onPaid();
        return;
      }
      const checkout = await redirectToPaymobCheckout(bookingId, paymentId, {
        returnSurface: "online_web",
      });
      if (!checkout.ok) throw new Error(checkout.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("onlineLesson.payFailedNext"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-border/60 bg-white p-4 shadow-sm">
      <h2 className="text-pro-18 font-extrabold">{t("onlineLesson.payTitle")}</h2>
      {walletBalance > 0 ? (
        <p className="text-pro-13 text-muted-foreground">
          {t("onlineWeb.walkthrough.walletApplied", {
            amount: formatEGP(Math.min(walletBalance, total), undefined, i18n.language),
          })}
        </p>
      ) : null}
      <p className="text-pro-15 font-bold">
        {walletOnly
          ? t("onlineLesson.walletCoversTotal")
          : t("onlineWeb.walkthrough.cardRemainder", {
              amount: formatEGP(cardDue, undefined, i18n.language),
            })}
      </p>
      <PrimaryButton className="h-12 w-full" disabled={busy} onClick={() => void payOnce()}>
        {walletOnly ? t("onlineLesson.confirmWalletPay") : t("onlineWeb.walkthrough.payNow")}
      </PrimaryButton>
    </div>
  );
}