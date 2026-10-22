import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react-native";
import { formatOtpExpiryClock, formatOtpSecondsDuration } from "@/lib/auth/otpCountdown";
import { abandonMobileOtpFlow, fetchMobileOtpContext } from "@/lib/auth/mobileOtpApi";
import {
  phoneOtpFlowErrorMessage,
  resendPhoneOtpFlow,
  verifyPhoneOtpCode,
  verifyPhoneOtpWithFirebase,
} from "@/lib/auth/phoneOtpFlow";
import { hasNativeFirebasePhoneSession } from "@/lib/auth/firebasePhone";
import { Button } from "@/ui/Button";
import { OtpCodeInput } from "@/ui/OtpCodeInput";
import { Text } from "@/ui/Text";
import { colors, fonts, radius, space } from "@/ui/theme";

type OtpContext = {
  maskedPhone: string;
  purpose: "signup" | "reset";
  role?: "customer" | "provider";
  otpExpiresIn: number;
  resendAvailableIn: number;
  delivery: "firebase" | "server";
};

export default function OtpScreen() {
  const params = useLocalSearchParams<{ purpose?: string; phone?: string }>();
  const { t, i18n } = useTranslation();
  const inputFont = (i18n.language === "en" ? fonts.en : fonts.ar).bold;
  const [context, setContext] = useState<OtpContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [otpExpiresIn, setOtpExpiresIn] = useState(0);
  const [resendAvailableIn, setResendAvailableIn] = useState(0);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verifyLock = useRef(false);
  const phoneE164 = typeof params.phone === "string" ? params.phone : "";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchMobileOtpContext();
      if (cancelled) return;
      setLoadingContext(false);
      if (
        !res.ok ||
        !res.data ||
        typeof res.data !== "object" ||
        !(res.data as { ok?: boolean }).ok
      ) {
        router.replace(params.purpose === "reset" ? "/forgot-password" : "/login");
        return;
      }
      const ctx = res.data as OtpContext & { ok: true };
      setContext(ctx);
      setOtpExpiresIn(ctx.otpExpiresIn);
      setResendAvailableIn(ctx.resendAvailableIn);
    })();
    return () => {
      cancelled = true;
    };
  }, [params.purpose]);

  useEffect(() => {
    const id = setInterval(() => {
      setOtpExpiresIn((v) => Math.max(0, v - 1));
      setResendAvailableIn((v) => Math.max(0, v - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (otpExpiresIn !== 0 || loadingContext) return;
    void abandonMobileOtpFlow().then(() => {
      setError(t("auth.sessionExpired"));
      router.replace(context?.purpose === "reset" ? "/forgot-password" : "/login");
    });
  }, [context?.purpose, loadingContext, otpExpiresIn, t]);

  useEffect(() => {
    if (!context || context.delivery !== "firebase") return;
    if (!hasNativeFirebasePhoneSession()) {
      setError(t("auth.firebaseSessionLost"));
    }
  }, [context, t]);

  const verify = async (value: string) => {
    if (value.length !== 6 || loading || verifyLock.current || !context) return;
    verifyLock.current = true;
    setLoading(true);
    setError(null);
    const res =
      context.delivery === "firebase"
        ? await verifyPhoneOtpWithFirebase(value)
        : await verifyPhoneOtpCode(value);
    setLoading(false);
    if (!res.ok) {
      verifyLock.current = false;
      if (res.error === "flow_mismatch") {
        setError(res.nextStep === "signup" ? t("auth.verifyUseSignup") : t("auth.verifyUseSignin"));
        router.replace("/login");
        return;
      }
      if (res.error === "firebase_session_lost") {
        setError(phoneOtpFlowErrorMessage("firebase_session_lost", t));
        setCode(["", "", "", "", "", ""]);
        return;
      }
      setError(t("auth.invalidCode"));
      setCode(["", "", "", "", "", ""]);
      return;
    }
    router.replace("/set-password");
  };

  const resend = async () => {
    if (!context || resendAvailableIn > 0 || resending || loading) return;
    if (context.delivery === "firebase" && !phoneE164) {
      setError(t("auth.sessionExpired"));
      router.replace(context.purpose === "reset" ? "/forgot-password" : "/login");
      return;
    }
    setResending(true);
    setError(null);
    const res = await resendPhoneOtpFlow(phoneE164);
    setResending(false);
    if (!res.ok) {
      const msg = phoneOtpFlowErrorMessage(res.error, t, res.retryAfter, res.firebaseAuthCode);
      setError(msg);
      if (res.flowAbandoned) {
        router.replace(context.purpose === "reset" ? "/forgot-password" : "/login");
      }
      if (res.retryAfter) setResendAvailableIn(res.retryAfter);
      return;
    }
    setResendAvailableIn(res.retryAfter ?? 30);
    setOtpExpiresIn(5 * 60);
  };

  if (loadingContext || !context) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text tone="muted">{t("common.loading")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const title =
    context.purpose === "reset" ? t("auth.resetVerifyTitle") : t("auth.signupVerifyTitle");
  const body = context.purpose === "reset" ? t("auth.resetVerifyBody") : t("auth.signupVerifyBody");

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text size="hero" weight="heavy">
            {title}
          </Text>
          <Text tone="muted">{body}</Text>
          <Text weight="heavy" style={styles.ltr}>
            {context.maskedPhone}
          </Text>

          <OtpCodeInput
            value={code}
            onChange={setCode}
            onComplete={verify}
            disabled={loading}
            invalid={!!error}
            inputFont={inputFont}
          />

          <View style={styles.timerRow}>
            <Clock size={16} color={colors.muted} />
            <Text size="sm" tone="muted">
              {otpExpiresIn > 0
                ? t("auth.codeExpiresIn", { time: formatOtpExpiryClock(otpExpiresIn) })
                : t("auth.sessionExpired")}
            </Text>
          </View>

          {error ? (
            <View style={styles.error}>
              <Text size="sm" weight="bold" tone="danger">
                {error}
              </Text>
            </View>
          ) : null}

          <Button
            label={loading ? t("common.verifying") : t("common.verify")}
            onPress={() => verify(code.join(""))}
            loading={loading}
            disabled={code.join("").length !== 6}
          />

          <Pressable onPress={resend} disabled={resendAvailableIn > 0 || resending} hitSlop={12}>
            <Text size="sm" weight="heavy" tone={resendAvailableIn > 0 ? "muted" : "brand"}>
              {resendAvailableIn > 0
                ? t("auth.resendIn", { time: formatOtpSecondsDuration(resendAvailableIn, t) })
                : t("auth.resend")}
            </Text>
          </Pressable>

          <Button
            label={t("auth.changePhone")}
            variant="ghost"
            onPress={async () => {
              await abandonMobileOtpFlow();
              router.replace(context.purpose === "reset" ? "/forgot-password" : "/login");
            }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.xxl, gap: space.lg, alignItems: "stretch" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  ltr: { direction: "ltr", alignSelf: "center" },
  timerRow: { flexDirection: "row", alignItems: "center", gap: space.xs, justifyContent: "center" },
  error: { backgroundColor: "#FBE7E6", borderRadius: radius.md, padding: space.md },
});
