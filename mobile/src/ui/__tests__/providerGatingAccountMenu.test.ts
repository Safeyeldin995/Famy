import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

describe("provider gating account menu (#447)", () => {
  const screens = [
    join(root, "provider/PendingHomeScreen.tsx"),
    join(import.meta.dirname, "../../app/(provider)/pro-apply.tsx"),
    join(import.meta.dirname, "../../app/(provider)/pro-documents.tsx"),
  ];

  it("exposes ProviderAccountMenu on pending, apply, and documents routes", () => {
    for (const file of screens) {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("ProviderAccountMenu");
    }
  });
});