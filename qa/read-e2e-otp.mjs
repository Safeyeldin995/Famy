import fs from "fs";
import path from "path";

const CAPTURE_DIR = path.resolve(process.cwd(), "qa/.otp-capture");

/**
 * Read and delete a one-time QA E2E OTP capture file.
 * Requires QA_E2E_OTP_CAPTURE=1 on the app server and in this process.
 */
export function readQaE2eOtp(phone, purpose) {
  if (process.env.QA_E2E_OTP_CAPTURE !== "1") {
    throw new Error("QA_E2E_OTP_CAPTURE=1 is required for Playwright OTP signup.");
  }
  const file = path.join(CAPTURE_DIR, `${encodeURIComponent(phone)}__${purpose}.otp`);
  if (!fs.existsSync(file)) {
    throw new Error(`No captured OTP for ${phone} (${purpose}). Ensure the app server has QA_E2E_OTP_CAPTURE=1.`);
  }
  const otp = fs.readFileSync(file, "utf8").trim();
  fs.unlinkSync(file);
  return otp;
}
