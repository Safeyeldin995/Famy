/**
 * OTP & auth server functions (client-safe RPC entrypoints).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const SendSchema = z.object({
  phone: z.string().min(1),
  purpose: z.enum(["signup", "reset"]),
  role: z.enum(["customer", "provider"]).optional(),
});
const VerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Invalid code"),
});
const VerifyFirebaseSchema = z.object({
  idToken: z.string().min(20),
});
const PasswordSchema = z.object({
  password: z.string().min(8),
});

export const getOtpScreenContextFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getOtpScreenContextHandler } = await import("@/lib/otp/otpHandlers.server");
  return getOtpScreenContextHandler();
});

export const getSetPasswordContextFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getSetPasswordContextHandler } = await import("@/lib/otp/otpHandlers.server");
  return getSetPasswordContextHandler();
});

export const sendOtpFn = createServerFn({ method: "POST" })
  .inputValidator((d) => SendSchema.parse(d))
  .handler(async ({ data }) => {
    const { sendOtpHandler } = await import("@/lib/otp/otpHandlers.server");
    return sendOtpHandler(data);
  });

export const confirmFirebaseOtpSentFn = createServerFn({ method: "POST" }).handler(async () => {
  const { confirmFirebaseOtpSentHandler } = await import("@/lib/otp/otpHandlers.server");
  return confirmFirebaseOtpSentHandler();
});

export const beginFirebaseOtpFn = createServerFn({ method: "POST" })
  .inputValidator((d) => SendSchema.parse(d))
  .handler(async ({ data }) => {
    const { beginFirebaseOtpHandler } = await import("@/lib/otp/otpHandlers.server");
    return beginFirebaseOtpHandler(data);
  });

export const resendOtpFn = createServerFn({ method: "POST" }).handler(async () => {
  const { resendOtpHandler } = await import("@/lib/otp/otpHandlers.server");
  return resendOtpHandler();
});

export const verifyOtpFn = createServerFn({ method: "POST" })
  .inputValidator((d) => VerifySchema.parse(d))
  .handler(async ({ data }) => {
    const { verifyOtpHandler } = await import("@/lib/otp/otpHandlers.server");
    return verifyOtpHandler(data);
  });

export const verifyFirebaseOtpFn = createServerFn({ method: "POST" })
  .inputValidator((d) => VerifyFirebaseSchema.parse(d))
  .handler(async ({ data }) => {
    const { verifyFirebaseOtpHandler } = await import("@/lib/otp/otpHandlers.server");
    return verifyFirebaseOtpHandler(data);
  });

export const completePasswordSetupFn = createServerFn({ method: "POST" })
  .inputValidator((d) => PasswordSchema.parse(d))
  .handler(async ({ data }) => {
    const { completePasswordSetupHandler } = await import("@/lib/otp/otpHandlers.server");
    return completePasswordSetupHandler(data);
  });

export const abandonOtpFlowFn = createServerFn({ method: "POST" }).handler(async () => {
  const { abandonOtpFlowHandler } = await import("@/lib/otp/otpHandlers.server");
  return abandonOtpFlowHandler();
});
