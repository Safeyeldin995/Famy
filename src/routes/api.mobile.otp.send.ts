import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { mobileJson, runWithMobileAuthCookies } from "@/lib/mobile/mobileJson.server";
import { mobileOtpSendHandler } from "@/lib/otp.functions";

const BodySchema = z.object({
  phone: z.string().min(1),
  purpose: z.enum(["signup", "reset"]),
  role: z.enum(["customer", "provider"]).optional(),
});

export const Route = createFileRoute("/api/mobile/otp/send")({
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
            mobileOtpSendHandler(parsed),
          );
          if (!result.ok) {
            return mobileJson(result, 429, setCookieHeaders);
          }
          const { resolveOtpProviderKind } = await import("@/lib/otp/otpProviderKind.server");
          const delivery = resolveOtpProviderKind() === "firebase" ? "firebase" : "server";
          return mobileJson({ ...result, delivery }, 200, setCookieHeaders);
        } catch (error) {
          if (error instanceof Error && error.message.includes("Invalid E.164")) {
            return mobileJson({ ok: false, error: "invalid_phone" }, 400);
          }
          console.error("[mobile.otp.send] failed");
          return mobileJson({ ok: false, error: "send_failed" }, 500);
        }
      },
    },
  },
});
