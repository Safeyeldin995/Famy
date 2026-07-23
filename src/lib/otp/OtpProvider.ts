import type { DbOtpPurpose } from "./types";

export type OtpSendMeta = {
  purpose: DbOtpPurpose;
  otp: string;
  timestamp: Date;
  requestId: string;
};

export interface OTPProvider {
  sendOTP(phone: string, message: string, meta: OtpSendMeta): Promise<void>;
}
