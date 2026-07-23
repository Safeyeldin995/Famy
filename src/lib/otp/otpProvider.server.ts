import type { OTPProvider } from "./OtpProvider";
import { assertMockOtpProviderAllowed } from "./MockOTPProvider.server";

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export async function resolveOtpProvider(): Promise<OTPProvider> {
  const configured = process.env.OTP_PROVIDER?.trim();

  if (isProductionRuntime()) {
    if (configured !== "meta") {
      throw new Error("Production requires OTP_PROVIDER=meta.");
    }
    const { createMetaWhatsAppOTPProvider } = await import("./MetaWhatsAppOTPProvider.server");
    return createMetaWhatsAppOTPProvider();
  }

  if (configured === "mock") {
    assertMockOtpProviderAllowed();
    const { getMockOtpProvider } = await import("./MockOTPProvider.server");
    return getMockOtpProvider();
  }

  if (configured === "meta") {
    const { createMetaWhatsAppOTPProvider } = await import("./MetaWhatsAppOTPProvider.server");
    return createMetaWhatsAppOTPProvider();
  }

  throw new Error(
    "OTP_PROVIDER must be set explicitly: use OTP_PROVIDER=mock for local/test or OTP_PROVIDER=meta for WhatsApp delivery.",
  );
}
