import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";

describe("otp route i18n", () => {
  it("renders Arabic in RTL", async () => {
    await i18n.changeLanguage("ar");
    expect(i18n.dir()).toBe("rtl");
    expect(i18n.t("auth.signupVerifyTitle")).toBeTruthy();
    await i18n.changeLanguage("en");
    expect(i18n.dir()).toBe("ltr");
  });
});
