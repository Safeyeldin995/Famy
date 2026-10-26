import { useState } from "react";
import { Image, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { reloadAppAsync } from "expo";
import { Languages } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { applyDirection, saveLanguage } from "@/lib/i18n";
import { completeOnboarding } from "@/lib/onboarding";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { colors } from "@/ui/theme";

const slides = [
  require("../../assets/onboarding/slide-1-trusted.png"),
  require("../../assets/onboarding/slide-2-booking.png"),
  require("../../assets/onboarding/slide-3-peace.png"),
];

export default function Onboarding() {
  const { t, i18n } = useTranslation();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const ar = i18n.language === "ar";
  // Same locale/Latin-digit policy as the web formatter, without its web-only store import.
  const numbers = new Intl.NumberFormat(ar ? "ar-EG-u-nu-latn" : "en-EG");
  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    await completeOnboarding();
    router.replace("/login");
  };
  const switchLanguage = async () => {
    const next = ar ? "en" : "ar";
    await saveLanguage(next);
    await i18n.changeLanguage(next);
    if (applyDirection(next)) await reloadAppAsync();
  };
  return (
    <SafeAreaView
      edges={["left", "right"]}
      style={[styles.page, { direction: ar ? "rtl" : "ltr" }]}
    >
      <View style={[styles.content, { paddingTop: Math.max(insets.top, 8) }]}>
        <View style={styles.header}>
          <View style={styles.side}>
            <Pressable accessibilityRole="button" onPress={finish} style={styles.skip}>
              <Text weight="heavy" tone="brand">
                {t("onboarding.skip")}
              </Text>
            </Pressable>
          </View>
          <Image
            source={require("../../assets/images/famy-wordmark.png")}
            accessibilityLabel={t("common.appName")}
            style={styles.wordmark}
            resizeMode="contain"
          />
          <View style={[styles.side, { alignItems: "flex-end" }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(ar ? "common.switchToEnglish" : "common.switchToArabic")}
              onPress={switchLanguage}
              style={styles.language}
            >
              <Languages size={14} color={colors.foreground} />
              <Text size="xs" weight="heavy">
                {t(ar ? "common.langShortEn" : "common.langShortAr")}
              </Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.illustration}>
          <Image
            source={slides[index]}
            accessible={false}
            resizeMode="contain"
            style={{
              width: "100%",
              maxWidth: 320,
              height: Math.min(height * 0.42, 352),
              maxHeight: "100%",
            }}
          />
        </View>
        <View style={styles.copy} accessibilityLiveRegion="polite">
          <Text size="title" weight="heavy" style={styles.title}>
            {t(`onboarding.slide${index + 1}Title`)}
          </Text>
          <Text weight="bold" tone="muted" style={styles.body}>
            {t(`onboarding.slide${index + 1}Body`)}
          </Text>
        </View>
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <View style={styles.dots} accessible={false}>
            {slides.map((_, n) => (
              <View
                key={n}
                style={[
                  styles.dot,
                  {
                    width: index === n ? 32 : 8,
                    backgroundColor: index === n ? colors.brand : colors.border,
                  },
                ]}
              />
            ))}
          </View>
          <Text size="xs" weight="bold" tone="muted" style={styles.counter}>
            {t("onboarding.pageOf", {
              current: numbers.format(index + 1),
              total: numbers.format(slides.length),
            })}
          </Text>
          <Button
            label={t(index === 2 ? "common.getStarted" : "common.continue")}
            disabled={finishing}
            onPress={index === 2 ? finish : () => setIndex(index + 1)}
            style={{ borderRadius: 999 }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "white" },
  content: { flex: 1, paddingHorizontal: 20, paddingBottom: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 },
  side: { flex: 1 },
  skip: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 8,
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  wordmark: { height: 40, width: 120 },
  language: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "white",
    shadowColor: colors.ink,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  illustration: {
    flex: 1,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  copy: { alignItems: "center" },
  title: { textAlign: "center", lineHeight: 30 },
  body: { marginTop: 12, maxWidth: 320, textAlign: "center", lineHeight: 23 },
  footer: { marginTop: 24, paddingTop: 8 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 12 },
  dot: { height: 8, borderRadius: 999 },
  counter: { textAlign: "center", marginBottom: 16, lineHeight: 16 },
});
