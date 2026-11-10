import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { fetchMobileSetPasswordContext } from "@/lib/auth/mobileOtpApi";
import { completePasswordSetup } from "@/lib/auth/passwordSetup";
import { supabase } from "@/lib/supabase";
import { KeyboardFormScreen } from "@/ui/KeyboardFormScreen";
import { AuthLabeledField, AuthPasswordField } from "@/ui/auth/AuthFields";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";

type SetPasswordContext = {
  maskedPhone: string;
  purpose: "signup" | "reset";
  role?: "customer" | "provider";
};

export default function SetPasswordScreen() {
  const { t } = useTranslation();
  const [context, setContext] = useState<SetPasswordContext | null>(null);
  const [pw, setPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [show, setShow] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitLock = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      const res = await fetchMobileSetPasswordContext();
      if (cancelled) return;
      if (
        !res.ok ||
        !res.data ||
        typeof res.data !== "object" ||
        !(res.data as { ok?: boolean }).ok
      ) {
        router.replace("/login");
        return;
      }
      const ctx = res.data as SetPasswordContext & { ok: true };
      setContext(ctx);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const longEnough = pw.length >= 8;
  const matches = pw.length > 0 && pw === confirmPw;
  const valid = longEnough && matches;

  const submit = async () => {
    if (!valid || loading || submitLock.current || !context) return;
    submitLock.current = true;
    setError(null);
    setLoading(true);
    const res = await completePasswordSetup(pw);
    setLoading(false);
    if (!res.ok) {
      submitLock.current = false;
      if (res.error === "restart_required") {
        router.replace(res.nextStep === "reset" ? "/forgot-password" : "/login");
        return;
      }
      if (res.error === "sign_in_required" && res.passwordUpdated) {
        router.replace("/login");
        return;
      }
      setError(res.message);
      if (res.error === "authorization_missing") router.replace("/login");
      return;
    }

    if (res.purpose === "reset") {
      router.replace("/login");
      return;
    }

    if (res.role === "provider") {
      router.replace("/pro-apply");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/login");
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();
    router.replace(profile?.full_name?.trim() ? "/home" : "/setup");
  };

  if (!context) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
          <Text tone="muted">{t("common.loading")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const title =
    context.purpose === "reset" ? t("auth.resetPasswordTitle") : t("auth.setPasswordTitle");

  return (
    <KeyboardFormScreen
      contentContainerStyle={styles.content}
      footer={
        <Button label={t("common.save")} onPress={submit} loading={loading} disabled={!valid} />
      }
    >
      <Text size="hero" weight="heavy">
        {title}
      </Text>
      <Text tone="muted">
        {t("auth.setPasswordBody")}{" "}
        <Text weight="heavy" style={styles.ltr}>
          {context.maskedPhone}
        </Text>
      </Text>

      <AuthLabeledField label={t("auth.password")}>
        <AuthPasswordField
          value={pw}
          onChangeText={setPw}
          showPassword={show}
          onToggleShow={() => setShow((v) => !v)}
          showPasswordLabel={t("auth.showPassword")}
          hidePasswordLabel={t("auth.hidePassword")}
          autoComplete="new-password"
          placeholder="••••••••"
        />
      </AuthLabeledField>
      <AuthLabeledField label={t("auth.confirmPassword")}>
        <AuthPasswordField
          value={confirmPw}
          onChangeText={setConfirmPw}
          showPassword={showConfirm}
          onToggleShow={() => setShowConfirm((v) => !v)}
          showPasswordLabel={t("auth.showPassword")}
          hidePasswordLabel={t("auth.hidePassword")}
          autoComplete="new-password"
          placeholder="••••••••"
        />
      </AuthLabeledField>

      <Rule ok={longEnough} label={t("auth.ruleLenStrong")} />
      <Rule ok={matches} label={t("auth.passwordsMatch")} />

      {error ? (
        <View style={styles.error}>
          <Text size="sm" weight="bold" tone="danger">
            {error}
          </Text>
        </View>
      ) : null}
    </KeyboardFormScreen>
  );
}

function Rule({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Text size="sm" tone={ok ? "success" : "muted"}>
      {ok ? "✓ " : "○ "}
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.xxl, gap: space.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md },
  ltr: { direction: "ltr" },
  error: { backgroundColor: "#FBE7E6", borderRadius: radius.md, padding: space.md },
});
