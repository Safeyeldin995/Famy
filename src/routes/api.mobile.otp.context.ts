import { createFileRoute } from "@tanstack/react-router";
import { mobileJson, runWithMobileAuthCookies } from "@/lib/mobile/mobileJson.server";
import { getOtpScreenContextHandler } from "@/lib/otp/otpHandlers.server";

export const Route = createFileRoute("/api/mobile/otp/context")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { result, intents } = await runWithMobileAuthCookies(
            getOtpScreenContextHandler,
          );
          if (!result.ok) {
            return mobileJson(result, 404, intents);
          }
          return mobileJson(result, 200, intents);
        } catch {
          console.error("[mobile.otp.context] failed");
          return mobileJson({ ok: false, error: "context_failed" }, 500);
        }
      },
    },
  },
});
