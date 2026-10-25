import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { KeyboardFormScreen } from "@/ui/KeyboardFormScreen";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, fonts, radius, space } from "@/ui/theme";

/** Post sign-up password: collect display name before entering the app. */
export default function AuthNameScreen() {
  const { t, i18n } = useTranslation();
  const inputFont = (i18n.language === "en" ? fonts.en : fonts.ar).bold;
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim().length > 1;

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
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ full_name: name.trim() })
      .eq("id", user.id);
    setLoading(false);
    if (updateError) {
      setError(t("common.tryAgain"));
      return;
    }
    router.replace("/home");
  };

  return (
    <KeyboardFormScreen contentContainerStyle={styles.content}>
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

          {error ? (
            <View style={styles.error}>
              <Text size="sm" weight="bold" tone="danger">
                {error}
              </Text>
            </View>
          ) : null}

          <Button
            label={t("common.continue")}
            onPress={submit}
            loading={loading}
            disabled={!valid}
          />
    </KeyboardFormScreen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.xxl, gap: space.lg },
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
  error: { backgroundColor: "#FBE7E6", borderRadius: radius.md, padding: space.md },
});
