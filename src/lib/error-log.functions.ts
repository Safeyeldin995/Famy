import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  normalizeErrorLogLabel,
  normalizeErrorLogRoute,
  sanitizeErrorMessage,
} from "./error-logging";

const ClientErrorSchema = z.object({
  message: z.string().min(1).max(500),
  contextRoute: z.string().max(200).optional(),
  contextLabel: z.string().max(120).optional(),
});

export const logClientErrorFn = createServerFn({ method: "POST" })
  .validator((data) => ClientErrorSchema.parse(data))
  .handler(async ({ data }) => {
    const { assertClientErrorLogRateLimit } = await import("./error-log-rate-limit.server");
    if (!(await assertClientErrorLogRateLimit())) {
      return { ok: true as const };
    }

    const { logErrorEvent } = await import("./error-logging.server");
    await logErrorEvent({
      source: "client",
      messageSafe: sanitizeErrorMessage(data.message),
      contextRoute: normalizeErrorLogRoute(data.contextRoute),
      contextLabel: normalizeErrorLogLabel(data.contextLabel),
    });
    return { ok: true as const };
  });
