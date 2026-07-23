import { describe, expect, it } from "vitest";
import { z } from "zod";

const VerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Invalid code"),
});

describe("verify OTP schema", () => {
  it("requires exactly six digits", () => {
    expect(() => VerifySchema.parse({ code: "12345" })).toThrow();
    expect(() => VerifySchema.parse({ code: "1234567" })).toThrow();
    expect(() => VerifySchema.parse({ code: "12a456" })).toThrow();
    expect(VerifySchema.parse({ code: "123456" }).code).toBe("123456");
  });
});
