import { useEffect, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { contactPhoneErrorKey } from "@shared/auth/oauthShared";
import { normalizeDigitsToWestern } from "@shared/otp/normalizePhone";
import { supabase } from "@/lib/supabase";
import { KeyboardFormScreen } from "@/ui/KeyboardFormScreen";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, fonts, radius, space } from "@/ui/theme";

/** After Google/Apple sign-in when profile phone or name is missing. */
export default function OAuthSetupScreen() {
  const { t, i18n } = useTranslation();
  const inputFont = (i18n.language === "en" ? fonts.en : fonts.ar).bold;
  const [name, setName] = useState("");
  const [needsPhone, setNeedsPhone] = useState(false);
  const [contactPhone, setContactPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const contactPhoneDigits = normalizeDigitsToWestern(contactPhone).replace(/\D/g, "");
  const contactPhoneValid = /^(0|20)?1[0125]\d{8}$/.test(contactPhoneDigits);
  const valid = name.trim().length > 1 && (!needsPhone || contactPhoneValid);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("phone, full_name")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (profile?.full_name) setName(profile.full_name);
      setNeedsPhone(!profile?.phone);
      setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async () => {
    if (!valid || loading) return;
    setLoading(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      router.replace("/login");
      return;
    }
    if (needsPhone) {
      const { error: phoneError } = await supabase.rpc("set_my_contact_phone", {
        p_phone: contactPhoneDigits,
      });
      if (phoneError) {
        setLoading(false);
        setError(t(contactPhoneErrorKey(phoneError.message)));
        return;
      }
    }
    const { error: nameError } = await supabase
      .from("profiles")
      .update({ full_name: name.trim() })
      .eq("id", user.id);
    setLoading(false);
    if (nameError) {
      setError(t("common.tryAgain"));
      return;
    }
    router.replace("/home");
  };

  if (booting) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text tone="muted">{t("common.loading")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <KeyboardFormScreen
      contentContainerStyle={styles.content}
      footer={
        <Button label={t("common.continue")} onPress={submit} loading={loading} disabled={!valid} />
      }
    >
      <Text size="hero" weight="heavy">
        {t("setup.title")}
      </Text>
      <Text tone="muted">{t("auth.signUpSubtitle")}</Text>

      <View style={{ gap: space.sm }}>
        <Text size="sm" weight="bold" tone="muted">
          {t("setup.name")}
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          autoComplete="name"
          placeholder={t("setup.namePlaceholder")}
          placeholderTextColor={colors.muted}
          style={[styles.input, { fontFamily: inputFont }]}
        />
      </View>

      {needsPhone ? (
        <View style={{ gap: space.sm }}>
          <Text size="sm" weight="bold" tone="muted">
            {t("auth.phoneNumber")}
          </Text>
          <View style={[styles.field, styles.ltr]}>
            <View style={styles.prefix}>
              <Text weight="heavy">🇪🇬 +20</Text>
            </View>
            <TextInput
              value={contactPhone}
              onChangeText={(v) => setContactPhone(v.replace(/[^\d٠-٩ ]/g, ""))}
              placeholder={t("auth.phonePlaceholder")}
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              autoComplete="tel"
              style={[styles.input, { fontFamily: inputFont, textAlign: "left", flex: 1 }]}
            />
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
    </KeyboardFormScreen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.xxl, gap: space.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    fontSize: 16,
    color: colors.foreground,
  },
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
  error: { backgroundColor: "#FBE7E6", borderRadius: radius.md, padding: space.md },
});
