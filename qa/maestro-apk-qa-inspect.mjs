#!/usr/bin/env node
/**
 * Reads decompressed APK config/bundle text for Supabase project identity checks.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import {
  KNOWN_PRODUCTION_PROJECT_REF,
  KNOWN_QA_PROJECT_REF,
} from "./qa-identity.mjs";

/** Entries that carry Expo runtime Supabase configuration. */
export const APK_IDENTITY_ENTRY_PATTERNS = [
  /^assets\/index\.android\.bundle$/i,
  /^assets\/app\.config$/i,
  /^assets\/app\.config\.json$/i,
];

const UNZIP_BIN = "unzip";
const MAX_ENTRY_BYTES = 128 * 1024 * 1024;

/**
 * @param {string} apkPath
 * @returns {string[]}
 */
export function listApkEntries(apkPath) {
  const out = execFileSync(UNZIP_BIN, ["-Z1", apkPath], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * @param {string} apkPath
 * @param {string} entryName
 * @returns {Buffer}
 */
export function readApkEntryBuffer(apkPath, entryName) {
  return execFileSync(UNZIP_BIN, ["-p", apkPath, entryName], {
    encoding: "buffer",
    maxBuffer: MAX_ENTRY_BYTES,
  });
}

/**
 * @param {string} apkPath
 * @returns {string}
 */
export function inspectApkDecompressedText(apkPath) {
  if (!fs.existsSync(apkPath)) {
    throw new Error(`[maestro] APK not found: ${apkPath}`);
  }

  const entries = listApkEntries(apkPath);
  const targets = entries.filter((name) =>
    APK_IDENTITY_ENTRY_PATTERNS.some((pattern) => pattern.test(name)),
  );

  if (!targets.length) {
    throw new Error(
      "[maestro] APK has no inspectable Expo assets (expected assets/index.android.bundle and/or app.config).",
    );
  }

  const chunks = [];
  for (const name of targets) {
    const buf = readApkEntryBuffer(apkPath, name);
    chunks.push(buf.toString("utf8"));
  }
  return chunks.join("\n");
}

/**
 * @param {string} text Decompressed bundle/config text.
 * @returns {{ ok: boolean, hasQa: boolean, hasProd: boolean, message?: string }}
 */
export function verifyApkQaIdentityFromText(text) {
  const hasQa = text.includes(KNOWN_QA_PROJECT_REF);
  const hasProd = text.includes(KNOWN_PRODUCTION_PROJECT_REF);

  if (hasProd) {
    return {
      ok: false,
      hasQa,
      hasProd,
      message:
        `[maestro] APK embeds Production Supabase ref ${KNOWN_PRODUCTION_PROJECT_REF}. ` +
        "Build the APK with QA Supabase URL (EAS env EXPO_PUBLIC_SUPABASE_URL / extra.supabaseUrl).",
    };
  }

  if (!hasQa) {
    return {
      ok: false,
      hasQa,
      hasProd,
      message:
        `[maestro] APK does not embed QA Supabase ref ${KNOWN_QA_PROJECT_REF} in decompressed bundle/config. ` +
        "Refusing to run flows against an unknown backend.",
    };
  }

  return { ok: true, hasQa, hasProd };
}

/**
 * @param {string} apkPath
 * @returns {{ ok: boolean, hasQa: boolean, hasProd: boolean, message?: string }}
 */
export function verifyApkQaIdentity(apkPath) {
  const text = inspectApkDecompressedText(apkPath);
  return verifyApkQaIdentityFromText(text);
}