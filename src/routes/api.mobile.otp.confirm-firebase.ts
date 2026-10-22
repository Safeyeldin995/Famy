import { createFileRoute } from "@tanstack/react-router";
import { mobileJson, runWithMobileAuthCookies } from "@/lib/mobile/mobileJson.server";
import { confirmFirebaseOtpSentHandler } from "@/lib/otp/otpHandlers.server";

export const Route = createFileRoute("/api/mobile/otp/confirm-firebase")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { result, setCookieHeaders } = await runWithMobileAuthCookies(
            confirmFirebaseOtpSentHandler,
          );
          if (!result.ok) {
            return mobileJson(result, 400, setCookieHeaders);
          }
          return mobileJson(result, 200, setCookieHeaders);
        } catch {
          console.error("[mobile.otp.confirm-firebase] failed");
          return mobileJson({ ok: false, error: "confirm_failed" }, 500);
        }
      },
    },
  },
});
