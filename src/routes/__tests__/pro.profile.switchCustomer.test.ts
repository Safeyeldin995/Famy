import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const profileSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../pro.profile.tsx"),
  "utf8",
);

describe("provider profile switch-to-customer row", () => {
  it("keeps the existing customer-app journey on the More list", () => {
    expect(profileSource).toContain("Globe");
    expect(profileSource).toContain('customerPath("/home")');
    expect(profileSource).toContain('t("pro.profile.switchCustomer")');
  });
});
