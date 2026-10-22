import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { mobileJson, runWithMobileAuthCookies } from "@/lib/mobile/mobileJson.server";
import { completePasswordSetupHandler } from "@/lib/otp/otpHandlers.server";

const BodySchema = z.object({
  password: z.string().min(8),
});

export const Route = createFileRoute("/api/mobile/auth/complete-password")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(await request.json());
        } catch {
          return mobileJson({ ok: false, error: "invalid_request" }, 400);
        }

        try {
          const { result, setCookieHeaders } = await runWithMobileAuthCookies(() =>
            completePasswordSetupHandler(parsed),
          );
          if (!result.ok) {
            const status =
              result.error === "authorization_missing"
                ? 401
                : result.error === "restart_required"
                  ? 409
                  : 400;
            return mobileJson(result, status, setCookieHeaders);
          }
          return mobileJson(result, 200, setCookieHeaders);
        } catch {
          console.error("[mobile.auth.complete-password] failed");
          return mobileJson({ ok: false, error: "password_failed" }, 500);
        }
      },
    },
  },
});
