import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { normalizeDigitsToWestern, normalizePhoneE164 } from "@shared/otp/normalizePhone";
import { logAuthFailure } from "@/lib/auth/authDiagnostics";
import { phoneOtpFlowErrorMessage, startPhoneOtpFlow } from "@/lib/auth/phoneOtpFlow";
import { AuthLabeledField, AuthPhoneField } from "@/ui/auth/AuthFields";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { KeyboardFormScreen } from "@/ui/KeyboardFormScreen";
import { colors, radius, space } from "@/ui/theme";

export default function ForgotPassword() {
  const { t } = useTranslation();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = normalizeDigitsToWestern(phone).replace(/\D/g, "").length >= 9;

  const submit = async () => {
    if (!valid || loading) return;
    setError(null);
    setLoading(true);
    const e164 = normalizePhoneE164(phone);
    const send = await startPhoneOtpFlow(e164, "reset");
    setLoading(false);
    if (!send.ok) {
      logAuthFailure("reset_send", send.error);
      setError(phoneOtpFlowErrorMessage(send.error, t, send.retryAfter, send.firebaseAuthCode));
      return;
    }
    router.push({ pathname: "/otp", params: { purpose: "reset", phone: e164 } });
  };

  return (
    <KeyboardFormScreen
      contentContainerStyle={styles.content}
      footer={
        <Button label={t("common.sendCode")} onPress={submit} loading={loading} disabled={!valid} />
      }
    >
      <Text size="hero" weight="heavy">
        {t("auth.forgotTitle")}
      </Text>
      <Text tone="muted">{t("auth.forgotBody")}</Text>

      <AuthLabeledField label={t("auth.phoneNumber")}>
        <AuthPhoneField
          value={phone}
          onChangeText={setPhone}
          placeholder={t("auth.phonePlaceholder")}
        />
      </AuthLabeledField>

      {error ? (
        <View style={styles.error}>
          <Text size="sm" weight="bold" tone="danger">
            {error}
          </Text>
        </View>
      ) : null}

      <Button label={t("common.back")} variant="ghost" onPress={() => router.back()} />
    </KeyboardFormScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.xxl, gap: space.xl },
  error: { backgroundColor: "#FBE7E6", borderRadius: radius.md, padding: space.md },
});
