import { useEffect, useState } from "react";

/**
 * Re-renders the caller every `intervalMs` so render-time clock checks
 * (e.g. the lesson join window) update while the page stays open.
 */
export function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
