import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { useTranslation } from "react-i18next";
import { Briefcase, Eye, EyeOff, User } from "lucide-react-native";
import { normalizeDigitsToWestern, normalizePhoneE164 } from "@shared/otp/normalizePhone";
import { authEmailForPhone } from "@shared/auth/authEmail";
import { appConfig, supabase } from "@/lib/supabase";
import { resolveWorkspace } from "@/lib/session";
import { Button } from "@/ui/Button";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
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
  const [error, setError] = useState<string | null>(null);

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
      setError(t("auth.invalidCredentials"));
      return;
    }
    const { workspace, roles } = await resolveWorkspace(data.user.id);
    setLoading(false);
    if (role === "provider" && !roles.includes("provider")) {
      setError(t("auth.noProviderAccount"));
      return;
    }
    router.replace(workspace === "customer" && role === "customer" ? "/home" : "/workspace-on-web");
  };

  // Sign-up and password reset need the phone-code flow, which moves to the
  // app in the next phase. Until then they open the same pages on the web.
  const openWeb = (path: string) => WebBrowser.openBrowserAsync(`${appConfig.webOrigin}${path}`);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Image
            source={require("@/assets/images/famy-wordmark.png")}
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
                <Pressable onPress={() => openWeb("/auth/forgot")} hitSlop={12}>
                  <Text size="sm" weight="heavy" tone="brand">
                    {t("auth.forgot")}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.field}>
                <TextInput
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
                  {showPw ? <EyeOff size={20} color={colors.muted} /> : <Eye size={20} color={colors.muted} />}
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

          {mode === "signin" ? (
            <Button
              label={t("auth.signIn")}
              onPress={signIn}
              loading={loading}
              disabled={!phoneValid || !password}
            />
          ) : (
            <Button label={t("common.sendCode")} onPress={() => openWeb("/login")} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
});
