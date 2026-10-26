import { createFileRoute } from "@tanstack/react-router";
import { mobileJson, runWithMobileAuthCookies } from "@/lib/mobile/mobileJson.server";
import { resendOtpHandler } from "@/lib/otp/otpHandlers.server";

export const Route = createFileRoute("/api/mobile/otp/resend")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { result, intents } = await runWithMobileAuthCookies(resendOtpHandler);
          if (!result.ok) {
            const status = result.error === "rate_limited" ? 429 : 400;
            return mobileJson(result, status, intents);
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
