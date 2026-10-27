import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react-native";
import { router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { Text } from "./Text";
import { colors } from "./theme";

/** Ports the web CustomerPageHeader and CustomerPageHero, not a new page design. */
export function CustomerPageHeader({
  title,
  subtitle,
  backTo,
  right,
  hero = false,
}: {
  title: string;
  subtitle?: string;
  backTo?: Href;
  right?: ReactNode;
  hero?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const rtl = i18n.language === "ar";
  const Icon = hero ? (rtl ? ChevronRight : ChevronLeft) : rtl ? ArrowRight : ArrowLeft;
  const back = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("common.back")}
      onPress={() => backTo && router.navigate(backTo)}
      style={[styles.back, hero && styles.heroBack]}
    >
      <Icon size={20} color={hero ? "white" : colors.foreground} />
    </Pressable>
  );
  if (hero)
    return (
      <LinearGradient colors={["#F32B88", colors.brand]} style={styles.hero}>
        <View style={[styles.row, { justifyContent: "space-between" }]}>
          {back}
          {right}
        </View>
        <Text weight="heavy" tone="inverse" style={styles.heroTitle}>
          {title}
        </Text>
        {subtitle ? (
          <Text tone="inverse" style={{ marginTop: 8, opacity: 0.75 }}>
            {subtitle}
          </Text>
        ) : null}
      </LinearGradient>
    );
  return (
    <View style={styles.header}>
      <View style={styles.row}>
        {backTo ? back : null}
        <View style={{ flex: 1 }}>
          <Text size="xxl" weight="bold">
            {title}
          </Text>
          {subtitle ? (
            <Text size="sm" tone="muted" style={{ marginTop: 4 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  header: {
    backgroundColor: "white",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  back: {
    height: 44,
    width: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  hero: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 56,
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
  },
  heroBack: { borderColor: "rgba(255,255,255,0.25)", backgroundColor: "rgba(255,255,255,0.15)" },
  heroTitle: { fontSize: 28, lineHeight: 33, marginTop: 16 },
});
