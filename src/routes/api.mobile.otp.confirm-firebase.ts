import { createFileRoute } from "@tanstack/react-router";
import { mobileJson, runWithMobileAuthCookies } from "@/lib/mobile/mobileJson.server";
import { confirmFirebaseOtpSentHandler } from "@/lib/otp/otpHandlers.server";

export const Route = createFileRoute("/api/mobile/otp/confirm-firebase")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { result, intents } = await runWithMobileAuthCookies(
            confirmFirebaseOtpSentHandler,
          );
          if (!result.ok) {
            return mobileJson(result, 400, intents);
          }
          return mobileJson(result, 200, intents);
        } catch {
          console.error("[mobile.otp.confirm-firebase] failed");
          return mobileJson({ ok: false, error: "confirm_failed" }, 500);
        }
      },
    },
  },
});
