import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { firebaseSendFailureMessage } from "@/lib/auth/firebaseSendFailureMessage";

describe("firebaseSendFailureMessage", () => {
  it.each([
    ["auth/too-many-requests", "en", "Too many attempts from this device"],
    ["auth/quota-exceeded", "en", "SMS service is busy"],
    ["auth/app-not-authorized", "en", "Could not verify this device"],
    ["auth/missing-client-identifier", "ar", "تعذر التحقق من الجهاز"],
  ] as const)("maps %s (%s)", async (code, lang, fragment) => {
    await i18n.changeLanguage(lang);
    const msg = firebaseSendFailureMessage(i18n.t.bind(i18n), code);
    expect(msg).toContain(fragment);
  });
});
