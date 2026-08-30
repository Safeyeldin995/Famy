import {
  buildErrorLogInsert,
  normalizeErrorLogLabel,
  normalizeErrorLogRoute,
  sanitizeErrorMessage,
  type ErrorLogInsertInput,
  type ErrorLogSource,
} from "./error-logging";

export type { ErrorLogInsertInput, ErrorLogSource };

export {
  sanitizeErrorMessage,
  normalizeErrorLogRoute,
  normalizeErrorLogLabel,
  buildErrorLogInsert,
};

/**
 * Persist a safe error event via service role. Never throws to callers.
 */
export async function logErrorEvent(input: ErrorLogInsertInput): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("error_logs").insert({
      message_safe: input.messageSafe,
      source: input.source,
      context_route: input.contextRoute ?? null,
      context_label: input.contextLabel ?? null,
    });
    if (error) {
      console.error("[error-logging] Failed to persist error_log row", error.message);
    }
  } catch (persistError) {
    console.error("[error-logging] Unexpected persistence failure", persistError);
  }
}

export async function logCapturedError(
  error: unknown,
  input: Omit<ErrorLogInsertInput, "messageSafe">,
): Promise<void> {
  await logErrorEvent(buildErrorLogInsert(error, input));
}
