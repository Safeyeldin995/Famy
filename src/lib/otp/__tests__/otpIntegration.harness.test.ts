import { describe, expect, it } from "vitest";
import { uniqueTestPhone } from "./otpIntegration.harness";

describe("uniqueTestPhone", () => {
  it("always produces numeric Egyptian mobile tails even with long alphabetic suffixes", () => {
    const phone = uniqueTestPhone("monitoring");
    expect(phone).toMatch(/^\+2019\d{8}$/);
  });

  it("keeps short numeric suffix behavior stable", () => {
    const phone = uniqueTestPhone("a");
    expect(phone).toMatch(/^\+2019\d{8}$/);
  });

  it("produces different phones for different letter-only suffixes called back-to-back", () => {
    const phoneA = uniqueTestPhone("a");
    const phoneB = uniqueTestPhone("b");
    expect(phoneA).not.toBe(phoneB);
    expect(phoneA).toMatch(/^\+2019\d{8}$/);
    expect(phoneB).toMatch(/^\+2019\d{8}$/);
  });
});
