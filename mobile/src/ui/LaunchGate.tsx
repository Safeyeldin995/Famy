import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import splashIcon from "@/assets/images/splash-icon.png";
import wordmark from "@/assets/images/famy-wordmark.png";
import { useSession } from "@/lib/session";
import { Text } from "@/ui/Text";
import { colors, space } from "./theme";

const INTRO_MS = 1400;
const REDUCE_MOTION_MS = 700;

type Phase = "branded" | "intro" | "done";

export function LaunchGate({
  bootstrapReady,
  children,
}: {
  bootstrapReady: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { ready: sessionReady } = useSession();
  const [phase, setPhase] = useState<Phase>("branded");
  const overlayOpacity = useSharedValue(1);
  const overlayTranslateY = useSharedValue(0);
  const logoScale = useSharedValue(0.72);
  const brandOpacity = useSharedValue(0);
  const brandTranslateY = useSharedValue(14);

  useEffect(() => {
    if (!bootstrapReady || !sessionReady || phase !== "branded") return;
    let cancelled = false;
    let failSafe: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      await SplashScreen.hideAsync();
      if (cancelled) return;
      const reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
      setPhase("intro");
      const failSafeMs = (reduceMotion ? REDUCE_MOTION_MS : INTRO_MS) + 500;
      failSafe = setTimeout(() => {
        if (!cancelled) setPhase("done");
      }, failSafeMs);
      if (reduceMotion) {
        overlayTranslateY.value = 0;
        logoScale.value = 1;
        brandOpacity.value = 1;
        brandTranslateY.value = 0;
        overlayOpacity.value = withTiming(
          0,
          { duration: REDUCE_MOTION_MS, easing: Easing.out(Easing.quad) },
          (finished) => {
            if (finished) runOnJS(setPhase)("done");
          },
        );
        return;
      }

      logoScale.value = withSequence(
        withTiming(1.06, { duration: INTRO_MS * 0.42, easing: Easing.out(Easing.back(1.4)) }),
        withTiming(1, { duration: INTRO_MS * 0.18, easing: Easing.inOut(Easing.quad) }),
      );
      brandOpacity.value = withDelay(
        INTRO_MS * 0.28,
        withTiming(1, { duration: INTRO_MS * 0.35, easing: Easing.out(Easing.cubic) }),
      );
      brandTranslateY.value = withDelay(
        INTRO_MS * 0.28,
        withTiming(0, { duration: INTRO_MS * 0.35, easing: Easing.out(Easing.cubic) }),
      );
      overlayTranslateY.value = withDelay(
        INTRO_MS * 0.62,
        withTiming(-28, { duration: INTRO_MS * 0.38, easing: Easing.in(Easing.cubic) }),
      );
      overlayOpacity.value = withDelay(
        INTRO_MS * 0.62,
        withTiming(
          0,
          { duration: INTRO_MS * 0.38, easing: Easing.inOut(Easing.quad) },
          (finished) => {
            if (finished) runOnJS(setPhase)("done");
          },
        ),
      );
    })();
    return () => {
      cancelled = true;
      clearTimeout(failSafe);
    };
  }, [
    bootstrapReady,
    sessionReady,
    phase,
    logoScale,
    brandOpacity,
    brandTranslateY,
    overlayOpacity,
    overlayTranslateY,
  ]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
    transform: [{ translateY: overlayTranslateY.value }],
  }));
  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: logoScale.value }],
  }));
  const brandStyle = useAnimatedStyle(() => ({
    opacity: brandOpacity.value,
    transform: [{ translateY: brandTranslateY.value }],
  }));

  const showBrandedLayer = phase !== "done";

  return (
    <View style={styles.root}>
      {children}
      {showBrandedLayer ? (
        <Animated.View
          testID="launch-overlay"
          pointerEvents={phase === "branded" ? "auto" : "none"}
          style={[styles.overlay, overlayStyle]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Animated.View style={logoStyle}>
            <Image
              source={splashIcon}
              style={styles.logo}
              contentFit="contain"
              accessible={false}
            />
          </Animated.View>
          <Animated.View style={[styles.brandBlock, brandStyle]}>
            <Image
              source={wordmark}
              style={styles.wordmark}
              contentFit="contain"
              accessible={false}
            />
            <Text size="sm" tone="inverse" style={styles.tagline}>
              {t("common.tagline")}
            </Text>
          </Animated.View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand,
    paddingHorizontal: space.lg,
  },
  logo: { width: 128, height: 128, marginBottom: space.lg },
  brandBlock: { alignItems: "center", gap: space.sm, maxWidth: 320 },
  wordmark: { width: 132, height: 42 },
  tagline: { lineHeight: 22, textAlign: "center" },
});
