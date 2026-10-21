import * as DocumentPicker from "expo-document-picker";
import { runPaymobReturnPolling } from "@shared/paymob/paymobReturnPolling";
import { useEffect, useState, useCallback, useRef } from "react";
import { AppState, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { useTranslation } from "react-i18next";
import { useBookingPayment } from "@/lib/queries";
import { useActivePaymentMethods, useCreatePayment } from "@/lib/bookingQueries";
import {
  clearPayment,
  peekPayment,
  startPaymob,
  uploadProof,
  openProof,
} from "@/lib/mobilePayments";
import { isPaymentEligibleBookingStatus, type PendingPaymentSelection } from "@/lib/bookingPure";
import { QueryState, ui } from "./Page";
import { Button } from "./Button";
import { Text } from "./Text";
import { PaymentLogos } from "./PaymentLogos";
import { money } from "@/lib/presentation";

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
  const refetchPayment = q.refetch;
  const refresh = useCallback(async () => {
    await Promise.all([refetchPayment(), refetchBooking()]);
  }, [refetchPayment, refetchBooking]);
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
  const config = snapshot?.public_config ?? legacy?.public_config;
  const handle = typeof config?.handle === "string" ? config.handle : "";
  const note = typeof config?.note === "string" ? config.note : "";
  async function checkout() {
    setBusy(true);
    setError("");
    try {
      await startPaymob(bookingId, p?.id);
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
    setBusy(true);
    setError("");
    try {
      const payment = await create.mutateAsync({ bookingId, ...selection });
      await clearPayment(bookingId);
      setSelection(null);
      await refresh();
      if (selection.methodType === "online") {
        await startPaymob(bookingId, payment.id);
        await refresh();
      }
    } catch {
      setError(t("bookFlow.paymentFailed"));
    } finally {
      setBusy(false);
    }
  }
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
          <Text style={ui.ltr}>{money(p.amount, i18n.language)}</Text>
          <Text>
            {(i18n.language === "ar" ? snapshot?.instructions_ar : snapshot?.instructions_en) ??
              (i18n.language === "ar" ? legacy?.instructions_ar : legacy?.instructions_en) ??
              ""}
          </Text>
          {type === "cash" && <Text>{t("mobileBooking.cashNext")}</Text>}
          {type === "manual_transfer" && (
            <>
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
          {type === "manual_transfer" && p.proof_path && (
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
              {type === "manual_transfer" && <Text>{t("payment.rejectedRetry")}</Text>}
            </>
          )}
          {type === "online" && (
            <>
              <PaymentLogos />
              {p.status === "pending" && (
                <Button
                  label={t("mobileBooking.payOnline")}
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
    </View>
  );
}
