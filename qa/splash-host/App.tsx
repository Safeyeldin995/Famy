import { useCallback, useMemo, useState } from "react";
import { FamySplashScreen } from "@/components/famio/FamySplashScreen";
import { FamySplashScreenLegacy } from "../tests/splash/fixtures/FamySplashScreen.legacy";

function readSearch() {
  const params = new URLSearchParams(window.location.search);
  return {
    impl: params.get("impl") === "legacy" ? "legacy" : "current",
    reducedMotion: params.get("reducedMotion") === "1",
  };
}

export function App() {
  const { impl, reducedMotion } = useMemo(readSearch, []);
  const [generation, setGeneration] = useState(0);
  const [completeCount, setCompleteCount] = useState(0);
  const onAnimationComplete = useCallback(() => {
    setCompleteCount((count) => count + 1);
  }, [generation]);

  const Splash = impl === "legacy" ? FamySplashScreenLegacy : FamySplashScreen;

  return (
    <div data-testid="splash-host" data-impl={impl} data-generation={generation}>
      <div
        style={{
          position: "fixed",
          zIndex: 200,
          top: 8,
          left: 8,
          display: "flex",
          gap: 8,
          alignItems: "center",
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        <div data-testid="complete-count">{completeCount}</div>
        <button
          type="button"
          data-testid="rerender"
          onClick={() => setGeneration((value) => value + 1)}
        >
          rerender
        </button>
      </div>
      <Splash onAnimationComplete={onAnimationComplete} reducedMotion={reducedMotion} />
    </div>
  );
}
