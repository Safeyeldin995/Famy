import wordmark from "@/assets/images/famy-wordmark.png";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import * as AppleAuthentication from "expo-apple-authentication";
import { useTranslation } from "react-i18next";
import { Briefcase, Eye, EyeOff, User } from "lucide-react-native";
import Svg, { Path } from "react-native-svg";
import { normalizeDigitsToWestern, normalizePhoneE164 } from "@shared/otp/normalizePhone";
import { phoneOtpFlowErrorMessage, startPhoneOtpFlow } from "@/lib/auth/phoneOtpFlow";
import { authEmailForPhone } from "@shared/auth/authEmail";
import type { OAuthProvider } from "@shared/auth/oauthShared";
import { supabase } from "@/lib/supabase";
import {
  enabledMobileOAuthProviders,
  resolvePostMobileOAuthRoute,
  showAppleSignInOnMobile,
  signInWithAppleNative,
  signInWithMobileOAuthBrowser,
} from "@/lib/auth/oauth";
import { logAuthFailure } from "@/lib/auth/authDiagnostics";
import {
  consumePendingLoginNoticeKey,
  handleUserBannedSession,
  isUserBannedAuthError,
} from "@/lib/auth/bannedAccountSession";
import { resolveWorkspace } from "@/lib/session";
import { bodyTextInputProps } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { KeyboardFormScreen } from "@/ui/KeyboardFormScreen";
import { colors, fonts, radius, space } from "@/ui/theme";

type Mode = "signin" | "signup";
type Role = "customer" | "provider";

export default function Login() {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<Mode>("signin");
  const [role, setRole] = useState<Role>("customer");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const oauthProviders = enabledMobileOAuthProviders();
  const showOAuth = mode === "signin" && role === "customer" && oauthProviders.length > 0;

  useEffect(() => {
    const noticeKey = consumePendingLoginNoticeKey();
    if (noticeKey) setError(t(noticeKey));
  }, [t]);

  const phoneValid = normalizeDigitsToWestern(phone).replace(/\D/g, "").length >= 9;
  const inputFont = (i18n.language === "en" ? fonts.en : fonts.ar).bold;

  const signIn = async () => {
    if (!phoneValid || !password || loading) return;
    setError(null);
    setLoading(true);
    const e164 = normalizePhoneE164(phone);
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: authEmailForPhone(e164),
      password,
    });
    if (authError || !data.user) {
      setLoading(false);
      logAuthFailure("sign_in", authError?.code ?? (authError ? "sign_in_failed" : "no_user"));
      if (authError && isUserBannedAuthError(authError)) {
        await handleUserBannedSession();
        return;
      }
      setError(t("auth.invalidCredentials"));
      return;
    }
    const { workspace, roles } = await resolveWorkspace(data.user.id);
    setLoading(false);
    if (role === "provider" && !roles.includes("provider")) {
      logAuthFailure("sign_in", "no_provider_role");
      setError(t("auth.noProviderAccount"));
      return;
    }
    if (workspace === "admin") {
      router.replace("/workspace-on-web");
      return;
    }
    if (workspace === "provider") {
      router.replace("/dashboard");
      return;
    }
    router.replace("/home");
  };

  const finishOAuth = async () => {
    const route = await resolvePostMobileOAuthRoute();
    if (route.kind === "setup") {
      router.replace("/oauth-setup");
      return;
    }
    if (route.kind === "web_admin") {
      router.replace("/workspace-on-web");
      return;
    }
    router.replace(route.path as "/home");
  };

  const runOAuth = async (provider: OAuthProvider, action: () => Promise<void>) => {
    if (oauthLoading || loading) return;
    setError(null);
    setOauthLoading(provider);
    try {
      await action();
      await finishOAuth();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg !== "OAUTH_CANCELLED") {
        logAuthFailure("oauth", msg || "oauth_failed");
        setError(t("oauth.failedBody"));
      }
    } finally {
      setOauthLoading(null);
    }
  };

  const primaryFooter =
    mode === "signin" ? (
      <Button
        label={t("auth.signIn")}
        onPress={signIn}
        loading={loading}
        disabled={!phoneValid || !password || oauthLoading !== null}
      />
    ) : (
      <Button
        label={t("common.sendCode")}
        loading={loading}
        disabled={!phoneValid || oauthLoading !== null}
        onPress={async () => {
          if (!phoneValid || loading) return;
          setError(null);
          setLoading(true);
          const e164 = normalizePhoneE164(phone);
          const send = await startPhoneOtpFlow(e164, "signup", role);
          setLoading(false);
          if (!send.ok) {
            logAuthFailure("signup_send", send.error);
            setError(
              phoneOtpFlowErrorMessage(send.error, t, send.retryAfter, send.firebaseAuthCode),
            );
            return;
          }
          router.push({ pathname: "/otp", params: { purpose: "signup", phone: e164, role } });
        }}
      />
    );

  return (
    <KeyboardFormScreen contentContainerStyle={styles.content} footer={primaryFooter}>
      <Image
        source={wordmark}
        style={styles.wordmark}
        contentFit="contain"
        accessibilityLabel={t("common.appName")}
      />

      <View style={{ gap: space.sm }}>
        <Text size="hero" weight="heavy">
          {mode === "signin" ? t("auth.welcomeBack") : t("auth.signUpTitle")}
        </Text>
        <Text tone="muted">
          {mode === "signin" ? t("auth.signInSubtitle") : t("auth.signUpSubtitle")}
        </Text>
      </View>

      <Segmented
        value={mode}
        onChange={(next) => {
          setMode(next);
          setError(null);
        }}
        options={[
          { value: "signin", label: t("auth.signIn") },
          { value: "signup", label: t("auth.signUp") },
        ]}
      />

      <View style={{ gap: space.sm }}>
        <Text size="sm" weight="bold" tone="muted">
          {t("auth.iAmA")}
        </Text>
        <Segmented
          value={role}
          onChange={setRole}
          options={[
            { value: "customer", label: t("auth.roleCustomer"), icon: User },
            { value: "provider", label: t("auth.roleProvider"), icon: Briefcase },
          ]}
        />
      </View>

      <View style={{ gap: space.sm }}>
        <Text size="sm" weight="bold" tone="muted">
          {t("auth.phoneNumber")}
        </Text>
        <View style={[styles.field, styles.ltr]}>
          <View style={styles.prefix}>
            <Text weight="heavy">🇪🇬 +20</Text>
          </View>
          <TextInput
            {...bodyTextInputProps()}
            value={phone}
            onChangeText={(v) => setPhone(v.replace(/[^\d٠-٩ ]/g, ""))}
            placeholder={t("auth.phonePlaceholder")}
            placeholderTextColor={colors.muted}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            style={[styles.input, { fontFamily: inputFont, textAlign: "left" }]}
          />
        </View>
      </View>

      {mode === "signin" ? (
        <View style={{ gap: space.sm }}>
          <View style={styles.labelRow}>
            <Text size="sm" weight="bold" tone="muted">
              {t("auth.password")}
            </Text>
            <Pressable onPress={() => router.push("/forgot-password")} hitSlop={12}>
              <Text size="sm" weight="heavy" tone="brand">
                {t("auth.forgot")}
              </Text>
            </Pressable>
          </View>
          <View style={styles.field}>
            <TextInput
              {...bodyTextInputProps()}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPw}
              autoComplete="current-password"
              textContentType="password"
              placeholder="••••••••"
              placeholderTextColor={colors.muted}
              onSubmitEditing={signIn}
              style={[styles.input, { fontFamily: inputFont }]}
            />
            <Pressable
              onPress={() => setShowPw((v) => !v)}
              accessibilityLabel={showPw ? t("auth.hidePassword") : t("auth.showPassword")}
              style={styles.eye}
            >
              {showPw ? (
                <EyeOff size={20} color={colors.muted} />
              ) : (
                <Eye size={20} color={colors.muted} />
              )}
            </Pressable>
          </View>
        </View>
      ) : null}

      {error ? (
        <View style={styles.error}>
          <Text size="sm" weight="bold" tone="danger">
            {error}
          </Text>
        </View>
      ) : null}

      {showOAuth ? (
        <View style={{ gap: space.md }}>
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text size="sm" weight="bold" tone="muted">
              {t("oauth.or")}
            </Text>
            <View style={styles.dividerLine} />
          </View>
          {oauthProviders.includes("google") ? (
            <Pressable
              accessibilityRole="button"
              disabled={loading || oauthLoading !== null}
              onPress={() => runOAuth("google", () => signInWithMobileOAuthBrowser("google"))}
              style={({ pressed }) => [
                styles.oauthBtn,
                styles.oauthGoogle,
                pressed && styles.oauthPressed,
                (loading || oauthLoading !== null) && styles.oauthDisabled,
              ]}
            >
              <GoogleMark />
              <Text weight="heavy">
                {oauthLoading === "google"
                  ? t("oauth.redirectingGoogle")
                  : t("oauth.continueWithGoogle")}
              </Text>
            </Pressable>
          ) : null}
          {oauthProviders.includes("apple") && showAppleSignInOnMobile() ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={radius.lg}
              style={styles.appleBtn}
              onPress={() => runOAuth("apple", signInWithAppleNative)}
            />
          ) : oauthProviders.includes("apple") && Platform.OS === "android" ? (
            <Pressable
              accessibilityRole="button"
              disabled={loading || oauthLoading !== null}
              onPress={() => runOAuth("apple", () => signInWithMobileOAuthBrowser("apple"))}
              style={({ pressed }) => [
                styles.oauthBtn,
                styles.oauthApple,
                pressed && styles.oauthPressed,
                (loading || oauthLoading !== null) && styles.oauthDisabled,
              ]}
            >
              <AppleMark color="#fff" />
              <Text weight="heavy" style={{ color: "#fff" }}>
                {oauthLoading === "apple"
                  ? t("oauth.redirectingApple")
                  : t("oauth.continueWithApple")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </KeyboardFormScreen>
  );
}

function GoogleMark() {
  return (
    <Svg width={20} height={20} viewBox="0 0 48 48" accessibilityRole="image">
      <Path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <Path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <Path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <Path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </Svg>
  );
}

function AppleMark({ color = colors.foreground }: { color?: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" accessibilityRole="image">
      <Path
        fill={color}
        d="M17.05 20.28c-.98.95-2.05 1.88-3.08 1.88-1.02 0-1.31-.63-2.42-.63-1.11 0-1.45.64-2.43.66-1 .02-1.76-.93-2.74-1.88C4.25 17.2 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.03-.02 2 .69 2.65.69.63 0 1.81-.85 3.06-.73.52.02 1.98.21 2.92 1.58-.08.05-1.74 1.02-1.72 2.98.03 2.36 2.06 3.15 2.09 3.17-.02.06-.32 1.11-1.05 2.18zM12.03 7.25c.57-.69 1.03-1.65.92-2.61-.89.04-1.96.59-2.6 1.33-.53.61-1 1.58-.88 2.51.93.07 1.88-.47 2.56-1.23z"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.xxl, gap: space.xxl, paddingBottom: 48 },
  wordmark: { width: 120, height: 38, alignSelf: "flex-start" },
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
  eye: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  error: { backgroundColor: "#FBE7E6", borderRadius: radius.md, padding: space.md },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  oauthBtn: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
  },
  oauthGoogle: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  oauthApple: { backgroundColor: "#000" },
  oauthPressed: { opacity: 0.92 },
  oauthDisabled: { opacity: 0.6 },
  appleBtn: { width: "100%", height: 56 },
});
