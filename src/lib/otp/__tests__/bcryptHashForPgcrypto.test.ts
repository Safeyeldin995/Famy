import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import {
  hashOtpForPgcrypto,
  normalizeBcryptHashForPgcrypto,
} from "../bcryptHashForPgcrypto";

describe("normalizeBcryptHashForPgcrypto", () => {
  it("rewrites $2b$ prefix to $2a$ while preserving cost and hash body", () => {
    const input = "$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012";
    const output = normalizeBcryptHashForPgcrypto(input);
    expect(output).toBe("$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012");
    expect(output.slice(4)).toBe(input.slice(4));
  });

  it("rewrites $2y$ prefix to $2a$", () => {
    const input = "$2y$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012";
    expect(normalizeBcryptHashForPgcrypto(input)).toBe(
      "$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012",
    );
  });

  it("leaves $2a$ hashes unchanged", () => {
    const input = "$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012";
    expect(normalizeBcryptHashForPgcrypto(input)).toBe(input);
  });
});

describe("hashOtpForPgcrypto", () => {
  it("produces a $2a$ hash verifiable by bcryptjs", async () => {
    const hash = await hashOtpForPgcrypto("654321", 10);
    expect(hash.startsWith("$2a$10$")).toBe(true);
    expect(await bcrypt.compare("654321", hash)).toBe(true);
    expect(await bcrypt.compare("000000", hash)).toBe(false);
  });
});
