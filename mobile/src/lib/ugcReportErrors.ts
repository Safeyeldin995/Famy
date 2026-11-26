/** i18n key for a report that the server refused (#523). */
export function ugcReportErrorKey(error: unknown): string {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  if (message.includes("UGC_REPORT_OWN_MESSAGE")) return "ugc.errors.ownMessage";
  if (message.includes("UGC_REPORT_LIMIT")) return "ugc.errors.limit";
  return "ugc.errors.generic";
}
