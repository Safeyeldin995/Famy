import type { OtpSendMeta } from "./OtpProvider";
import type { OTPProvider } from "./OtpProvider";

export function isOtpMockLoggingAllowed(): boolean {
  const env = process.env.NODE_ENV;
  return env === "development" || env === "test";
}

export function assertMockOtpProviderAllowed(): void {
  if (!isOtpMockLoggingAllowed()) {
    throw new Error(
      "MockOTPProvider is not allowed in production. Configure a real OTP delivery provider.",
    );
  }
}

/**
 * Development / test OTP delivery stub. Write-only: never stores or returns OTPs.
 * Plaintext OTP is logged server-side only in development and test environments.
 */
export class MockOTPProvider implements OTPProvider {
  constructor() {
    assertMockOtpProviderAllowed();
  }

  async sendOTP(phone: string, message: string, meta: OtpSendMeta): Promise<void> {
    console.info("[MockOTPProvider]", {
      phone,
      otp: meta.otp,
      timestamp: meta.timestamp.toISOString(),
      purpose: meta.purpose,
      message,
    });
  }
}

let _mockOtpProvider: MockOTPProvider | undefined;

export function getMockOtpProvider(): MockOTPProvider {
  assertMockOtpProviderAllowed();
  if (!_mockOtpProvider) _mockOtpProvider = new MockOTPProvider();
  return _mockOtpProvider;
}
