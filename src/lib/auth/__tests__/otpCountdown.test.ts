import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { formatOtpExpiryClock, formatOtpSecondsDuration } from "@/lib/auth/otpCountdown";

describe("otpCountdown", () => {
  it("formats resend seconds fully in Arabic", async () => {
    await i18n.changeLanguage("ar");
    const label = formatOtpSecondsDuration(28, i18n.t.bind(i18n));
    expect(label).toContain("ثانية");
    expect(label).not.toContain("s");
    expect(label).toMatch(/28/);
  });

  it("formats resend seconds fully in English", async () => {
    await i18n.changeLanguage("en");
    const label = formatOtpSecondsDuration(28, i18n.t.bind(i18n));
    expect(label).toContain("28 seconds");
  });

  it("formats expiry clock with locale numerals", async () => {
    await i18n.changeLanguage("ar");
    expect(formatOtpExpiryClock(305)).toMatch(/5:05/);
    await i18n.changeLanguage("en");
    expect(formatOtpExpiryClock(305)).toBe("5:05");
  });
});
