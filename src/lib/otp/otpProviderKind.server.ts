export type OtpProviderKind = "mock" | "meta" | "firebase";

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export function resolveOtpProviderKind(): OtpProviderKind {
  const configured = process.env.OTP_PROVIDER?.trim();

  if (isProductionRuntime()) {
    if (configured === "mock") {
      throw new Error("Production requires OTP_PROVIDER=meta or OTP_PROVIDER=firebase.");
    }
    if (configured === "meta" || configured === "firebase") {
      return configured;
    }
    throw new Error("Production requires OTP_PROVIDER=meta or OTP_PROVIDER=firebase.");
  }

  if (configured === "mock" || configured === "meta" || configured === "firebase") {
    return configured;
  }

  throw new Error("OTP_PROVIDER must be set explicitly: use mock, meta, or firebase.");
}

export function isFirebaseOtpProvider(): boolean {
  return resolveOtpProviderKind() === "firebase";
}
