import { globSync } from "node:fs";
import path from "node:path";
import fs from "node:fs";

/** Integration globs from vitest.otp-integration.config.ts */
export const OTP_INTEGRATION_INCLUDE_GLOBS = [
  "src/lib/otp/__tests__/*.integration.test.ts",
  "src/lib/auth/__tests__/*.integration.test.ts",
  "src/lib/provider/__tests__/*.integration.test.ts",
  "src/lib/booking/__tests__/*.integration.test.ts",
  "src/lib/db/__tests__/*.integration.test.ts",
];

const HARNESS_SUFFIXES = [".harness.ts", ".harness.tsx"];

const FORBIDDEN_CLI_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /supabase db query/i, label: "supabase db query" },
  { pattern: /--linked/, label: "--linked" },
  { pattern: /\bpsql\b/, label: "psql" },
  { pattern: /execSync\s*\(/, label: "execSync(" },
  { pattern: /spawnSync\s*\(/, label: "spawnSync(" },
  { pattern: /execFileSync\s*\(/, label: "execFileSync(" },
  { pattern: /from\s+["']node:child_process["']/, label: "node:child_process import" },
  { pattern: /from\s+["']child_process["']/, label: "child_process import" },
  { pattern: /pg_policies/, label: "pg_policies catalog probe" },
  { pattern: /information_schema\.table_privileges/, label: "information_schema privilege probe" },
];

function isHarnessFile(filePath: string) {
  return HARNESS_SUFFIXES.some((suffix) => filePath.endsWith(suffix));
}

function harnessCandidatesFor(integrationFile: string) {
  const dir = path.dirname(integrationFile);
  const base = path.basename(integrationFile).replace(/\.integration\.test\.(ts|tsx)$/, "");
  return [
    path.join(dir, `${base}.harness.ts`),
    path.join(dir, `${base}.harness.tsx`),
    path.join(dir, "booking.harness.ts"),
  ];
}

/** Discover integration + harness files scanned by the no-CLI guard. */
export function discoverIntegrationGuardTargets(rootDir = process.cwd()): string[] {
  const files = new Set<string>();
  for (const pattern of OTP_INTEGRATION_INCLUDE_GLOBS) {
    for (const match of globSync(pattern, { cwd: rootDir })) {
      const normalized = match.replace(/\\/g, "/");
      if (!fs.statSync(path.join(rootDir, normalized)).isFile()) continue;
      files.add(normalized);
      for (const harness of harnessCandidatesFor(normalized)) {
        const relHarness = path.relative(rootDir, harness).replace(/\\/g, "/");
        if (fs.existsSync(path.join(rootDir, relHarness)) && fs.statSync(path.join(rootDir, relHarness)).isFile()) {
          files.add(relHarness);
        }
      }
    }
  }
  // Explicit shared harness used by multiple suites
  const sharedHarness = "src/lib/booking/__tests__/booking.harness.ts";
  if (fs.existsSync(path.join(rootDir, sharedHarness))) {
    files.add(sharedHarness);
  }
  const providerHarness = "src/lib/provider/__tests__/providerOnboarding.harness.ts";
  if (fs.existsSync(path.join(rootDir, providerHarness))) {
    files.add(providerHarness);
  }
  return [...files].sort();
}

export function scanFileForForbiddenCliPatterns(source: string) {
  const hits: string[] = [];
  for (const { pattern, label } of FORBIDDEN_CLI_PATTERNS) {
    if (pattern.test(source)) hits.push(label);
  }
  return hits;
}

export function isIntegrationHarnessPath(filePath: string) {
  return filePath.includes("/__tests__/") && (
    filePath.endsWith(".integration.test.ts")
    || filePath.endsWith(".integration.test.tsx")
    || isHarnessFile(filePath)
  );
}
