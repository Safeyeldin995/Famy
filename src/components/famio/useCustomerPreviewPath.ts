import { useSyncExternalStore } from "react";
import { isPreviewRoute } from "@/lib/preview/constants";
import { previewPath } from "@/lib/preview/previewPath";

const subscribeNoop = () => () => {};

/** Browser-only preview routing must not change the first hydration render's href. */
export function useCustomerPreviewMode() {
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  return mounted && isPreviewRoute();
}

export function useCustomerPreviewPath() {
  const preview = useCustomerPreviewMode();
  return (path: string) => (preview ? previewPath(path) : path);
}
