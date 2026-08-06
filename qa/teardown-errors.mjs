import { maskUserId } from "./qa-classification.mjs";

/**
 * @param {unknown} err
 */
function extractErrorDetails(err) {
  if (err == null) {
    return { code: undefined, message: "unknown error" };
  }
  if (typeof err === "string") {
    return { code: undefined, message: err };
  }
  if (typeof err !== "object") {
    return { code: undefined, message: String(err) };
  }

  /** @type {Record<string, unknown>} */
  const objectErr = err;
  const code = [
    objectErr.code,
    objectErr.status,
    objectErr.error_code,
    objectErr.name,
  ].find((value) => typeof value === "string" || typeof value === "number");

  const message = [
    objectErr.message,
    objectErr.error_description,
    objectErr.msg,
    objectErr.error,
  ].find((value) => typeof value === "string" && value.trim().length > 0);

  if (!message && Object.keys(objectErr).length === 0) {
    return { code: code ? String(code) : undefined, message: "empty-error-object" };
  }

  if (!message) {
    try {
      return { code: code ? String(code) : undefined, message: JSON.stringify(objectErr) };
    } catch {
      return { code: code ? String(code) : undefined, message: "unserializable-error-object" };
    }
  }

  return { code: code ? String(code) : undefined, message };
}

/**
 * @param {{ operation: string; table?: string; entityType?: string; id?: string; error?: unknown }} params
 */
export function formatTeardownError(params) {
  const { code, message } = extractErrorDetails(params.error);

  return {
    operation: params.operation,
    table: params.table ?? params.entityType ?? "unknown",
    maskedId: params.id ? maskUserId(params.id) : undefined,
    code,
    message,
  };
}

/** @param {ReturnType<typeof formatTeardownError>} entry */
export function logTeardownError(entry) {
  const parts = [
    `[qa-teardown] ${entry.operation}`,
    entry.table,
    entry.maskedId ?? "",
    entry.code ?? "",
    entry.message,
  ].filter(Boolean);
  console.error(parts.join(" "));
}
