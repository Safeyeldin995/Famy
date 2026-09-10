import { createFileRoute } from "@tanstack/react-router";
import { OtpScreen } from "./otp";

const PREVIEW_OTP_CONTEXT = {
  ok: true as const,
  maskedPhone: "+20 *** *** **78",
  purpose: "signup" as const,
  role: "customer" as const,
  otpExpiresIn: 300,
  resendAvailableIn: 30,
  delivery: "server" as const,
};

export const Route = createFileRoute("/preview/otp")({
  component: PreviewOtp,
});

function PreviewOtp() {
  return <OtpScreen otpContext={PREVIEW_OTP_CONTEXT} previewMode />;
}
