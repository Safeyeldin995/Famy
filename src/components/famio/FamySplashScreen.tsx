import { useCallback, useEffect, useRef, useState } from "react";
import famWhite from "@/assets/splash/fam-white.png";
import yBodyWhite from "@/assets/splash/y-body-white.png";
import yEyesWhite from "@/assets/splash/y-eyes-white.png";
import {
  FAMY_SPLASH_ASSEMBLED,
  FAMY_SPLASH_BACKGROUND,
  famySplashState,
  famySplashYPosition,
} from "@/lib/splash/famySplashState";

const LOGO_MAX_WIDTH_PX = 385;
const LOGO_WIDTH_RATIO = 0.71;

type SplashAssets = {
  fam: string;
  yBody: string;
  yEyes: string;
};

function preloadSplashAssets(): Promise<SplashAssets> {
  const sources = { fam: famWhite, yBody: yBodyWhite, yEyes: yEyesWhite };
  const entries = Object.entries(sources) as [keyof SplashAssets, string][];

  return Promise.race([
    Promise.all(
      entries.map(
        ([key, src]) =>
          new Promise<[keyof SplashAssets, string]>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve([key, src]);
            img.onerror = () => reject(new Error(`splash asset failed: ${key}`));
            img.src = src;
          }),
      ),
    ).then((loaded) => Object.fromEntries(loaded) as SplashAssets),
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error("splash asset timeout")), 8000);
    }),
  ]);
}

function logoWidthPx() {
  if (typeof window === "undefined") return LOGO_MAX_WIDTH_PX;
  return Math.min(window.innerWidth * LOGO_WIDTH_RATIO, LOGO_MAX_WIDTH_PX);
}

export function FamySplashScreen({
  onAnimationComplete,
  reducedMotion = false,
}: {
  onAnimationComplete: () => void;
  reducedMotion?: boolean;
}) {
  const [assets, setAssets] = useState<SplashAssets | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [logoWidth, setLogoWidth] = useState(logoWidthPx);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const completedRef = useRef(false);

  const famRef = useRef<HTMLImageElement>(null);
  const yBodyRef = useRef<HTMLImageElement>(null);
  const yEyesRef = useRef<HTMLImageElement>(null);

  const scale = logoWidth / FAMY_SPLASH_ASSEMBLED.width;
  const logoHeight = FAMY_SPLASH_ASSEMBLED.height * scale;
  const { fam, y } = FAMY_SPLASH_ASSEMBLED;

  // Held in refs so `finish` and the animation effect keep a stable identity. A caller that
  // passes an inline arrow (the normal React idiom) must not be able to restart the animation.
  const onCompleteRef = useRef(onAnimationComplete);
  useEffect(() => {
    onCompleteRef.current = onAnimationComplete;
  }, [onAnimationComplete]);

  const finish = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onCompleteRef.current();
  }, []);

  useEffect(() => {
    const onResize = () => setLogoWidth(logoWidthPx());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    preloadSplashAssets()
      .then((loaded) => {
        if (!cancelled) setAssets(loaded);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loadFailed) finish();
  }, [loadFailed, finish]);

  const applyFrame = useCallback(
    (state: ReturnType<typeof famySplashState>) => {
      const yPos = famySplashYPosition(state.smileMoveProgress, state.smileOffsetY);
      const yStyle: Partial<CSSStyleDeclaration> = {
        left: `${yPos.x * scale}px`,
        top: `${yPos.y * scale}px`,
        width: `${y.width * scale}px`,
        height: `${y.height * scale}px`,
        opacity: String(state.smileOpacity),
        transform: `scale(${state.smileScale})`,
        transformOrigin: "center center",
      };

      if (yBodyRef.current) Object.assign(yBodyRef.current.style, yStyle);
      if (yEyesRef.current) {
        Object.assign(yEyesRef.current.style, {
          ...yStyle,
          opacity: String(state.eyesClosed ? 0 : state.smileOpacity),
        });
      }

      const clipRight = (1 - state.wordRevealProgress) * 100;
      if (famRef.current) {
        famRef.current.style.opacity = String(state.wordRevealProgress);
        famRef.current.style.clipPath = `inset(0 ${clipRight}% 0 0)`;
      }
    },
    [scale, y.width, y.height],
  );

  const applyFrameRef = useRef(applyFrame);
  useEffect(() => {
    applyFrameRef.current = applyFrame;
  }, [applyFrame]);

  useEffect(() => {
    if (!assets) return;

    const finalState = {
      ...famySplashState(999),
      smileOpacity: 1,
      smileScale: 1,
      smileOffsetY: 0,
      smileMoveProgress: 1,
      wordRevealProgress: 1,
      animationComplete: true,
      eyesClosed: false,
    };

    if (reducedMotion) {
      applyFrameRef.current(finalState);
      finish();
      return;
    }

    // Never rewind a run that has already started.
    if (startRef.current === null) startRef.current = performance.now();

    const tick = (now: number) => {
      const t = (now - (startRef.current ?? now)) / 1000;
      const state = famySplashState(t);
      applyFrameRef.current(state);
      if (state.animationComplete) {
        finish();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [assets, reducedMotion, finish]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ backgroundColor: FAMY_SPLASH_BACKGROUND }}
      role="img"
      aria-label="Famy"
    >
      <div className="relative" style={{ width: logoWidth, height: logoHeight }}>
        <img
          ref={famRef}
          src={assets?.fam}
          alt=""
          className="absolute block max-w-none"
          style={{
            left: `${fam.x * scale}px`,
            top: `${fam.y * scale}px`,
            width: `${fam.width * scale}px`,
            height: `${fam.height * scale}px`,
            opacity: 0,
          }}
          draggable={false}
        />

        <img
          ref={yBodyRef}
          src={assets?.yBody}
          alt=""
          className="absolute max-w-none"
          style={{
            left: 0,
            top: 0,
            opacity: 0,
            transform: "scale(0.84)",
            transformOrigin: "center center",
          }}
          draggable={false}
        />
        <img
          ref={yEyesRef}
          src={assets?.yEyes}
          alt=""
          className="absolute max-w-none pointer-events-none"
          style={{
            left: 0,
            top: 0,
            opacity: 0,
            transform: "scale(0.84)",
            transformOrigin: "center center",
          }}
          draggable={false}
        />
      </div>
    </div>
  );
}
