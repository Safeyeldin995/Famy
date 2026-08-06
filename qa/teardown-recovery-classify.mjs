import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string | null | undefined} id
 * @returns {"uuid" | "synthetic" | "empty"}
 */
export function classifyRecoveryEntryId(id) {
  if (!id || typeof id !== "string") return "empty";
  return UUID_RE.test(id) ? "uuid" : "synthetic";
}

/**
 * @param {string} recoveryPath
 */
export function readRecoveryLinesFromPath(recoveryPath) {
  if (!fs.existsSync(recoveryPath)) return [];
  return fs.readFileSync(recoveryPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { id: line, kind: "parse-error", reason: "invalid-json" };
      }
    });
}

/**
 * Read-only classification of recovery journal entries.
 * @param {string} [recoveryPath]
 */
export function summarizeRecoveryJournal(recoveryPath) {
  const resolved = recoveryPath
    ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".auth/recovery.jsonl");
  const entries = readRecoveryLinesFromPath(resolved);

  /** @type {Record<string, number>} */
  const byKind = {};
  let uuidCount = 0;
  let syntheticCount = 0;
  let emptyCount = 0;

  for (const entry of entries) {
    const bucket = classifyRecoveryEntryId(entry.id);
    if (bucket === "uuid") uuidCount += 1;
    else if (bucket === "synthetic") syntheticCount += 1;
    else emptyCount += 1;

    const kind = entry.kind ?? "unknown";
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }

  return {
    path: resolved,
    total: entries.length,
    uuidShaped: uuidCount,
    synthetic: syntheticCount,
    empty: emptyCount,
    byKind,
    uniqueRealUuidIds: [...new Set(entries.filter((entry) => classifyRecoveryEntryId(entry.id) === "uuid").map((entry) => entry.id))],
    duplicateUuidCounts: countDuplicateIds(entries.filter((entry) => classifyRecoveryEntryId(entry.id) === "uuid").map((entry) => entry.id)),
    note: "Synthetic entries are local test pollution and must not be treated as real QA users.",
  };
}

/**
 * @param {string[]} ids
 */
function countDuplicateIds(ids) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
  /** @type {Record<string, number>} */
  const duplicates = {};
  for (const [id, count] of Object.entries(counts)) {
    if (count > 1) duplicates[id] = count;
  }
  return duplicates;
}
