import { FAMY_SPLASH_DURATION_S } from "@shared/splash/famySplashState";

export const LAUNCH_GATE_INTRO_MS = FAMY_SPLASH_DURATION_S * 1000;
export const LAUNCH_GATE_REDUCE_MOTION_MS = 700;
export const LAUNCH_GATE_FAIL_SAFE_BUFFER_MS = 500;

export function launchGateFailSafeDelayMs(reduceMotion: boolean): number {
  return (
    (reduceMotion ? LAUNCH_GATE_REDUCE_MOTION_MS : LAUNCH_GATE_INTRO_MS) +
    LAUNCH_GATE_FAIL_SAFE_BUFFER_MS
  );
}

/** Intro-phase fail-safe used by LaunchGate (cleared when phase leaves intro or on unmount). */
export function scheduleLaunchGateIntroFailSafe(
  reduceMotion: boolean,
  onDone: () => void,
): () => void {
  const id = setTimeout(onDone, launchGateFailSafeDelayMs(reduceMotion));
  return () => clearTimeout(id);
}
