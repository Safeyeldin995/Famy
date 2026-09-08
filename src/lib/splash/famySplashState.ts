export const FAMY_SPLASH_BACKGROUND = "#F10E72";
export const FAMY_SPLASH_FOREGROUND = "#FFFFFF";

export const FAMY_SPLASH_ASSEMBLED = {
  width: 1092,
  height: 344,
  fam: { x: 0, y: 0, width: 814, height: 304 },
  y: { x: 830, y: 18, width: 262, height: 326 },
} as const;

export const FAMY_SPLASH_DURATION_S = 4.2;

export type FamySplashState = {
  background: string;
  foreground: string;
  smileOpacity: number;
  smileScale: number;
  smileOffsetY: number;
  eyesClosed: boolean;
  smileMoveProgress: number;
  wordRevealProgress: number;
  animationComplete: boolean;
};

/** Approved splash timing — t is elapsed seconds. */
export function famySplashState(t: number): FamySplashState {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const ease = (v: number) => 1 - Math.pow(1 - clamp(v), 3);
  const appear = ease((t - 0.12) / 0.55);
  return {
    background: FAMY_SPLASH_BACKGROUND,
    foreground: FAMY_SPLASH_FOREGROUND,
    smileOpacity: appear,
    smileScale: 0.84 + 0.16 * appear,
    smileOffsetY: 18 * (1 - appear),
    eyesClosed: t > 0.74 && t < 0.84,
    smileMoveProgress: ease((t - 0.9) / 0.7),
    wordRevealProgress: ease((t - 1.04) / 0.65),
    animationComplete: t >= FAMY_SPLASH_DURATION_S,
  };
}

/** Y position when centered alone in the assembled coordinate space. */
export function famySplashCenteredY() {
  const { width, height, y } = FAMY_SPLASH_ASSEMBLED;
  return {
    x: width / 2 - y.width / 2,
    y: height / 2 - y.height / 2,
  };
}

export function famySplashYPosition(moveProgress: number, offsetY: number) {
  const centered = famySplashCenteredY();
  const final = FAMY_SPLASH_ASSEMBLED.y;
  return {
    x: centered.x + (final.x - centered.x) * moveProgress,
    y: centered.y + (final.y - centered.y) * moveProgress + offsetY,
  };
}

export const FAMY_SPLASH_SESSION_KEY = "famy.splash.played";

export function shouldPlayFamySplash(): boolean {
  if (typeof sessionStorage === "undefined") return true;
  try {
    return sessionStorage.getItem(FAMY_SPLASH_SESSION_KEY) !== "1";
  } catch {
    return true;
  }
}

export function markFamySplashPlayed(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(FAMY_SPLASH_SESSION_KEY, "1");
  } catch {
    /* fail-soft */
  }
}
