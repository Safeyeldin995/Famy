export type OtpProviderKind = "mock" | "meta" | "firebase";

export type OtpProviderConfigurationStatus =
  | { ok: true; kind: OtpProviderKind }
  | { ok: false; configured: "unset" | "invalid" | "mock_in_production" };

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Non-throwing provider resolution for diagnostics and guarded handlers. */
export function getOtpProviderConfigurationStatus(): OtpProviderConfigurationStatus {
  const configured = process.env.OTP_PROVIDER?.trim();
  if (!configured) {
    return { ok: false, configured: "unset" };
  }
  if (configured !== "mock" && configured !== "meta" && configured !== "firebase") {
    return { ok: false, configured: "invalid" };
  }
  if (isProductionRuntime() && configured === "mock") {
    return { ok: false, configured: "mock_in_production" };
  }
  return { ok: true, kind: configured };
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
