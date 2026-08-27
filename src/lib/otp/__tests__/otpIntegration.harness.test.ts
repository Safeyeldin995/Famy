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
});
