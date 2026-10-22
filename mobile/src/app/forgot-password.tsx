import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { normalizeDigitsToWestern, normalizePhoneE164 } from "@shared/otp/normalizePhone";
import { phoneOtpFlowErrorMessage, startPhoneOtpFlow } from "@/lib/auth/phoneOtpFlow";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, fonts, radius, space } from "@/ui/theme";

export default function ForgotPassword() {
  const { t, i18n } = useTranslation();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputFont = (i18n.language === "en" ? fonts.en : fonts.ar).bold;
  const valid = normalizeDigitsToWestern(phone).replace(/\D/g, "").length >= 9;

  const submit = async () => {
    if (!valid || loading) return;
    setError(null);
    setLoading(true);
    const e164 = normalizePhoneE164(phone);
    const send = await startPhoneOtpFlow(e164, "reset");
    setLoading(false);
    if (!send.ok) {
      setError(phoneOtpFlowErrorMessage(send.error, t, send.retryAfter, send.firebaseAuthCode));
      return;
    }
    router.push({ pathname: "/otp", params: { purpose: "reset", phone: e164 } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text size="hero" weight="heavy">
            {t("auth.forgotTitle")}
          </Text>
          <Text tone="muted">{t("auth.forgotBody")}</Text>

          <View style={{ gap: space.sm }}>
            <Text size="sm" weight="bold" tone="muted">
              {t("auth.phoneNumber")}
            </Text>
            <View style={[styles.field, styles.ltr]}>
              <View style={styles.prefix}>
                <Text weight="heavy">🇪🇬 +20</Text>
              </View>
              <TextInput
                value={phone}
                onChangeText={(v) => setPhone(v.replace(/[^\d٠-٩ ]/g, ""))}
                placeholder={t("auth.phonePlaceholder")}
                placeholderTextColor={colors.muted}
                keyboardType="phone-pad"
                autoComplete="tel"
                style={[styles.input, { fontFamily: inputFont, textAlign: "left" }]}
              />
            </View>
          </View>

          {error ? (
            <View style={styles.error}>
              <Text size="sm" weight="bold" tone="danger">
                {error}
              </Text>
            </View>
          ) : null}

          <Button label={t("common.sendCode")} onPress={submit} loading={loading} disabled={!valid} />
          <Button label={t("common.back")} variant="ghost" onPress={() => router.back()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.xxl, gap: space.xl },
  field: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
  },
  ltr: { direction: "ltr" },
  prefix: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
  },
  input: { flex: 1, minHeight: 48, fontSize: 16, color: colors.foreground },
  error: { backgroundColor: "#FBE7E6", borderRadius: radius.md, padding: space.md },
});
