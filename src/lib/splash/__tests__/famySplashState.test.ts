import { describe, expect, it } from "vitest";
import {
  FAMY_SPLASH_DURATION_S,
  famySplashCenteredY,
  famySplashState,
  famySplashYPosition,
} from "@/lib/splash/famySplashState";

describe("famySplashState", () => {
  it("starts with hidden smile and completes at 4.2s", () => {
    const start = famySplashState(0);
    expect(start.smileOpacity).toBe(0);
    expect(start.smileScale).toBeCloseTo(0.84);
    expect(start.animationComplete).toBe(false);

    const end = famySplashState(FAMY_SPLASH_DURATION_S);
    expect(end.smileOpacity).toBe(1);
    expect(end.smileScale).toBe(1);
    expect(end.smileMoveProgress).toBe(1);
    expect(end.wordRevealProgress).toBe(1);
    expect(end.animationComplete).toBe(true);
  });

  it("blinks eyes between 0.74s and 0.84s", () => {
    expect(famySplashState(0.7).eyesClosed).toBe(false);
    expect(famySplashState(0.78).eyesClosed).toBe(true);
    expect(famySplashState(0.86).eyesClosed).toBe(false);
  });

  it("moves smile from center toward final position", () => {
    const centered = famySplashCenteredY();
    const atStart = famySplashYPosition(0, 0);
    expect(atStart.x).toBeCloseTo(centered.x);
    expect(atStart.y).toBeCloseTo(centered.y);

    const atEnd = famySplashYPosition(1, 0);
    expect(atEnd.x).toBe(830);
    expect(atEnd.y).toBe(18);
  });
});
