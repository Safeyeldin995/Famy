import type { OTPProvider } from "./OtpProvider";
import { assertMockOtpProviderAllowed } from "./MockOTPProvider.server";
import { resolveOtpProviderKind } from "./otpProviderKind.server";

function createFirebaseNoopProvider(): OTPProvider {
  return {
    async sendOTP() {
      throw new Error("Firebase OTP delivery is handled by the client SDK.");
    },
  };
}

export async function resolveOtpProvider(): Promise<OTPProvider> {
  const kind = resolveOtpProviderKind();

  if (kind === "firebase") {
    return createFirebaseNoopProvider();
  }

  if (kind === "mock") {
    assertMockOtpProviderAllowed();
    const { getMockOtpProvider } = await import("./MockOTPProvider.server");
    return getMockOtpProvider();
  }

  const { createMetaWhatsAppOTPProvider } = await import("./MetaWhatsAppOTPProvider.server");
  return createMetaWhatsAppOTPProvider();
}

export { resolveOtpProviderKind, isFirebaseOtpProvider } from "./otpProviderKind.server";
