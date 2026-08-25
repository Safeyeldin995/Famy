export type ClientOtpProviderKind = "mock" | "meta" | "firebase";

export class OtpProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OtpProviderConfigurationError";
  }
}

export function resolveClientOtpProviderKind(options: {
  configured?: string;
  isProduction: boolean;
}): ClientOtpProviderKind {
  const configured = options.configured?.trim();
  if (configured === "firebase" || configured === "meta" || configured === "mock") {
    return configured;
  }
  if (options.isProduction) {
    throw new OtpProviderConfigurationError(
      "VITE_OTP_PROVIDER must be set to mock, meta, or firebase in production builds.",
    );
  }
  return "mock";
}

export function getClientOtpProviderKind(): ClientOtpProviderKind {
  return resolveClientOtpProviderKind({
    configured: import.meta.env.VITE_OTP_PROVIDER,
    isProduction: import.meta.env.PROD,
  });
}

export function isClientFirebaseOtpProvider(): boolean {
  return getClientOtpProviderKind() === "firebase";
}
