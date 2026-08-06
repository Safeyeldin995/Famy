import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("vitest otp globalSetup export", () => {
  it("exports a default async setup function required by Vitest", () => {
    const setupPath = path.resolve(process.cwd(), "qa/vitest-otp-global-setup.mjs");
    const source = fs.readFileSync(setupPath, "utf8");
    expect(source).toMatch(/export\s+default\s+async\s+function\s+setup/);
    expect(source).not.toMatch(/export\s+function\s+setup/);
    expect(source).not.toMatch(/supabase db query/);
  });
});
