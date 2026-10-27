export type OtpProviderKind = "mock" | "meta" | "firebase" | "http_sms";

const PRODUCTION_OTP_PROVIDERS: OtpProviderKind[] = ["meta", "firebase", "http_sms"];
const PRODUCTION_OTP_PROVIDERS_MESSAGE =
  "Production requires OTP_PROVIDER=meta, OTP_PROVIDER=http_sms, or OTP_PROVIDER=firebase.";

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export function resolveOtpProviderKind(): OtpProviderKind {
  const configured = process.env.OTP_PROVIDER?.trim();

  if (isProductionRuntime()) {
    if (configured === "mock") {
      throw new Error(PRODUCTION_OTP_PROVIDERS_MESSAGE);
    }
    if (configured && PRODUCTION_OTP_PROVIDERS.includes(configured as OtpProviderKind)) {
      return configured as OtpProviderKind;
    }
    throw new Error(PRODUCTION_OTP_PROVIDERS_MESSAGE);
  }

  if (
    configured === "mock" ||
    configured === "meta" ||
    configured === "firebase" ||
    configured === "http_sms"
  ) {
    return configured;
  }

  throw new Error("OTP_PROVIDER must be set explicitly: use mock, meta, http_sms, or firebase.");
}

export function isFirebaseOtpProvider(): boolean {
  return resolveOtpProviderKind() === "firebase";
}
