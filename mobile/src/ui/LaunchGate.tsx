import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Image,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
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
const sources = [famWhite, yBodyWhite, yEyesWhite];

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
    // Arm before native APIs, image loading or animation callbacks can fail/hang.
    const clearFailSafe = scheduleLaunchGateIntroFailSafe(false, finish);
    void SplashScreen.hideAsync().catch(() => {
      /* May already be hidden. */
    });
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
  const [loaded, setLoaded] = useState<Set<number>>(() => new Set());
  const [elapsed, setElapsed] = useState(0);
  const start = useRef<number | null>(null);
  const completed = useRef(false);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  useEffect(() => {
    if (!running || loaded.size !== 3 || completed.current) return;
    if (reducedMotion) {
      completed.current = true;
      completeRef.current();
      return;
    }
    let frame = 0;
    const tick = (now: number) => {
      if (start.current === null) start.current = now;
      const seconds = (now - start.current) / 1000;
      setElapsed(seconds);
      if (famySplashState(seconds).animationComplete) {
        completed.current = true;
        completeRef.current();
      } else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, reducedMotion, loaded.size]);
  const state = famySplashState(reducedMotion ? 999 : elapsed);
  const scale = Math.min(width * 0.71, 385) / FAMY_SPLASH_ASSEMBLED.width;
  const { fam, y } = FAMY_SPLASH_ASSEMBLED;
  const position = famySplashYPosition(state.smileMoveProgress, state.smileOffsetY);
  const loadedImage = (index: number) => () =>
    setLoaded((previous) => new Set([...previous, index]));
  const yStyle = {
    position: "absolute" as const,
    left: position.x * scale,
    top: position.y * scale,
    width: y.width * scale,
    height: y.height * scale,
    opacity: state.smileOpacity,
    transform: [{ scale: state.smileScale }],
  };
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
            width: fam.width * scale * state.wordRevealProgress,
            height: fam.height * scale,
            overflow: "hidden",
            opacity: state.wordRevealProgress,
          }}
        >
          <Image
            source={sources[0]}
            onLoad={loadedImage(0)}
            onError={onComplete}
            resizeMode="stretch"
            style={{ width: fam.width * scale, height: fam.height * scale }}
          />
        </View>
        <Image
          source={sources[1]}
          onLoad={loadedImage(1)}
          onError={onComplete}
          resizeMode="stretch"
          style={yStyle}
        />
        <Image
          source={sources[2]}
          onLoad={loadedImage(2)}
          onError={onComplete}
          resizeMode="stretch"
          style={[yStyle, { opacity: state.eyesClosed ? 0 : state.smileOpacity }]}
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
