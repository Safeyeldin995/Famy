#!/usr/bin/env node
/**
 * Fails when Arabic locale values contain tashkeel (diacritics).
 * Character set matches the product requirement in docs/tashkeel-sweep order.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TASHKEEL_RE = /[\u0640\u064B-\u0652\u0670\u06D6-\u06ED]/g;

const DEFAULT_AR_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/lib/i18n/locales/ar.ts",
);

export function countTashkeel(text) {
  return text.match(TASHKEEL_RE)?.length ?? 0;
}

export function checkArLocaleTashkeel(arPath = DEFAULT_AR_PATH) {
  const text = readFileSync(arPath, "utf8");
  const count = countTashkeel(text);
  if (count > 0) {
    return {
      ok: false,
      count,
      message: `Arabic locale contains ${count} tashkeel character(s) in ${arPath}. Remove diacritics from user-facing Arabic strings.`,
    };
  }
  return { ok: true, count: 0, message: "ar.ts: no tashkeel characters found" };
}

const invokedDirectly =
  !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const cliPath = process.argv[2] ?? process.env.AR_LOCALE_PATH ?? DEFAULT_AR_PATH;
  const result = checkArLocaleTashkeel(cliPath);

  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }

  console.log(result.message);
}
