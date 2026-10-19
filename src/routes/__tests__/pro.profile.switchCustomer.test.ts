import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const profileSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../pro.profile.tsx"),
  "utf8",
);

describe("provider profile customer-app switch row", () => {
  it("does not expose a switch-to-customer link on the More list", () => {
    expect(profileSource).not.toContain('t("pro.profile.switchCustomer")');
    expect(profileSource).not.toContain('customerPath("/home")');
  });
});
