/**
 * Static regression guard for integration registry exemptions.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SETUP_MODULE = "vitest-integration-registry-setup.mjs";

/**
 * Fail closed if integration registry guardrails are weakened.
 */
export function assertRegistryIntegrationGuardIntegrity() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const unitConfig = fs.readFileSync(path.join(root, "vitest.config.ts"), "utf8");
  const integrationConfig = fs.readFileSync(path.join(root, "vitest.otp-integration.config.ts"), "utf8");
  const registrySource = fs.readFileSync(path.join(root, "qa/registry.mjs"), "utf8");

  if (unitConfig.includes(SETUP_MODULE)) {
    throw new Error("[qa-registry-audit] vitest.config.ts must not load integration registry setup");
  }

  if (!integrationConfig.includes(SETUP_MODULE)) {
    throw new Error("[qa-registry-audit] vitest.otp-integration.config.ts must load integration registry setup");
  }

  if (!integrationConfig.includes("setupFiles")) {
    throw new Error("[qa-registry-audit] integration config must wire setupFiles for worker-local enablement");
  }

  if (/function assertRegistryWriteAllowed\(\)[\s\S]*?if\s*\(\s*isTestRuntime\(\)\s*\)\s*\{\s*return;\s*\}/.test(registrySource)) {
    throw new Error("[qa-registry-audit] unconditional Vitest registry write exemption detected");
  }

  if (/if\s*\(\s*process\.env\.VITEST\s*\)\s*return/.test(registrySource)) {
    throw new Error("[qa-registry-audit] broad process.env.VITEST allow pattern is forbidden");
  }

  if (!registrySource.includes("integrationRegistryModeEnabled")) {
    throw new Error("[qa-registry-audit] integration registry mode flag is required");
  }

  if (!registrySource.includes("enableGuardedIntegrationRegistryMode")) {
    throw new Error("[qa-registry-audit] explicit integration enablement helper is required");
  }
}

assertRegistryIntegrationGuardIntegrity();
