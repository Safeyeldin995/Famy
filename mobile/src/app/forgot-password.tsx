import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { normalizeDigitsToWestern, normalizePhoneE164 } from "@shared/otp/normalizePhone";
import { logAuthFailure } from "@/lib/auth/authDiagnostics";
import {
  phoneOtpFlowErrorMessage,
  startPhoneOtpFlow,
  type PhoneOtpFlowError,
} from "@/lib/auth/phoneOtpFlow";
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
  const [flowMismatchSignup, setFlowMismatchSignup] = useState(false);
  const valid = normalizeDigitsToWestern(phone).replace(/\D/g, "").length >= 9;

  const submit = async () => {
    if (!valid || loading) return;
    setError(null);
    setFlowMismatchSignup(false);
    setLoading(true);
    const e164 = normalizePhoneE164(phone);
    const send = await startPhoneOtpFlow(e164, "reset");
    setLoading(false);
    if (!send.ok) {
      logAuthFailure("reset_send", send.error);
      if (send.error === "flow_mismatch" && send.nextStep === "signup") {
        setError(t("auth.noAccount"));
        setFlowMismatchSignup(true);
        return;
      }
      setError(
        phoneOtpFlowErrorMessage(
          send.error as PhoneOtpFlowError,
          t,
          send.retryAfter,
          send.firebaseAuthCode,
        ),
      );
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
          {flowMismatchSignup ? (
            <Button
              label={t("auth.signUp")}
              variant="ghost"
              onPress={() =>
                router.replace({
                  pathname: "/login",
                  params: { mode: "signup", phone: normalizePhoneE164(phone) },
                })
              }
            />
          ) : null}
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
