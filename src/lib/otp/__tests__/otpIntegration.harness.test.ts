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

  it("never collides across a large batch of suffixes in the same run", () => {
    const suffixes = [
      "aaa",
      "kms",
      "a",
      "b",
      "bc",
      "v1",
      "v2",
      "v3",
      "v4",
      "v5",
      "monitoring",
      ...Array.from({ length: 200 }, (_, index) => `suffix-${index}`),
    ];
    const phones = suffixes.map((suffix) => uniqueTestPhone(suffix));
    expect(new Set(phones).size).toBe(suffixes.length);
    expect(phones[suffixes.indexOf("aaa")]).not.toBe(phones[suffixes.indexOf("kms")]);
    for (const phone of phones) {
      expect(phone).toMatch(/^\+2019\d{8}$/);
    }
  });
});
