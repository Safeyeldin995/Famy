import { describe, expect, it } from "vitest";
import { mapFirebasePhoneConfirmError } from "@/lib/auth/firebasePhoneConfirmErrors";

describe("mapFirebasePhoneConfirmError", () => {
  it("treats expired sessions as session_lost", () => {
    expect(mapFirebasePhoneConfirmError("auth/session-expired")).toBe("session_lost");
    expect(mapFirebasePhoneConfirmError("auth/code-expired")).toBe("session_lost");
    expect(mapFirebasePhoneConfirmError("session_lost")).toBe("session_lost");
  });

  it("treats wrong codes as invalid_code", () => {
    expect(mapFirebasePhoneConfirmError("auth/invalid-verification-code")).toBe("invalid_code");
  });
});
