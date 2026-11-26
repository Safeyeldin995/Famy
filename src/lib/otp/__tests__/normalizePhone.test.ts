import { describe, expect, it } from "vitest";
import {
  egyptMobileE164,
  egyptMobileNationalDigits,
  isValidE164Phone,
  isValidEgyptMobile,
  normalizeDigitsToWestern,
  normalizePhoneE164,
} from "../normalizePhone";
import { normalizePhone } from "../OtpService";

const CANONICAL = "+201221000633";
const LOCAL_WESTERN = "01221000633";

function toArabicIndic(western: string): string {
  return western.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
}

function toPersian(western: string): string {
  return western.replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
}

describe("normalizeDigitsToWestern", () => {
  it("maps Arabic-Indic and Persian digits to Western digits", () => {
    expect(normalizeDigitsToWestern(toArabicIndic("0123"))).toBe("0123");
    expect(normalizeDigitsToWestern(toPersian("0123"))).toBe("0123");
  });
});

describe("normalizePhoneE164", () => {
  it("normalizes equivalent Egyptian formats to the same E.164 value", () => {
    expect(normalizePhoneE164("+201221000633")).toBe(CANONICAL);
    expect(normalizePhoneE164("00201221000633")).toBe(CANONICAL);
    expect(normalizePhoneE164("201221000633")).toBe(CANONICAL);
    expect(normalizePhoneE164(LOCAL_WESTERN)).toBe(CANONICAL);
    expect(isValidE164Phone(CANONICAL)).toBe(true);
  });

  it("normalizes Arabic-Indic and Persian local numbers like Western digits", () => {
    expect(normalizePhoneE164(toArabicIndic(LOCAL_WESTERN))).toBe(CANONICAL);
    expect(normalizePhoneE164(toPersian(LOCAL_WESTERN))).toBe(CANONICAL);
    expect(isValidE164Phone(normalizePhoneE164(toArabicIndic(LOCAL_WESTERN)))).toBe(true);
  });

  it("rejects invalid lengths after normalization", () => {
    expect(isValidE164Phone(normalizePhoneE164("123"))).toBe(false);
    expect(isValidE164Phone(normalizePhoneE164(toArabicIndic("123")))).toBe(false);
  });
});

describe("normalizePhone (OtpService re-export)", () => {
  it("preserves Western-digit login behavior", () => {
    expect(normalizePhone("01012345678")).toBe("+201012345678");
  });

  it("normalizes OTP/login input with Arabic-Indic digits", () => {
    expect(normalizePhone(toArabicIndic("01012345678"))).toBe("+201012345678");
    expect(normalizePhone(toPersian("01012345678"))).toBe("+201012345678");
  });
});

describe("egyptMobileE164", () => {
  it("accepts every common way of typing an Egyptian mobile", () => {
    for (const raw of [
      "01005522352",
      "1005522352",
      "+201005522352",
      "00201005522352",
      "201005522352",
      "010 0552 2352",
      "٠١٠٠٥٥٢٢٣٥٢",
    ]) {
      expect(egyptMobileE164(raw)).toBe("+201005522352");
      expect(isValidEgyptMobile(raw)).toBe(true);
    }
    expect(egyptMobileNationalDigits("01005522352")).toBe("1005522352");
  });

  it("rejects numbers that are not Egyptian mobiles", () => {
    for (const raw of ["", "0100552235", "010055223521", "01305522352", "0225551234", "+441005522352"]) {
      expect(egyptMobileE164(raw)).toBeNull();
      expect(isValidEgyptMobile(raw)).toBe(false);
    }
  });
});
