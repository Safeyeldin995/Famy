import { createFileRoute } from "@tanstack/react-router";
import { mobileOtpSendFailureStatus } from "@/lib/mobile/mobileApiStatus.server";
import { mobileJson, runWithMobileAuthCookies } from "@/lib/mobile/mobileJson.server";
import { resendOtpHandler } from "@/lib/otp/otpHandlers.server";

export const Route = createFileRoute("/api/mobile/otp/resend")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { result, intents } = await runWithMobileAuthCookies(resendOtpHandler);
          if (!result.ok) {
            return mobileJson(result, mobileOtpSendFailureStatus(result.error), intents);
          }
          const { resolveOtpProviderKind } = await import("@/lib/otp/otpProviderKind.server");
          const delivery = resolveOtpProviderKind() === "firebase" ? "firebase" : "server";
          return mobileJson({ ...result, delivery }, 200, intents);
        } catch {
          console.error("[mobile.otp.resend] failed");
          return mobileJson({ ok: false, error: "resend_failed" }, 500);
        }
      },
    },
  },
});
