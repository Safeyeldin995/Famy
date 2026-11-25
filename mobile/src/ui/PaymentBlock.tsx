import * as DocumentPicker from "expo-document-picker";
import { runPaymobReturnPolling } from "@shared/paymob/paymobReturnPolling";
import { useEffect, useState, useCallback, useRef } from "react";
import { AppState, Linking, View } from "react-native";
import { instapayConfig } from "@shared/payout/payoutMethods";
import { refundOwed } from "@shared/payments/refundOwed";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useBookingPayment } from "@/lib/queries";
import {
  useActivePaymentMethods,
  useCreatePayment,
  type PaymentMethodRow,
} from "@/lib/bookingQueries";
import { supabase } from "@/lib/supabase";
import {
  clearPayment,
  peekPayment,
  startPaymob,
  uploadProof,
  openProof,
} from "@/lib/mobilePayments";
import { isPaymentEligibleBookingStatus, type PendingPaymentSelection } from "@/lib/bookingPure";
import { QueryState, moneyTextStyle, ui } from "./Page";
import { space } from "./theme";
import { Button } from "./Button";
import { Text } from "./Text";
import { BrandLogo, PaymentLogos } from "./PaymentLogos";
import { money } from "@/lib/presentation";
import { useWalletBalances } from "@/lib/walletQueries";
import { walletSplitView } from "@/lib/customerCasesPure";
import {
  paymobChannelForPaymentBlock,
  resolvePaymobCheckoutChannelForPayment,
} from "@/lib/paymobPaymentChannel";

/** True once customer_apply_wallet_at_checkout ran for this payment (amount is then the card part). */
function walletAlreadyApplied(metadata: unknown): boolean {
  const m = metadata as { wallet_checkout?: { applied?: unknown } } | null | undefined;
  return m?.wallet_checkout?.applied === true;
}

export function PaymentBlock({
  bookingId,
  status,
  total,
  refetchBooking,
}: {
  bookingId: string;
  status: string;
  total: number | null;
  refetchBooking: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const q = useBookingPayment(bookingId);
  const methods = useActivePaymentMethods();
  const create = useCreatePayment();
  const wallet = useWalletBalances();
  const recoveryStarted = useRef(false);
  const [selection, setSelection] = useState<PendingPaymentSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    peekPayment(bookingId)
      .then((v) => {
        if (live) setSelection(v);
      })
      .catch(() => {
        if (live) setError(t("bookFlow.paymentFailed"));
      });
    return () => {
      live = false;
    };
  }, [bookingId, t]);
  const qc = useQueryClient();
  const refetchPayment = q.refetch;
  const refetchWallet = wallet.refetch;
  // The wallet balance is part of what this card promises, so it is refreshed with
  // the payment: on mount, on app focus, and after every checkout attempt. Wallet
  // entries are invalidated too, because a checkout may have spent from them.
  const refresh = useCallback(async () => {
    void qc.invalidateQueries({ queryKey: ["customer-wallet-entries"] });
    await Promise.all([refetchPayment(), refetchBooking(), refetchWallet()]);
  }, [qc, refetchPayment, refetchBooking, refetchWallet]);
  useEffect(() => {
    void refetchWallet();
  }, [refetchWallet]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => sub.remove();
  }, [refresh]);
  const p = q.data;
  const legacy =
    p && !p.payment_method_type ? methods.data?.find((m) => m.code === p.method) : null;
  const type = p?.payment_method_type ?? legacy?.method_type;
  const statusRef = useRef<string | undefined>(undefined);
  statusRef.current = p?.status;
  useEffect(
    () =>
      runPaymobReturnPolling({
        enabled: true,
        isOnline: type === "online",
        getPaymentStatus: () => statusRef.current,
        refetch: refresh,
      }),
    [bookingId, type, refresh],
  );
  const snapshot = p?.payment_method_snapshot as {
    instructions_ar?: string;
    instructions_en?: string;
    public_config?: { handle?: string; note?: string };
  } | null;
  const snap = instapayConfig(snapshot?.public_config ?? legacy?.public_config);
  // Payments made before the link existed fall back to the method's current settings.
  const live = instapayConfig(methods.data?.find((m) => m.code === p?.method)?.public_config);
  const handle = snap.handle || live.handle;
  const note = snap.note || live.note;
  // Only InstaPay gets the "Open InstaPay" button.
  const refundOnTheWay = refundOwed({
    paymentStatus: p?.status,
    methodType: type,
    proofPath: p?.proof_path,
    bookingStatus: status,
  });
  const payLink = p?.method === "instapay" ? snap.payLink || live.payLink : "";
  const paymobChannel = paymobChannelForPaymentBlock({ payment: p, selection });
  // The Paymob checkout route spends the wallet balance first (server side);
  // show the customer that split before they pay.
  const walletView = walletSplitView({
    eligible: type === "online" && p?.status === "pending" && !walletAlreadyApplied(p?.metadata),
    total: p?.amount ?? total,
    available: wallet.data?.available_amount,
    balanceFetching: wallet.isFetching,
    balanceOk: wallet.isSuccess,
  });
  const split =
    walletView.kind === "split" ? walletView : { walletPart: 0, cardPart: 0, walletOnly: false };
  async function checkout() {
    setBusy(true);
    setError("");
    try {
      await startPaymob(bookingId, p?.id, paymobChannel);
      await refresh();
      setMessage(t("mobileBooking.paymentRefresh"));
    } catch {
      setError(t("payment.paymobStartFailed"));
    } finally {
      setBusy(false);
    }
  }
  async function recover() {
    if (!selection) return;
    await startNewPayment({
      paymentMethodId: selection.paymentMethodId,
      methodType: selection.methodType,
      paymobChannel: selection.paymobChannel,
    });
  }

  async function startNewPayment(method: {
    paymentMethodId: string;
    methodType: PendingPaymentSelection["methodType"];
    paymobChannel?: PendingPaymentSelection["paymobChannel"];
  }) {
    if (
      !isPaymentEligibleBookingStatus(status) ||
      total == null ||
      !Number.isFinite(Number(total)) ||
      Number(total) <= 0
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (p?.status === "rejected") {
        await supabase.rpc("customer_release_booking_checkout_wallet", {
          p_booking_id: bookingId,
        });
      }
      const payment = await create.mutateAsync({
        bookingId,
        paymentMethodId: method.paymentMethodId,
        methodType: method.methodType,
      });
      await clearPayment(bookingId);
      setSelection(null);
      await refresh();
      if (method.methodType === "online") {
        await startPaymob(
          bookingId,
          payment.id,
          resolvePaymobCheckoutChannelForPayment({
            metadata: payment.metadata,
            selectionChannel: method.paymobChannel,
          }),
        );
        await refresh();
      }
    } catch {
      setError(t("bookFlow.paymentFailed"));
    } finally {
      setBusy(false);
    }
  }

  function onPickMethod(m: PaymentMethodRow) {
    void startNewPayment({
      paymentMethodId: m.id,
      methodType: m.method_type,
    });
  }

  const canChoosePaymentMethod =
    isPaymentEligibleBookingStatus(status) &&
    total != null &&
    Number.isFinite(Number(total)) &&
    Number(total) > 0 &&
    ((!p && !q.isLoading) || p?.status === "rejected");
  useEffect(() => {
    if (
      selection &&
      !p &&
      !q.isLoading &&
      !q.isError &&
      !recoveryStarted.current &&
      isPaymentEligibleBookingStatus(status) &&
      total != null &&
      Number.isFinite(Number(total)) &&
      Number(total) > 0
    ) {
      recoveryStarted.current = true;
      void recover();
    }
    // One automatic attempt; errors remain visible and the customer can retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, p, q.isLoading, q.isError, status, total]);
  async function receipt(pdf = false) {
    setError("");
    try {
      let asset: {
        uri: string;
        fileName?: string | null;
        mimeType?: string | null;
        fileSize?: number;
      };
      if (pdf) {
        const result = await DocumentPicker.getDocumentAsync({
          type: "application/pdf",
          multiple: false,
          copyToCacheDirectory: true,
        });
        if (result.canceled) return;
        const a = result.assets[0];
        asset = { uri: a.uri, fileName: a.name, mimeType: a.mimeType, fileSize: a.size };
      } else {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 1,
        });
        if (result.canceled) return;
        asset = result.assets[0];
      }
      setBusy(true);
      await uploadProof(bookingId, p.id, asset);
      await q.refetch();
      setMessage(t("payment.receiptUploaded"));
    } catch (e) {
      setError(
        t(
          e instanceof Error && e.message === "fileTooLarge"
            ? "payment.fileTooLarge"
            : "payment.uploadFailed",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={ui.card}>
      <Text size="xl" weight="heavy">
        {t("payment.title")}
      </Text>
      <QueryState query={q} />
      {error && <Text tone="danger">{error}</Text>}
      {message && <Text>{message}</Text>}
      {!p && !q.isLoading && !q.isError && (
        <>
          <Text>{t(selection ? "bookFlow.paymentDeferred" : "payment.noneRecorded")}</Text>
          {selection &&
            isPaymentEligibleBookingStatus(status) &&
            total != null &&
            Number.isFinite(Number(total)) &&
            Number(total) > 0 && (
              <Button label={t("common.retry")} loading={busy} onPress={() => void recover()} />
            )}
        </>
      )}
      {p && (
        <>
          <Text>
            {(i18n.language === "ar" ? p.payment_method_name_ar : p.payment_method_name_en) ||
              legacy?.name_en ||
              t("payment.title")}
          </Text>
          <Text>{t(`payment.status.${p.status}`)}</Text>
          {refundOnTheWay && <Text weight="bold">{t("payment.refundOnTheWay")}</Text>}
          <Text style={moneyTextStyle(i18n.language)}>{money(p.amount, i18n.language)}</Text>
          <Text>
            {(i18n.language === "ar" ? snapshot?.instructions_ar : snapshot?.instructions_en) ??
              (i18n.language === "ar" ? legacy?.instructions_ar : legacy?.instructions_en) ??
              ""}
          </Text>
          {type === "cash" && <Text>{t("mobileBooking.cashNext")}</Text>}
          {type === "manual_transfer" && (
            <>
              {p.method === "instapay" && <BrandLogo brand="instapay" height={16} />}
              {payLink && p.status === "pending_review" && !p.proof_path && (
                <Button
                  label={t("payment.openInstapay")}
                  onPress={() => {
                    void Linking.openURL(payLink).catch(() =>
                      setError(t("payment.cannotOpenInstapay")),
                    );
                  }}
                />
              )}
              {handle && (
                <>
                  <Text style={ui.ltr}>{handle}</Text>
                  <Button
                    variant="secondary"
                    label={t("mobile.copyCode")}
                    onPress={() => {
                      void Clipboard.setStringAsync(handle)
                        .then((ok) => {
                          if (!ok) throw new Error();
                          setMessage(t("mobile.copied"));
                        })
                        .catch(() => setError(t("common.somethingWentWrong")));
                    }}
                  />
                </>
              )}
              {note && <Text>{note}</Text>}
              {p.status === "pending_review" && !p.proof_path && (
                <>
                  <Button
                    label={t("payment.uploadReceipt")}
                    loading={busy}
                    onPress={() => void receipt()}
                  />
                  <Button
                    variant="secondary"
                    label={t("mobileBooking.uploadPdf")}
                    loading={busy}
                    onPress={() => void receipt(true)}
                  />
                </>
              )}
            </>
          )}
          {type === "manual_transfer" && p.proof_path && !refundOnTheWay && (
            <>
              <Text>
                {t(
                  p.status === "pending_review"
                    ? "payment.awaitingReview"
                    : "payment.receiptUploaded",
                )}
              </Text>
              <Button
                variant="secondary"
                label={t("payment.viewReceipt")}
                onPress={() =>
                  void openProof(p.proof_path).catch(() => setError(t("payment.cannotOpenReceipt")))
                }
              />
            </>
          )}
          {p.status === "rejected" && (
            <>
              <Text tone="danger">{t("payment.rejectedTitle")}</Text>
              {p.rejection_reason && <Text>{p.rejection_reason}</Text>}
              <Text>{t("payment.rejectedRetry")}</Text>
            </>
          )}
          {type === "online" && (
            <>
              <PaymentLogos />
              {p.status === "pending" && walletView.kind === "checking" && (
                <Text size="sm" tone="muted">
                  {t("payment.walletChecking")}
                </Text>
              )}
              {p.status === "pending" && walletView.kind === "split" && (
                <Text weight="bold" style={moneyTextStyle(i18n.language)}>
                  {split.walletOnly
                    ? t("payment.walletCoversAll", {
                        wallet: money(split.walletPart, i18n.language),
                      })
                    : t("payment.walletWillCover", {
                        wallet: money(split.walletPart, i18n.language),
                        card: money(split.cardPart, i18n.language),
                      })}
                </Text>
              )}
              {p.status === "pending" && (
                <Button
                  label={t(split.walletOnly ? "payment.payWithWallet" : "mobileBooking.payOnline")}
                  loading={busy}
                  onPress={() => void checkout()}
                />
              )}
              <Button
                variant="secondary"
                label={t("mobileBooking.refreshStatus")}
                onPress={() => void refresh().catch(() => setError(t("common.somethingWentWrong")))}
              />
            </>
          )}
        </>
      )}
      {canChoosePaymentMethod && (methods.data?.length ?? 0) > 0 && (
        <View style={{ gap: space.sm }}>
          <Text weight="bold">{t("payment.title")}</Text>
          {methods.data!.map((m) => (
            <Button
              key={m.id}
              variant="secondary"
              label={(i18n.language === "ar" ? m.name_ar : m.name_en) || m.code}
              loading={busy}
              onPress={() => onPickMethod(m)}
            />
          ))}
        </View>
      )}
    </View>
  );
}
