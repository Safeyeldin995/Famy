import { useSyncExternalStore } from "react";

const subscribeNoop = () => () => {};

/** Keep the SSR and first client href equal, then enable local preview navigation. */
export function useProPath() {
  const preview = useSyncExternalStore(
    subscribeNoop,
    () => window.location.pathname.startsWith("/preview/pro"),
    () => false,
  );
  return (path: string) =>
    preview && (path === "/pro" || path.startsWith("/pro/")) ? `/preview${path}` : path;
}
