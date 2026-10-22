import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { mobileJson, runWithMobileAuthCookies } from "@/lib/mobile/mobileJson.server";
import { verifyFirebaseOtpHandler, verifyOtpHandler } from "@/lib/otp.functions";

const BodySchema = z.union([
  z.object({ code: z.string().regex(/^\d{6}$/) }),
  z.object({ idToken: z.string().min(20) }),
]);

export const Route = createFileRoute("/api/mobile/otp/verify")({
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
          const { result, setCookieHeaders } = await runWithMobileAuthCookies(async () => {
            if ("idToken" in parsed) {
              return verifyFirebaseOtpHandler({ idToken: parsed.idToken });
            }
            return verifyOtpHandler({ code: parsed.code });
          });

          if (!result.ok) {
            const status = result.error === "flow_mismatch" ? 409 : 400;
            return mobileJson(result, status, setCookieHeaders);
          }

          const { access_token, refresh_token, userId, isNewUser, ...rest } = result as {
            ok: true;
            access_token: string;
            refresh_token: string;
            userId: string;
            isNewUser: boolean;
          };
          void rest;
          return mobileJson(
            { ok: true, access_token, refresh_token, userId, isNewUser },
            200,
            setCookieHeaders,
          );
        } catch {
          console.error("[mobile.otp.verify] failed");
          return mobileJson({ ok: false, error: "verify_failed" }, 500);
        }
      },
    },
  },
});
