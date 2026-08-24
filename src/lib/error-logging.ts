export type ErrorLogSource = "client" | "server" | "edge";

const SECRET_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /sb_(?:publishable|secret)_[A-Za-z0-9_-]+/gi,
  /(?:api[_-]?key|secret|token|password|authorization)\s*[:=]\s*\S+/gi,
];

const MAX_MESSAGE_LENGTH = 500;
const MAX_ROUTE_LENGTH = 200;
const MAX_LABEL_LENGTH = 120;

/**
 * Produce a safe, triage-friendly error message — never raw stacks or secrets.
 */
export function sanitizeErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message || error.name || "unknown_error"
      : typeof error === "string"
        ? error
        : "unknown_error";

  let message = raw.replace(/\s+/g, " ").trim();
  for (const pattern of SECRET_PATTERNS) {
    message = message.replace(pattern, "[redacted]");
  }
  if (!message) message = "unknown_error";
  if (message.length > MAX_MESSAGE_LENGTH) {
    message = `${message.slice(0, MAX_MESSAGE_LENGTH - 3)}...`;
  }
  return message;
}

export function normalizeErrorLogRoute(route: string | null | undefined): string | null {
  if (!route) return null;
  const trimmed = route.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_ROUTE_LENGTH ? trimmed.slice(0, MAX_ROUTE_LENGTH) : trimmed;
}

export function normalizeErrorLogLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const trimmed = label.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_LABEL_LENGTH ? trimmed.slice(0, MAX_LABEL_LENGTH) : trimmed;
}

export type ErrorLogInsertInput = {
  source: ErrorLogSource;
  messageSafe: string;
  contextRoute?: string | null;
  contextLabel?: string | null;
};

export function buildErrorLogInsert(
  error: unknown,
  input: Omit<ErrorLogInsertInput, "messageSafe">,
): ErrorLogInsertInput {
  return {
    ...input,
    messageSafe: sanitizeErrorMessage(error),
    contextRoute: normalizeErrorLogRoute(input.contextRoute),
    contextLabel: normalizeErrorLogLabel(input.contextLabel),
  };
}
