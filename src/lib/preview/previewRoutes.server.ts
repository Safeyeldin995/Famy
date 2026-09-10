/** Server-only gate for design-preview routes. Default off unless explicitly enabled. */
export function isPreviewRoutesEnabled(): boolean {
  return process.env.PREVIEW_ROUTES_ENABLED === "true";
}
