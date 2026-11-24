import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routesDir = dirname(fileURLToPath(import.meta.url));

describe("provider route guard wiring", () => {
  it("redirects admin accounts away from the provider portal", () => {
    const source = readFileSync(join(routesDir, "../pro.tsx"), "utf8");
    expect(source).toContain("useAdminAccountRedirect");
  });
});