import { describe, expect, it, beforeAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  KNOWN_PRODUCTION_PROJECT_REF,
  KNOWN_QA_PROJECT_REF,
} from "../qa-identity.mjs";
import {
  inspectApkDecompressedText,
  verifyApkQaIdentity,
  verifyApkQaIdentityFromText,
} from "../maestro-apk-qa-inspect.mjs";

const REPO_ROOT = process.cwd();

function assertZipAvailable() {
  const probe = spawnSync("zip", ["-h"], { encoding: "utf8" });
  expect(probe.status).toBe(0);
  const unzip = spawnSync("unzip", ["-h"], { encoding: "utf8" });
  expect(unzip.status).toBe(0);
}

function writeTree(root: string, relPath: string, content: string) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function buildApkFixture(
  workDir: string,
  apkName: string,
  files: Array<{ path: string; content: string; compression?: "store" | "deflate" }>,
) {
  for (const file of files) {
    writeTree(workDir, file.path, file.content);
    const entryPath = path.join(workDir, file.path);
    const method = file.compression === "store" ? ["-0"] : ["-9"];
    execFileSync("zip", [...method, apkName, file.path], { cwd: workDir, stdio: "pipe" });
  }
  return path.join(workDir, apkName);
}

describe("verify-maestro-apk-qa", () => {
  beforeAll(() => {
    assertZipAvailable();
  });

  it("accepts a compressed QA-only android bundle", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "famy-apk-qa-"));
    const apk = buildApkFixture(dir, "qa-only.apk", [
      {
        path: "assets/index.android.bundle",
        content: `export const url = "https://${KNOWN_QA_PROJECT_REF}.supabase.co";`,
        compression: "deflate",
      },
      {
        path: "assets/app.config",
        content: JSON.stringify({ extra: { supabaseUrl: `https://${KNOWN_QA_PROJECT_REF}.supabase.co` } }),
        compression: "deflate",
      },
    ]);

    const text = inspectApkDecompressedText(apk);
    expect(text).toContain(KNOWN_QA_PROJECT_REF);
    expect(verifyApkQaIdentity(apk).ok).toBe(true);
  });

  it("rejects a compressed Production bundle even when stored zip bytes show QA", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "famy-apk-prod-"));
    const apk = buildApkFixture(dir, "prod-trap.apk", [
      {
        path: "assets/app.config",
        content: `https://${KNOWN_QA_PROJECT_REF}.supabase.co`,
        compression: "store",
      },
      {
        path: "assets/index.android.bundle",
        content: `const x = "https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co";`,
        compression: "deflate",
      },
    ]);

    const fromText = verifyApkQaIdentityFromText(inspectApkDecompressedText(apk));
    expect(fromText.ok).toBe(false);
    expect(fromText.hasProd).toBe(true);
    expect(verifyApkQaIdentity(apk).ok).toBe(false);
  });

  it("rejects when decompressed assets lack the QA ref", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "famy-apk-missing-qa-"));
    const apk = buildApkFixture(dir, "missing-qa.apk", [
      {
        path: "assets/index.android.bundle",
        content: "console.log('no supabase here');",
        compression: "deflate",
      },
    ]);
    expect(verifyApkQaIdentity(apk).ok).toBe(false);
  });

  it("verify-maestro-apk-qa CLI exits 0 on QA fixture", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "famy-apk-cli-"));
    const apk = buildApkFixture(dir, "cli-qa.apk", [
      {
        path: "assets/index.android.bundle",
        content: KNOWN_QA_PROJECT_REF,
        compression: "deflate",
      },
    ]);
    const script = path.join(REPO_ROOT, "qa/verify-maestro-apk-qa.mjs");
    const run = spawnSync(process.execPath, [script, apk], { encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("APK QA identity OK");
  });
});