import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { discoverIntegrationGuardTargets, scanFileForForbiddenCliPatterns } from "@/lib/qa/integrationGuardDiscovery";

describe("integration no CLI dependency guard", () => {
  it("covers every file discovered from vitest.otp-integration.config globs", () => {
    const targets = discoverIntegrationGuardTargets();
    expect(targets.length).toBeGreaterThanOrEqual(7);
    for (const relativePath of targets) {
      const absolute = path.resolve(process.cwd(), relativePath);
      expect(fs.existsSync(absolute), `missing ${relativePath}`).toBe(true);
      const hits = scanFileForForbiddenCliPatterns(fs.readFileSync(absolute, "utf8"));
      expect(hits, `${relativePath}: ${hits.join(", ")}`).toEqual([]);
    }
  });
});
