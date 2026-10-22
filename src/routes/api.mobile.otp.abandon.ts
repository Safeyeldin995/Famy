import { createFileRoute } from "@tanstack/react-router";
import { mobileJson, runWithMobileAuthCookies } from "@/lib/mobile/mobileJson.server";
import { abandonOtpFlowHandler } from "@/lib/otp.functions";

export const Route = createFileRoute("/api/mobile/otp/abandon")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { result, setCookieHeaders } =
            await runWithMobileAuthCookies(abandonOtpFlowHandler);
          return mobileJson(result, 200, setCookieHeaders);
        } catch {
          console.error("[mobile.otp.abandon] failed");
          return mobileJson({ ok: false, error: "abandon_failed" }, 500);
        }
      },
    },
  },
});
