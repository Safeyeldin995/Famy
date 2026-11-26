import { describe, expect, it } from "vitest";
import { onlineSessionTokenErrorKey, isMediaDeviceErrorMessage } from "../onlineWebSessionMessage";

describe("onlineSessionTokenErrorKey", () => {
  it("maps known token errors to i18n keys", () => {
    expect(onlineSessionTokenErrorKey("payment_required")).toBe("onlineSession.errors.payment_required");
    expect(onlineSessionTokenErrorKey("unknown_code")).toBeNull();
  });
});

describe("isMediaDeviceErrorMessage", () => {
  it("detects permission and device failures", () => {
    expect(isMediaDeviceErrorMessage("Permission denied")).toBe(true);
    expect(isMediaDeviceErrorMessage("network timeout")).toBe(false);
  });
});