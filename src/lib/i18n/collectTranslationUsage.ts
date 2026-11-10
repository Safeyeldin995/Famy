import fs from "node:fs";
import path from "node:path";

const PLURAL_SUFFIXES = ["_zero", "_one", "_two", "_few", "_many", "_other"] as const;

const TRANSLATION_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/;

export function flattenTranslationKeys(
  value: unknown,
  prefix = "",
): Map<string, string | number | boolean | null> {
  const out = new Map<string, string | number | boolean | null>();
  if (value === null || value === undefined) {
    if (prefix) out.set(prefix, value as null);
    return out;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    if (prefix) out.set(prefix, value as string | number | boolean);
    return out;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      for (const [k, v] of flattenTranslationKeys(child, next)) {
        out.set(k, v);
      }
    } else {
      out.set(next, child as string | number | boolean | null);
    }
  }
  return out;
}

export function baseKeyForPlural(key: string): string {
  for (const suffix of PLURAL_SUFFIXES) {
    if (key.endsWith(suffix)) return key.slice(0, -suffix.length);
  }
  return key;
}

export function hasLocaleKey(keys: Set<string>, logicalKey: string): boolean {
  if (keys.has(logicalKey)) return true;
  return PLURAL_SUFFIXES.some((suffix) => keys.has(`${logicalKey}${suffix}`));
}

const SOURCE_ROOTS = [
  path.join(process.cwd(), "src"),
  path.join(process.cwd(), "mobile", "src"),
];

function isTestOrFixture(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return (
    normalized.includes("/__tests__/") ||
    normalized.includes("/.test.") ||
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".test.tsx") ||
    normalized.includes("/qa/tests/")
  );
}

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walkSourceFiles(full, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name) && !isTestOrFixture(full)) {
      out.push(full);
    }
  }
  return out;
}

function isTranslationKey(candidate: string): boolean {
  return TRANSLATION_KEY_PATTERN.test(candidate);
}

function extractStringLiteralsFromCall(callBody: string): string[] {
  const found: string[] = [];
  for (const match of callBody.matchAll(/["']([a-zA-Z][\w.]*)["']/g)) {
    if (isTranslationKey(match[1])) found.push(match[1]);
  }
  return found;
}

/** Walk `t(...)` / `i18n.t(...)` call sites and pull every dotted translation key inside the argument list. */
function extractKeysFromTranslationCalls(source: string): string[] {
  const keys: string[] = [];
  const opener = /(?:^|[^\w$])(?:i18n\.)?t\s*\(/g;
  for (const match of source.matchAll(opener)) {
    const start = match.index! + match[0].length;
    let depth = 1;
    let i = start;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    if (depth !== 0) continue;
    const body = source.slice(start, i - 1);
    keys.push(...extractStringLiteralsFromCall(body));
  }
  return keys;
}

export type DynamicPrefix = { prefix: string; file: string };

const TEMPLATE_T_REGEX = /(?:^|[^\w$])(?:i18n\.)?t\s*\(\s*`([^`$]*)\$\{([^}]+)\}/gm;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function identifierFromExpression(expr: string): string {
  const trimmed = expr.trim();
  const last = trimmed.split(/[.?\s:]+/).pop() ?? trimmed;
  return last.replace(/[^a-zA-Z_$0-9]/g, "");
}

function stringLiteralsInArrayBody(body: string): string[] {
  return [...body.matchAll(/["']([a-zA-Z_][\w]*)["']/g)].map((m) => m[1]);
}

function suffixesFromMappedArray(chunk: string, varName: string): string[] {
  const literals = new Set<string>();
  const mapRe = new RegExp(
    String.raw`(?:\(|\[)([^\])]*?)\)\s*(?:as const\s*)?\.map\(\(\s*${escapeRegExp(varName)}\b`,
    "g",
  );
  for (const m of chunk.matchAll(mapRe)) {
    for (const lit of stringLiteralsInArrayBody(m[1])) literals.add(lit);
  }
  const namedMap = new RegExp(
    String.raw`\b(\w+)\.map\(\(\s*${escapeRegExp(varName)}\b`,
    "g",
  );
  for (const m of chunk.matchAll(namedMap)) {
    const arrName = m[1];
    const constArr = new RegExp(
      String.raw`const\s+${escapeRegExp(arrName)}\s*(?::[^=]+)?=\s*\[([\s\S]*?)\]`,
      "m",
    );
    const constHit = chunk.match(constArr);
    if (constHit) {
      for (const lit of stringLiteralsInArrayBody(constHit[1])) literals.add(lit);
    }
  }
  return [...literals];
}

function objectKeySuffixesFromMap(chunk: string, propName: string): string[] {
  if (propName !== "key" && propName !== "label") return [];
  const literals = new Set<string>();
  const objectMap = new RegExp(
    String.raw`\{[^}]*\b${escapeRegExp(propName)}\s*:\s*["']([a-zA-Z_][\w]*)["'][^}]*\}(?:\s*,\s*\{[^}]*\})*\s*\]\s*\.map\(\(\{[^}]*\b${escapeRegExp(propName)}\b`,
    "g",
  );
  for (const m of chunk.matchAll(objectMap)) {
    const block = m[0];
    for (const hit of block.matchAll(
      new RegExp(String.raw`\b${escapeRegExp(propName)}\s*:\s*["']([a-zA-Z_][\w]*)["']`, "g"),
    )) {
      literals.add(hit[1]);
    }
  }
  return [...literals];
}

function tupleLabelSuffixes(chunk: string, varName: string): string[] {
  if (varName !== "label") return [];
  const literals = new Set<string>();
  const nested = /\[\s*\[\s*["'][\w]+["']\s*,\s*["']([a-zA-Z_][\w]*)["']\s*\]/g;
  for (const m of chunk.matchAll(nested)) literals.add(m[1]);
  const withUnderscore = /\[\s*["'][^"']*_[^"']*["']\s*,\s*["']([a-zA-Z_][\w]*)["']\s*\]/g;
  for (const m of chunk.matchAll(withUnderscore)) literals.add(m[1]);
  return [...literals];
}

export function collectDynamicTemplateKeys(source: string): string[] {
  const keys = new Set<string>();
  for (const match of source.matchAll(TEMPLATE_T_REGEX)) {
    const head = match[1].replace(/\.$/, "");
    const varName = identifierFromExpression(match[2]);
    if (!head || !/^[a-zA-Z][\w.]*$/.test(head)) continue;

    const pos = match.index ?? 0;
    const chunk = source.slice(Math.max(0, pos - 1200), Math.min(source.length, pos + 400));

    const suffixes = [
      ...suffixesFromMappedArray(chunk, varName),
      ...objectKeySuffixesFromMap(chunk, varName),
      ...tupleLabelSuffixes(chunk, varName),
    ];
    for (const suffix of new Set(suffixes)) {
      keys.add(`${head}.${suffix}`);
    }
  }
  return [...keys];
}

export function collectStaticTranslationKeys(files: string[]): Set<string> {
  const keys = new Set<string>();
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const key of extractKeysFromTranslationCalls(text)) {
      keys.add(key);
    }
  }
  return keys;
}

export function collectDynamicPrefixes(files: string[]): DynamicPrefix[] {
  const prefixes: DynamicPrefix[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(TEMPLATE_T_REGEX)) {
      const raw = match[1].replace(/\.$/, "");
      if (!raw || !/^[a-zA-Z][\w.]*$/.test(raw)) continue;
      prefixes.push({ prefix: raw, file });
    }
  }
  return prefixes;
}

export function collectAllReferencedKeys(files: string[]): Set<string> {
  const keys = collectStaticTranslationKeys(files);
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const key of collectDynamicTemplateKeys(text)) {
      keys.add(key);
    }
  }
  return keys;
}

export function listTranslationSourceFiles(): string[] {
  return SOURCE_ROOTS.flatMap((root) => walkSourceFiles(root));
}

export function compareLocaleKeySets(enKeys: Set<string>, arKeys: Set<string>) {
  const onlyEn = [...enKeys].filter((k) => !arKeys.has(k)).sort();
  const onlyAr = [...arKeys].filter((k) => !enKeys.has(k)).sort();
  return { onlyEn, onlyAr };
}
