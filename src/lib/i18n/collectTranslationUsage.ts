import fs from "node:fs";
import path from "node:path";

const PLURAL_SUFFIXES = ["_zero", "_one", "_two", "_few", "_many", "_other"] as const;

const TRANSLATION_KEY_PATTERN = /^[a-z][\w]*(?:\.[a-zA-Z][\w]*)+$/;

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

export function pluralSuffixesPresent(keys: Set<string>, base: string): string[] {
  return PLURAL_SUFFIXES.filter((suffix) => keys.has(`${base}${suffix}`));
}

/** True when the logical key or a complete enough plural set exists (requires `_other` when split plurals exist). */
export function hasLocaleKey(keys: Set<string>, logicalKey: string): boolean {
  if (keys.has(logicalKey)) return true;
  const pluralHits = pluralSuffixesPresent(keys, logicalKey);
  if (pluralHits.length === 0) return false;
  return keys.has(`${logicalKey}_other`);
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

export type UnresolvedDynamicTemplate = {
  prefix: string;
  varName: string;
  file: string;
};

const TEMPLATE_T_REGEX =
  /(?:^|[^\w$])(?:i18n\.)?t\s*\(\s*`([^`]*?)\$\{([^}]+)\}([^`]*)`/gm;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function identifierFromExpression(expr: string): string {
  const trimmed = expr.trim();
  const last = trimmed.split(/[.?\s:]+/).pop() ?? trimmed;
  return last.replace(/[^a-zA-Z_$0-9]/g, "");
}

function isRuntimeTemplateExpression(expr: string): boolean {
  const trimmed = expr.trim();
  return trimmed.includes(".") || trimmed.includes("?") || trimmed.includes("[");
}

function stringLiteralsInArrayBody(body: string): string[] {
  return [...body.matchAll(/["']([a-zA-Z_][\w]*)["']/g)].map((m) => m[1]);
}

function resolveModuleSpecifier(importerFile: string, specifier: string): string | null {
  const root = process.cwd();
  const inMobile = importerFile.replace(/\\/g, "/").includes("/mobile/src/");
  const tryPaths: string[] = [];
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    tryPaths.push(
      inMobile ? path.join(root, "mobile/src", rel) : path.join(root, "src", rel),
    );
  } else if (specifier.startsWith("@shared/")) {
    tryPaths.push(path.join(root, "src/lib", specifier.slice(8)));
  } else if (specifier.startsWith(".")) {
    tryPaths.push(path.resolve(path.dirname(importerFile), specifier));
  } else {
    return null;
  }
  for (const base of tryPaths) {
    for (const ext of [".ts", ".tsx", ""]) {
      const candidate = base.endsWith(ext) ? base : `${base}${ext}`;
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function readNamedArrayExport(modulePath: string, exportName: string): string[] {
  if (!fs.existsSync(modulePath)) return [];
  const text = fs.readFileSync(modulePath, "utf8");
  const constArr = new RegExp(
    String.raw`export\s+const\s+${escapeRegExp(exportName)}\s*(?::[^=]+)?=\s*\[([\s\S]*?)\]\s*(?:as\s+const)?`,
    "m",
  );
  const hit = text.match(constArr);
  if (!hit) return [];
  return stringLiteralsInArrayBody(hit[1]);
}

function importedArrayLiterals(source: string, importerFile: string, exportName: string): string[] {
  const importRe = new RegExp(
    String.raw`import\s+\{[^}]*\b${escapeRegExp(exportName)}\b[^}]*\}\s+from\s+["']([^"']+)["']`,
    "m",
  );
  const hit = source.match(importRe);
  if (!hit) return [];
  const modulePath = resolveModuleSpecifier(importerFile, hit[1]);
  if (!modulePath) return [];
  return readNamedArrayExport(modulePath, exportName);
}

function namedConstArrayLiterals(source: string, arrName: string): string[] {
  const constArr = new RegExp(
    String.raw`const\s+${escapeRegExp(arrName)}\s*(?::[^=]+)?=\s*\[([\s\S]*?)\]\s*(?:as\s+const)?`,
    "m",
  );
  const hit = source.match(constArr);
  if (!hit) return [];
  return stringLiteralsInArrayBody(hit[1]);
}

function namedConstObjectKeys(source: string, arrName: string, prop = "key"): string[] {
  const blockRe = new RegExp(
    String.raw`const\s+${escapeRegExp(arrName)}\s*(?::[^=]+)?=\s*\[([\s\S]*?)\]\s*;`,
    "m",
  );
  const hit = source.match(blockRe);
  if (!hit) return [];
  const propRe = new RegExp(String.raw`\b${escapeRegExp(prop)}\s*:\s*["']([a-zA-Z_][\w]*)["']`, "g");
  return [...hit[1].matchAll(propRe)].map((m) => m[1]);
}

function lastMatchAll(text: string, re: RegExp): RegExpMatchArray[] {
  return [...text.matchAll(re)];
}

function suffixesFromNearestMap(
  source: string,
  filePath: string,
  templateIndex: number,
  varName: string,
): string[] {
  const before = source.slice(0, templateIndex);
  const mapCall = new RegExp(String.raw`\.map\(\s*\(\s*${escapeRegExp(varName)}\b`, "g");
  let mapAt = -1;
  for (const m of before.matchAll(mapCall)) mapAt = m.index ?? -1;
  if (mapAt < 0) {
    const destructCall = new RegExp(
      String.raw`\.map\(\s*\(\{[^}]*\b${escapeRegExp(varName)}\b`,
      "g",
    );
    for (const m of before.matchAll(destructCall)) mapAt = m.index ?? -1;
  }
  if (mapAt < 0) return [];

  const window = before.slice(Math.max(0, mapAt - 200), mapAt + 40);
  const directArrayMap = new RegExp(
    String.raw`\[\s*([^\]]+)\]\s*\.map\(\s*\(\s*${escapeRegExp(varName)}\b`,
    "g",
  );
  const directHits = lastMatchAll(window, directArrayMap);
  if (directHits.length) {
    return stringLiteralsInArrayBody(directHits.at(-1)![1]);
  }
  const spreadMap = new RegExp(
    String.raw`\.\.\.\s*\[([^\]]+)\]\s*\.map\(\s*\(\s*${escapeRegExp(varName)}\b`,
    "g",
  );
  const spreadHits = lastMatchAll(window, spreadMap);
  if (spreadHits.length) {
    return stringLiteralsInArrayBody(spreadHits.at(-1)![1]);
  }
  const destructMap = new RegExp(
    String.raw`\b(\w+)\.map\(\s*\(\{[^}]*\b${escapeRegExp(varName)}\b`,
    "g",
  );
  const destructHits = lastMatchAll(window, destructMap);
  if (destructHits.length) {
    return namedConstObjectKeys(source, destructHits.at(-1)![1], "key");
  }
  const namedMap = new RegExp(
    String.raw`\b(\w+)\.map\(\s*\(\s*${escapeRegExp(varName)}\b`,
    "g",
  );
  const namedHits = lastMatchAll(window, namedMap);
  if (namedHits.length) {
    const arrName = namedHits.at(-1)![1];
    const literals = [
      ...namedConstArrayLiterals(source, arrName),
      ...importedArrayLiterals(source, filePath, arrName),
    ];
    if (literals.length) return literals;
  }
  return [];
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

function joinTemplateKey(head: string, suffix: string, trail: string): string {
  const base = head.endsWith(".") ? `${head}${suffix}` : head ? `${head}.${suffix}` : suffix;
  const tail = trail.replace(/^\./, "");
  if (!tail) return base;
  return `${base}.${tail}`;
}

function resolveSuffixesForTemplate(
  source: string,
  filePath: string,
  chunk: string,
  templateIndex: number,
  head: string,
  varName: string,
  expr: string,
  trail: string,
): { keys: string[]; unresolved: boolean } {
  if (isRuntimeTemplateExpression(expr)) {
    return { keys: [], unresolved: false };
  }

  const normalizedHead = head.replace(/\.$/, "");

  if (varName === "v" && normalizedHead === "familyMembers.genders") {
    const keys = ["male", "female"].map((s) => joinTemplateKey(normalizedHead, s, trail));
    return { keys, unresolved: false };
  }
  if (
    (varName === "chip" || varName === "g") &&
    normalizedHead === "pro.onboardingWizard.ageGroupChips"
  ) {
    const keys = ["infants", "toddlers", "kids", "teens"].map((s) =>
      joinTemplateKey(normalizedHead, s, trail),
    );
    return { keys, unresolved: false };
  }
  const suffixes = new Set([
    ...suffixesFromNearestMap(source, filePath, templateIndex, varName),
    ...tupleLabelSuffixes(chunk, varName),
  ]);

  if (varName === "key" && normalizedHead === "addresses.label") {
    for (const lit of namedConstObjectKeys(source, "LABELS", "key")) suffixes.add(lit);
  }
  if (varName === "r" && normalizedHead === "familyMembers.relationships") {
    for (const lit of namedConstArrayLiterals(source, "RELATIONSHIPS")) suffixes.add(lit);
  }
  if (varName === "v" && normalizedHead === "familyMembers.relationships") {
    for (const lit of importedArrayLiterals(source, filePath, "relationships")) suffixes.add(lit);
  }
  if (varName === "mode" && normalizedHead === "bookFlow.supervision") {
    literalsImport(source, filePath, "SUPERVISION_MODES", suffixes);
  }

  const keys = [...suffixes].map((suffix) => joinTemplateKey(normalizedHead, suffix, trail));
  return { keys, unresolved: keys.length === 0 };
}

function literalsImport(
  source: string,
  filePath: string,
  exportName: string,
  into: Set<string>,
): void {
  for (const lit of namedConstArrayLiterals(source, exportName)) into.add(lit);
  for (const lit of importedArrayLiterals(source, filePath, exportName)) into.add(lit);
}

export function collectDynamicTemplateKeys(
  source: string,
  filePath = "",
): { keys: string[]; unresolved: UnresolvedDynamicTemplate[] } {
  const keys: string[] = [];
  const unresolved: UnresolvedDynamicTemplate[] = [];
  for (const match of source.matchAll(TEMPLATE_T_REGEX)) {
    const head = match[1];
    const expr = match[2];
    const trail = match[3] ?? "";
    if (trail.includes("${")) continue;
    const varName = identifierFromExpression(expr);
    const headCheck = head.replace(/\.$/, "");
    if (!headCheck || !/^[a-zA-Z][\w.]*\.?$/.test(head)) continue;

    const pos = match.index ?? 0;
    const chunk = source.slice(Math.max(0, pos - 1200), Math.min(source.length, pos + 400));

    const resolved = resolveSuffixesForTemplate(
      source,
      filePath,
      chunk,
      pos,
      head,
      varName,
      expr,
      trail,
    );
    keys.push(...resolved.keys);
    if (resolved.unresolved) {
      unresolved.push({ prefix: headCheck, varName, file: filePath });
    }
  }
  return { keys, unresolved };
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
    const dynamic = collectDynamicTemplateKeys(text, file);
    for (const key of dynamic.keys) {
      keys.add(key);
    }
  }
  return keys;
}

export function collectUnresolvedDynamicTemplates(files: string[]): UnresolvedDynamicTemplate[] {
  const out: UnresolvedDynamicTemplate[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    out.push(...collectDynamicTemplateKeys(text, file).unresolved);
  }
  return out;
}

export function listTranslationSourceFiles(): string[] {
  return SOURCE_ROOTS.flatMap((root) => walkSourceFiles(root));
}

export function compareLocaleKeySets(enKeys: Set<string>, arKeys: Set<string>) {
  const onlyEn = [...enKeys].filter((k) => !arKeys.has(k)).sort();
  const onlyAr = [...arKeys].filter((k) => !enKeys.has(k)).sort();
  return { onlyEn, onlyAr };
}
