import { useRouterState } from "@tanstack/react-router";
/** Router state is available on the server too; window-only routing causes hydration drift. */
export function useProPath() {
  const preview = useRouterState({
    select: (state) => state.location.pathname.startsWith("/preview/pro"),
  });
  return (path: string) =>
    preview && (path === "/pro" || path.startsWith("/pro/")) ? `/preview${path}` : path;
}
