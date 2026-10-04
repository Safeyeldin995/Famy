import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routesDir = dirname(fileURLToPath(import.meta.url));

function readRoute(name: string) {
  return readFileSync(join(routesDir, name), "utf8");
}

describe("customer route guard wiring", () => {
  it.each(["home.tsx", "bookings.tsx", "book.$providerId.tsx", "provider.$id.tsx"])(
    "guards %s for provider-only accounts",
    (file) => {
      const source = readRoute(`../${file}`);
      expect(source).toContain("useProviderOnlyCustomerRedirect");
    },
  );
});
