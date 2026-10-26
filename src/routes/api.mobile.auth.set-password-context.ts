import { createFileRoute } from "@tanstack/react-router";
import { mobileJson, runWithMobileAuthCookies } from "@/lib/mobile/mobileJson.server";
import { getSetPasswordContextHandler } from "@/lib/otp/otpHandlers.server";

export const Route = createFileRoute("/api/mobile/auth/set-password-context")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { result, intents } = await runWithMobileAuthCookies(
            getSetPasswordContextHandler,
          );
          if (!result.ok) {
            return mobileJson(result, 404, intents);
          }
          return mobileJson(result, 200, intents);
        } catch {
          console.error("[mobile.auth.set-password-context] failed");
          return mobileJson({ ok: false, error: "context_failed" }, 500);
        }
      },
    },
  },
});
