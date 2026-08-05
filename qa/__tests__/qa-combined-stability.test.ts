import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";

const QA_TEST_GLOB = [
  "qa/__tests__/cli-entrypoint.test.ts",
  "qa/__tests__/cli-lifecycle.test.ts",
  "qa/__tests__/teardown-coowned.test.ts",
  "qa/__tests__/containment-booking-caller.test.ts",
  "qa/__tests__/containment.test.ts",
  "qa/__tests__/teardown-retained-provider.test.ts",
  "qa/__tests__/teardown-immutable-history.test.ts",
  "qa/__tests__/teardown-row-locators.test.ts",
  "qa/__tests__/teardown-terminal-disable.test.ts",
  "qa/__tests__/teardown-execution-isolation.test.ts",
  "qa/__tests__/teardown-planner.test.ts",
  "qa/__tests__/teardown-fk.test.ts",
  "qa/__tests__/registry-integration-mode.test.ts",
  "qa/__tests__/registry-concurrency.test.ts",
  "qa/__tests__/orphan-recovery.test.ts",
  "qa/__tests__/env-guard.test.ts",
  "qa/__tests__/qa-classification-parity.test.ts",
].join(" ");

describe("QA combined suite stability", () => {
  it("passes five consecutive combined QA unit runs", () => {
    for (let run = 1; run <= 5; run++) {
      execSync(`npx vitest run ${QA_TEST_GLOB}`, {
        cwd: process.cwd(),
        stdio: "pipe",
        env: process.env,
      });
    }
    expect(true).toBe(true);
  }, 120_000);
});
