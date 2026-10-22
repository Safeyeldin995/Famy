import { useState } from "react";
import { View, Pressable, TextInput, Modal } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useTranslation } from "react-i18next";
import { Eye } from "lucide-react-native";
import {
  getSignedProofUrl,
  useBookingPayment,
  useCapturePayment,
  useRejectPayment,
} from "@/lib/provider/payments";
import { money } from "@/lib/presentation";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, fonts, radius, space } from "@/ui/theme";
import { proCard } from "./cards";

export function ProviderPaymentBlock({
  bookingId,
  bookingStatus,
}: {
  bookingId: string;
  bookingStatus: string;
}) {
  const { t, i18n } = useTranslation();
  const q = useBookingPayment(bookingId);
  const capture = useCapturePayment();
  const reject = useRejectPayment();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const p = q.data as Record<string, unknown> | null | undefined;
  if (!p) return null;

  const methodType =
    (p.payment_method_type as string | null) ??
    (p.method === "cash" ? "cash" : p.method === "instapay" ? "manual_transfer" : null);
  const isOnline = methodType === "online";
  const isManual = methodType === "manual_transfer";
  const captureAllowed = bookingStatus === "completed";
  const canAct = !isOnline && (p.status === "pending" || p.status === "pending_review");
  const name = i18n.language.startsWith("ar")
    ? (p.payment_method_name_ar as string) || (p.payment_method_name_en as string)
    : (p.payment_method_name_en as string) || (p.payment_method_name_ar as string);

  const openProof = async () => {
    const path = p.proof_path as string | null;
    if (!path) return;
    try {
      const url = await getSignedProofUrl(path);
      await WebBrowser.openBrowserAsync(url);
    } catch {
      // ActionError handled by parent if needed
    }
  };

  return (
    <View style={proCard.card}>
      <View style={proCard.row}>
        <Text weight="heavy">{name || t("payment.title")}</Text>
        <Text weight="heavy" tone="brand">
          {money(Number(p.amount ?? 0), i18n.language)}
        </Text>
      </View>
      <Text tone="muted" size="sm">
        {t(`payment.status.${String(p.status)}`, String(p.status))}
      </Text>
      {p.proof_path && p.status === "pending_review" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("payment.viewReceipt")}
          onPress={() => void openProof()}
          style={[proCard.row, { justifyContent: "center", minHeight: 44 }]}
        >
          <Eye size={18} color={colors.brand} />
          <Text weight="bold" tone="brand">
            {t("payment.viewReceipt")}
          </Text>
        </Pressable>
      ) : null}
      {canAct ? (
        <View style={{ gap: space.sm }}>
          {captureAllowed ? (
            <Button
              label={t("payment.markReceived")}
              loading={capture.isPending}
              onPress={() => capture.mutate({ paymentId: String(p.id), bookingId })}
            />
          ) : (
            <Text tone="muted" size="sm">
              {t("payment.waitingForCompletion")}
            </Text>
          )}
          {isManual ? (
            <Button
              variant="secondary"
              label={t("payment.reject")}
              onPress={() => setRejectOpen(true)}
            />
          ) : null}
        </View>
      ) : null}
      {p.status === "captured" ? (
        <Text tone="brand" weight="bold">
          {t("payment.confirmed")}
        </Text>
      ) : null}
      <Modal visible={rejectOpen} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.4)",
            justifyContent: "center",
            padding: space.lg,
          }}
        >
          <View style={[proCard.card, { gap: space.md }]}>
            <Text weight="heavy">{t("payment.rejectDialogTitle")}</Text>
            <Text tone="muted" size="sm">
              {t("payment.rejectDialogBody")}
            </Text>
            <TextInput
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder={t("payment.rejectReasonPlaceholder")}
              placeholderTextColor={colors.muted}
              multiline
              style={{
                minHeight: 80,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.md,
                padding: space.md,
                fontFamily: (i18n.language === "ar" ? fonts.ar : fonts.en).bold,
                color: colors.foreground,
              }}
            />
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Button
                variant="secondary"
                label={t("payment.cancel")}
                onPress={() => setRejectOpen(false)}
                style={{ flex: 1 }}
              />
              <Button
                label={t("payment.confirmReject")}
                loading={reject.isPending}
                onPress={() =>
                  reject.mutate(
                    { paymentId: String(p.id), bookingId, reason: rejectReason || undefined },
                    { onSuccess: () => setRejectOpen(false) },
                  )
                }
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
