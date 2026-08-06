import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import {
  configureRegistryRootForTests,
  resetIntegrationRegistryModeForTests,
  resetRegistryRootForTests,
} from "../registry.mjs";

/**
 * Isolated registry directory per test — never touches qa/.auth.
 */
export function useIsolatedRegistry() {
  /** @type {string} */
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-registry-test-"));
    configureRegistryRootForTests(tmpDir);
  });

  afterEach(() => {
    resetRegistryRootForTests();
    resetIntegrationRegistryModeForTests();
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors in tests
      }
    }
  });

  return {
    getDir: () => tmpDir,
  };
}
