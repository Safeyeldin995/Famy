/**
 * Arabic UI copy must not use Latin full stops except in allowed technical tokens.
 */
import { readFileSync } from "node:fs";

const ARABIC_RE = /[\u0600-\u06FF]/;

const PROTECTED_PATTERNS = [
  /\{\{[^}]+\}\}/g,
  /\.{3,}/g,
  /https?:\/\/[^\s\]'")<>]+/gi,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  /(?:\d|[\u0660-\u0669])+(?:\.(?:\d|[\u0660-\u0669])+)+/g,
  /ج\.م/g,
];

function protect(text) {
  const tokens = [];
  let out = text;
  for (const pattern of PROTECTED_PATTERNS) {
    out = out.replace(pattern, (match) => {
      const id = tokens.push(match) - 1;
      return `\uE000${id}\uE001`;
    });
  }
  return { out, tokens };
}

function unprotect(out, tokens) {
  return out.replace(/\uE000(\d+)\uE001/g, (_, index) => tokens[Number(index)] ?? "");
}

/** Strip sentence periods from Arabic UI strings; join clauses with the Arabic comma. */
export function stripArabicUiPeriods(text) {
  const { out: protectedText, tokens } = protect(text);
  let out = protectedText;

  out = out.replace(/\.\s+(?=[\u0600-\u06FF])/g, "، ");
  out = out.replace(/\.(?=[\u0600-\u06FF])/g, "، ");
  out = out.replace(/\.+$/g, "");
  out = out.replace(/\./g, "");

  return unprotect(out, tokens);
}

export function findDisallowedDots(text) {
  const { out: protectedText, tokens } = protect(text);
  const masked = protectedText.replace(/\uE000\d+\uE001/g, "");
  const findings = [];
  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] === ".") {
      const start = Math.max(0, index - 12);
      const end = Math.min(masked.length, index + 13);
      findings.push({ index, context: masked.slice(start, end) });
    }
  }
  void tokens;
  return findings;
}

const STRING_LITERAL_RE = /(["'])((?:\\.|(?!\1).)*)\1/g;

export function transformQuotedStringsInSource(source) {
  return source.replace(STRING_LITERAL_RE, (full, quote, body) => {
    if (!ARABIC_RE.test(body)) {
      return full;
    }
    const next = stripArabicUiPeriods(body);
    return next === body ? full : `${quote}${next}${quote}`;
  });
}

function walkJsonStrings(value) {
  if (typeof value === "string") {
    return ARABIC_RE.test(value) ? stripArabicUiPeriods(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map(walkJsonStrings);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, walkJsonStrings(child)]),
    );
  }
  return value;
}

export function transformArJson(source) {
  const parsed = JSON.parse(source);
  return `${JSON.stringify(walkJsonStrings(parsed), null, 2)}\n`;
}

export function transformArMarkdown(source) {
  return source
    .split("\n")
    .map((line) => (ARABIC_RE.test(line) ? stripArabicUiPeriods(line) : line))
    .join("\n");
}

export function extractArabicStringLiteralsFromTs(source) {
  const values = [];
  for (const match of source.matchAll(STRING_LITERAL_RE)) {
    const body = match[2];
    if (ARABIC_RE.test(body)) {
      values.push(body);
    }
  }
  return values;
}

export function checkArabicLocalePeriods({
  arTsPath,
  arJsonPath,
  listingMdPath,
}) {
  const findings = [];

  const arTs = readFileSync(arTsPath, "utf8");
  for (const value of extractArabicStringLiteralsFromTs(arTs)) {
    for (const item of findDisallowedDots(value)) {
      findings.push({ file: arTsPath, value, ...item });
    }
  }

  const arJson = JSON.parse(readFileSync(arJsonPath, "utf8"));
  const collectJson = (node, pathPrefix = "") => {
    if (typeof node === "string" && ARABIC_RE.test(node)) {
      for (const item of findDisallowedDots(node)) {
        findings.push({ file: arJsonPath, path: pathPrefix, value: node, ...item });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => collectJson(child, `${pathPrefix}[${index}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        collectJson(child, pathPrefix ? `${pathPrefix}.${key}` : key);
      }
    }
  };
  collectJson(arJson);

  const listing = readFileSync(listingMdPath, "utf8");
  for (const line of listing.split("\n")) {
    if (!ARABIC_RE.test(line)) continue;
    for (const item of findDisallowedDots(line)) {
      findings.push({ file: listingMdPath, value: line, ...item });
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    message:
      findings.length === 0
        ? "Arabic locale files: no disallowed UI periods"
        : `Arabic locale files contain ${findings.length} disallowed period(s)`,
  };
}
