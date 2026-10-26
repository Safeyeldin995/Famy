import { createFileRoute } from "@tanstack/react-router";
import { mobileJson, runWithMobileAuthCookies } from "@/lib/mobile/mobileJson.server";
import { abandonOtpFlowHandler } from "@/lib/otp/otpHandlers.server";

export const Route = createFileRoute("/api/mobile/otp/abandon")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { result, intents } =
            await runWithMobileAuthCookies(abandonOtpFlowHandler);
          return mobileJson(result, 200, intents);
        } catch {
          console.error("[mobile.otp.abandon] failed");
          return mobileJson({ ok: false, error: "abandon_failed" }, 500);
        }
      },
    },
  },
});
