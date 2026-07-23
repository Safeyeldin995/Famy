import fs from "fs";
import path from "path";
import type { DbOtpPurpose } from "./types";

const CAPTURE_DIR = path.resolve(process.cwd(), "qa/.otp-capture");

function isDevOrTestRuntime(): boolean {
  const env = process.env.NODE_ENV;
  return env === "development" || env === "test";
}

/** QA E2E harness only — never import from application routes. */
export function isQaE2eOtpCaptureEnabled(): boolean {
  if (process.env.QA_E2E_OTP_CAPTURE !== "1") return false;
  if (!isDevOrTestRuntime()) {
    throw new Error(
      "QA_E2E_OTP_CAPTURE=1 is forbidden in production. Remove this environment variable.",
    );
  }
  return true;
}

export function captureOtpForQaE2e(phone: string, purpose: DbOtpPurpose, otp: string): void {
  if (!isQaE2eOtpCaptureEnabled()) return;
  fs.mkdirSync(CAPTURE_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(CAPTURE_DIR, `${encodeURIComponent(phone)}__${purpose}.otp`);
  fs.writeFileSync(file, otp, { encoding: "utf8", mode: 0o600 });
}

export function consumeCapturedQaE2eOtp(phone: string, purpose: DbOtpPurpose): string | null {
  if (!isQaE2eOtpCaptureEnabled()) return null;
  const file = path.join(CAPTURE_DIR, `${encodeURIComponent(phone)}__${purpose}.otp`);
  if (!fs.existsSync(file)) return null;
  const otp = fs.readFileSync(file, "utf8").trim();
  fs.unlinkSync(file);
  return otp;
}
