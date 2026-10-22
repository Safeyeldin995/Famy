import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { Image } from "expo-image";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import splashIcon from "@/assets/images/splash-icon.png";
import { useSession } from "@/lib/session";
import { colors } from "./theme";

const LAUNCH_MS = 880;

type Phase = "boot" | "intro" | "done";

export function LaunchGate({
  bootstrapReady,
  children,
}: {
  bootstrapReady: boolean;
  children: ReactNode;
}) {
  const { ready: sessionReady } = useSession();
  const [phase, setPhase] = useState<Phase>("boot");
  const overlayOpacity = useSharedValue(1);
  const logoScale = useSharedValue(0.88);

  useEffect(() => {
    if (!bootstrapReady || !sessionReady || phase !== "boot") return;
    let cancelled = false;
    void (async () => {
      await SplashScreen.hideAsync();
      if (cancelled) return;
      const reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
      if (reduceMotion) {
        setPhase("done");
        return;
      }
      setPhase("intro");
      logoScale.value = withTiming(1, { duration: LAUNCH_MS * 0.55, easing: Easing.out(Easing.cubic) });
      overlayOpacity.value = withTiming(
        0,
        { duration: LAUNCH_MS, easing: Easing.inOut(Easing.quad) },
        (finished) => {
          if (finished) runOnJS(setPhase)("done");
        },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [bootstrapReady, sessionReady, phase, logoScale, overlayOpacity]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));
  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: logoScale.value }],
  }));

  return (
    <View style={styles.root}>
      {children}
      {phase === "intro" ? (
        <Animated.View
          pointerEvents="auto"
          style={[styles.overlay, overlayStyle]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Animated.View style={logoStyle}>
            <Image source={splashIcon} style={styles.logo} contentFit="contain" accessible={false} />
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
  },
  logo: { width: 160, height: 160 },
});
