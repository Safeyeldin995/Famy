import { createServerFn } from "@tanstack/react-start";
import { isPreviewRoutesEnabled } from "@/lib/preview/previewRoutes.server";

/** Server-evaluated check used by /preview beforeLoad — never trust client env. */
export const getPreviewRoutesEnabledFn = createServerFn({ method: "GET" }).handler(
  async () => isPreviewRoutesEnabled(),
);
