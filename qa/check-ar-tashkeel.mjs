/**
 * Fails when TypeScript source contains Arabic diacritics, including shadda.
 * Tatweel (U+0640) is deliberately excluded: it is a joining character,
 * not a diacritic, and preserves single-letter prefixes such as كـ and بـ.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export const TASHKEEL_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08FF]/g;

const DEFAULT_SOURCE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

export function countTashkeel(text) {
  return text.match(TASHKEEL_RE)?.length ?? 0;
}

// Keep the existing file-check API for callers; a directory scans all .ts/.tsx files.
export function checkArLocaleTashkeel(sourcePath = DEFAULT_SOURCE_PATH) {
  const files = statSync(sourcePath).isDirectory() ? sourceFiles(sourcePath) : [sourcePath];
  const findings = files.map(path => ({ path, count: countTashkeel(readFileSync(path, "utf8")) })).filter(item => item.count > 0);
  const count = findings.reduce((total, item) => total + item.count, 0);
  return {
    ok: count === 0,
    count,
    message: count > 0
      ? `Source contains ${count} tashkeel character(s): ${findings.map(item => `${item.path} (${item.count})`).join(", ")}. Remove Arabic diacritics.`
      : `${files.length} source file(s): no tashkeel characters found`,
  };
}

const invokedDirectly =
  !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const cliPath = process.argv[2] ?? process.env.AR_LOCALE_PATH ?? DEFAULT_SOURCE_PATH;
  const result = checkArLocaleTashkeel(cliPath);

  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }

  console.log(result.message);
}
