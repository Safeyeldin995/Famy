export type ClientOtpProviderKind = "mock" | "meta" | "firebase";

export function getClientOtpProviderKind(): ClientOtpProviderKind {
  const configured = import.meta.env.VITE_OTP_PROVIDER?.trim();
  if (configured === "firebase" || configured === "meta" || configured === "mock") {
    return configured;
  }
  return "mock";
}

export function isClientFirebaseOtpProvider(): boolean {
  return getClientOtpProviderKind() === "firebase";
}
