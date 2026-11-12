import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";
import { Asset } from "expo-asset";
import * as SplashScreen from "expo-splash-screen";
import { useSession } from "@/lib/session";
import {
  FAMY_SPLASH_ASSEMBLED,
  FAMY_SPLASH_BACKGROUND,
  famySplashState,
  famySplashYPosition,
  markFamySplashPlayed,
  shouldPlayFamySplash,
} from "@shared/splash/famySplashState";
import { scheduleLaunchGateIntroFailSafe } from "./launchGateTiming";
import famWhite from "../../assets/splash/fam-white.png";
import yBodyWhite from "../../assets/splash/y-body-white.png";
import yEyesWhite from "../../assets/splash/y-eyes-white.png";

export {
  LAUNCH_GATE_FAIL_SAFE_BUFFER_MS,
  LAUNCH_GATE_INTRO_MS,
  LAUNCH_GATE_REDUCE_MOTION_MS,
  launchGateFailSafeDelayMs,
} from "./launchGateTiming";

// A native process is the counterpart of a web tab session, not installation storage.
let playedThisProcess = false;
const imageSources = [famWhite, yBodyWhite, yEyesWhite];

export function LaunchGate({
  bootstrapReady,
  children,
}: {
  bootstrapReady: boolean;
  children: ReactNode;
}) {
  const { ready: sessionReady } = useSession();
  const [done, setDone] = useState(() =>
    Platform.OS === "web" ? !shouldPlayFamySplash() : playedThisProcess,
  );
  const [reduced, setReduced] = useState<boolean | null>(null);
  const finish = useCallback(() => {
    playedThisProcess = true;
    if (Platform.OS === "web") markFamySplashPlayed();
    setDone(true);
  }, []);
  useEffect(() => {
    if (!bootstrapReady || !sessionReady) return;
    let cancelled = false;
    const clearFailSafe = scheduleLaunchGateIntroFailSafe(false, finish);
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (!cancelled) setReduced(value);
      })
      .catch(() => {
        if (!cancelled) setReduced(true);
      });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) =>
      setReduced(value),
    );
    return () => {
      cancelled = true;
      clearFailSafe();
      subscription.remove();
    };
  }, [bootstrapReady, sessionReady, finish]);
  return (
    <View style={styles.root}>
      {children}
      {!done && (
        <View
          testID="launch-overlay"
          style={StyleSheet.absoluteFill}
          pointerEvents="auto"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <NativeFamySplash
            reducedMotion={reduced === true}
            running={bootstrapReady && sessionReady && reduced !== null}
            onComplete={finish}
          />
        </View>
      )}
    </View>
  );
}

export function NativeFamySplash({
  reducedMotion,
  running,
  onComplete,
}: {
  reducedMotion: boolean;
  running: boolean;
  onComplete: () => void;
}) {
  const { width } = useWindowDimensions();
  const scale = Math.min(width * 0.71, 385) / FAMY_SPLASH_ASSEMBLED.width;
  const { fam, y } = FAMY_SPLASH_ASSEMBLED;
  const famFullW = fam.width * scale;
  const famFullH = fam.height * scale;
  const yFullW = y.width * scale;
  const yFullH = y.height * scale;
  const yBaseX = y.x * scale;
  const yBaseY = y.y * scale;
  const [assetsReady, setAssetsReady] = useState(false);
  const elapsed = useSharedValue(reducedMotion ? 999 : 0);
  const clockStart = useSharedValue(-1);
  const completed = useSharedValue(false);
  const completeFromUI = useCallback(() => onComplete(), [onComplete]);
  const completeOnce = useCallback(() => {
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    let cancelled = false;
    void Asset.loadAsync(imageSources)
      .then(() => {
        if (!cancelled) setAssetsReady(true);
      })
      .catch(() => {
        if (!cancelled) onComplete();
      });
    return () => {
      cancelled = true;
    };
  }, [onComplete]);

  const hideNativeSplash = useCallback(() => {
    void SplashScreen.hideAsync().catch(() => {
      /* May already be hidden. */
    });
  }, []);

  const frameCallback = useFrameCallback((frame) => {
    "worklet";
    if (completed.value) return;
    if (clockStart.value < 0) {
      clockStart.value = frame.timestamp;
      runOnJS(hideNativeSplash)();
    }
    elapsed.value = (frame.timestamp - clockStart.value) / 1000;
    if (famySplashState(elapsed.value).animationComplete) {
      completed.value = true;
      runOnJS(completeOnce)();
    }
  });

  useEffect(() => {
    const active = running && assetsReady && !reducedMotion;
    frameCallback.setActive(active);
  }, [assetsReady, frameCallback, reducedMotion, running]);

  useEffect(() => {
    if (!running || !assetsReady) return;
    if (reducedMotion) {
      hideNativeSplash();
      completeOnce();
    }
  }, [assetsReady, completeOnce, hideNativeSplash, reducedMotion, running]);

  const famStyle = useAnimatedStyle(() => {
    const state = famySplashState(elapsed.value);
    const progress = state.wordRevealProgress;
    return {
      opacity: progress,
      transform: [{ translateX: (-famFullW * (1 - progress)) / 2 }, { scaleX: progress }],
    };
  });

  const yMotionStyle = useAnimatedStyle(() => {
    const state = famySplashState(elapsed.value);
    const position = famySplashYPosition(state.smileMoveProgress, state.smileOffsetY);
    return {
      opacity: state.smileOpacity,
      transform: [
        { translateX: position.x * scale - yBaseX },
        { translateY: position.y * scale - yBaseY },
        { scale: state.smileScale },
      ],
    };
  });

  const yEyesStyle = useAnimatedStyle(() => {
    const state = famySplashState(elapsed.value);
    return {
      opacity: state.eyesClosed ? 0 : state.smileOpacity,
      transform: [
        {
          translateX:
            famySplashYPosition(state.smileMoveProgress, state.smileOffsetY).x * scale - yBaseX,
        },
        {
          translateY:
            famySplashYPosition(state.smileMoveProgress, state.smileOffsetY).y * scale - yBaseY,
        },
        { scale: state.smileScale },
      ],
    };
  });

  if (!assetsReady && !reducedMotion) return <View style={styles.overlay} />;

  return (
    <View style={styles.overlay}>
      <View
        style={{
          direction: "ltr",
          width: FAMY_SPLASH_ASSEMBLED.width * scale,
          height: FAMY_SPLASH_ASSEMBLED.height * scale,
        }}
      >
        <View
          style={{
            position: "absolute",
            left: fam.x * scale,
            top: fam.y * scale,
            width: famFullW,
            height: famFullH,
            overflow: "hidden",
          }}
        >
          <Animated.Image
            source={famWhite}
            onError={completeFromUI}
            resizeMode="stretch"
            style={[{ width: famFullW, height: famFullH }, famStyle]}
          />
        </View>
        <Animated.Image
          source={yBodyWhite}
          onError={completeFromUI}
          resizeMode="stretch"
          style={[
            {
              position: "absolute",
              left: y.x * scale,
              top: yBaseY,
              width: yFullW,
              height: yFullH,
            },
            yMotionStyle,
          ]}
        />
        <Animated.Image
          source={yEyesWhite}
          onError={completeFromUI}
          resizeMode="stretch"
          style={[
            {
              position: "absolute",
              left: y.x * scale,
              top: yBaseY,
              width: yFullW,
              height: yFullH,
            },
            yEyesStyle,
          ]}
        />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: FAMY_SPLASH_BACKGROUND,
  },
});
