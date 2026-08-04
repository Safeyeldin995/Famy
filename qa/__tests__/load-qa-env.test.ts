import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureQaEnvFilePathForTests,
  loadQaEnv,
  qaEnvFilePath,
  resetQaEnvFilePathForTests,
} from "../load-qa-env.mjs";
import { assertQaWriteGuard } from "../env-guard.mjs";
import {
  buildFakeQaEnvFileContent,
  useIsolatedQaEnv,
} from "./qa-env-test-harness.ts";

afterEach(() => {
  try {
    resetQaEnvFilePathForTests();
  } catch {
    // ignore when Vitest flag is temporarily cleared
  }
});

describe("loadQaEnv runtime safety", () => {
  it("refuses normal execution without .env.qa.local", () => {
    resetQaEnvFilePathForTests();
    const repoEnv = path.resolve(process.cwd(), ".env.qa.local");
    const existsSpy = vi.spyOn(fs, "existsSync").mockImplementation((target) => {
      if (path.resolve(String(target)) === repoEnv) return false;
      return fs.existsSync(target);
    });

    expect(() => loadQaEnv({ required: true })).toThrow(/Missing .env.qa.local/);
    existsSpy.mockRestore();
  });

  it("refuses test override outside Vitest", () => {
    const priorVitest = process.env.VITEST;
    delete process.env.VITEST;
    expect(() => configureQaEnvFilePathForTests("/tmp/fake.env.qa.local")).toThrow(/Vitest/);
    process.env.VITEST = priorVitest;
  });
});

describe("loadQaEnv isolated test harness", () => {
  useIsolatedQaEnv();

  it("loads only the isolated fake test environment", () => {
    const repoEnv = path.resolve(process.cwd(), ".env.qa.local");
    const activePath = qaEnvFilePath();
    expect(activePath).not.toBe(repoEnv);
    expect(activePath.includes("qa-env-test-")).toBe(true);
    expect(fs.existsSync(activePath)).toBe(true);
    expect(() => assertQaWriteGuard(process.env)).not.toThrow();
  });

  it("never reads the repository .env.qa.local", () => {
    const repoEnv = path.resolve(process.cwd(), ".env.qa.local");
    const readSpy = vi.spyOn(fs, "readFileSync");
    loadQaEnv({ required: true });
    const readPaths = readSpy.mock.calls.map(([target]) => path.resolve(String(target)));
    expect(readPaths).not.toContain(repoEnv);
    readSpy.mockRestore();
  });
});

describe("loadQaEnv inject path", () => {
  it("accepts inject without reading any env file", () => {
    resetQaEnvFilePathForTests();
    const repoEnv = path.resolve(process.cwd(), ".env.qa.local");
    const readSpy = vi.spyOn(fs, "readFileSync");
    const existsSpy = vi.spyOn(fs, "existsSync").mockImplementation((target) => {
      if (path.resolve(String(target)) === repoEnv) return false;
      return fs.existsSync(target);
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-env-inject-"));
    const envFile = path.join(tmpDir, ".env.qa.local");
    fs.writeFileSync(envFile, buildFakeQaEnvFileContent(), "utf8");
    configureQaEnvFilePathForTests(envFile);

    const parsed = Object.fromEntries(
      buildFakeQaEnvFileContent()
        .split("\n")
        .map((line) => line.split("=", 2))
        .map(([key, value]) => [key, value ?? ""]),
    );

    loadQaEnv({ required: true, inject: parsed });
    expect(readSpy).not.toHaveBeenCalled();
    expect(() => assertQaWriteGuard(process.env)).not.toThrow();

    readSpy.mockRestore();
    existsSpy.mockRestore();
    resetQaEnvFilePathForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
