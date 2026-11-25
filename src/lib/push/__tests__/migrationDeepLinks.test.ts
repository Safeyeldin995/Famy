import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mapNotificationDeepLink, workspaceHome } from "../mapNotificationDeepLink";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const migrationsDir = path.join(repoRoot, "supabase/migrations");

function extractMigrationDeepLinks(): string[] {
  const links = new Set<string>();
  const re = /'(\/[a-z0-9/_-]+)'/gi;
  for (const file of readdirSync(migrationsDir)) {
    if (!file.endsWith(".sql")) continue;
    const text = readFileSync(path.join(migrationsDir, file), "utf8");
    if (!text.includes("deep_link")) continue;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const candidate = match[1]!;
      if (candidate.startsWith("/pro/") || candidate === "/wallet" || candidate.startsWith("/booking")) {
        links.add(candidate.replace(/\/+$/, "") || "/");
      }
    }
  }
  return [...links].sort();
}

describe("migration-emitted deep links", () => {
  const samples = extractMigrationDeepLinks();

  it("includes wallet and provider setup links from SQL migrations", () => {
    expect(samples).toContain("/wallet");
    expect(samples).toContain("/pro/setup/personal");
    expect(samples).toContain("/pro/documents");
  });

  it("maps every inventoried migration path away from the wrong workspace home", () => {
    for (const link of samples) {
      const workspace = link.startsWith("/pro") || link.includes("/pro/") ? "provider" : "customer";
      const opposite: "customer" | "provider" = workspace === "provider" ? "customer" : "provider";
      const mapped = mapNotificationDeepLink(link, workspace);
      expect(mapped).not.toEqual(workspaceHome(opposite));
    }
  });
});