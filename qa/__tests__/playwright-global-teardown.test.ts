import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  configureRegistryRootForTests,
  resetRegistryRootForTests,
  writeRegistry,
} from "../registry.mjs";
import { assertExecutePlanApproved } from "../teardown-planner.mjs";
import {
  buildPlaywrightWebServerEnv,
  getEffectiveNormalizedChildEnv,
} from "../playwright-webserver-env.mjs";
import { useIsolatedQaEnv } from "./qa-env-test-harness.ts";
import { runPlaywrightGlobalTeardown } from "../teardown-core.mjs";

describe("playwright global teardown lifecycle", () => {
  useIsolatedQaEnv();

  /** @type {string} */
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-e2e-teardown-"));
    configureRegistryRootForTests(tmpDir);
  });

  afterEach(() => {
    resetRegistryRootForTests();
  });

  it("requires reviewed fingerprint for authoritative cleanup execute", () => {
    expect(() => assertExecutePlanApproved({ fingerprint: "abc" }, undefined)).toThrow(
      /requires --plan-fingerprint/,
    );
  });

  it("skips destructive cleanup when global setup never registered users", async () => {
    writeRegistry({ users: [], qaPassword: "test-password" });
    const result = await runPlaywrightGlobalTeardown();
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("no_registry_users");
  });
});

describe("playwright webServer OTP env requirement", () => {
  it("reproduces missing service role as server bootstrap failure without live network", async () => {
    const previousUrl = process.env.SUPABASE_URL;
    const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_URL = "https://bfwveoqbyqlhixjvdzha.supabase.co";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.resetModules();
    try {
      const { supabaseAdmin } = await import("../../src/integrations/supabase/client.server.ts");
      expect(() => supabaseAdmin.from("otp_verifications")).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    } finally {
      if (previousUrl !== undefined) process.env.SUPABASE_URL = previousUrl;
      else delete process.env.SUPABASE_URL;
      if (previousKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
      else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      vi.resetModules();
    }
  });

  it("maps QA secret into approved webServer child env for server-side OTP RPCs", () => {
    const normalized = getEffectiveNormalizedChildEnv({
      QA_SUPABASE_URL: "https://bfwveoqbyqlhixjvdzha.supabase.co",
      QA_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fake",
      QA_SUPABASE_SECRET_KEY: "sb_secret_fake",
      PATH: process.env.PATH ?? "",
      PATHEXT: process.env.PATHEXT,
      SystemRoot: process.env.SystemRoot,
      COMSPEC: process.env.COMSPEC,
      WINDIR: process.env.WINDIR,
      USERPROFILE: process.env.USERPROFILE,
      HOME: process.env.HOME,
      APPDATA: process.env.APPDATA,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      HOMEDRIVE: process.env.HOMEDRIVE,
      HOMEPATH: process.env.HOMEPATH,
      PROGRAMFILES: process.env.ProgramFiles,
      "ProgramFiles(x86)": process.env["ProgramFiles(x86)"],
      CommonProgramFiles: process.env.CommonProgramFiles,
    });
    expect(normalized.SUPABASE_SERVICE_ROLE_KEY).toBe("sb_secret_fake");
    expect(normalized.QA_SUPABASE_SECRET_KEY).toBeUndefined();
    expect(buildPlaywrightWebServerEnv({
      QA_SUPABASE_URL: "https://bfwveoqbyqlhixjvdzha.supabase.co",
      QA_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fake",
      QA_SUPABASE_SECRET_KEY: "sb_secret_fake",
    }).SUPABASE_SERVICE_ROLE_KEY).toBe("sb_secret_fake");
  });
});
