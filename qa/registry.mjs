// QA-only helper: merge-safe registry for integration fixture user tracking.
import fs from "fs";
import path from "path";
import {
  assertIntegrationRegistryPreconditions,
  canonicalQaRegistryDir,
} from "./registry-integration-mode.mjs";

/** @type {string | null} */
let registryRootOverride = null;
/** @type {boolean} */
let integrationRegistryModeEnabled = false;

/**
 * Redirect registry I/O to an isolated directory (unit tests only).
 * @param {string | null} rootDir
 */
export function configureRegistryRootForTests(rootDir) {
  registryRootOverride = rootDir;
  integrationRegistryModeEnabled = false;
}

export function resetRegistryRootForTests() {
  registryRootOverride = null;
}

export function resetIntegrationRegistryModeForTests() {
  integrationRegistryModeEnabled = false;
}

export function isIntegrationRegistryModeEnabled() {
  return integrationRegistryModeEnabled;
}

/**
 * Enable canonical qa/.auth registry writes inside a guarded Vitest integration worker.
 * @param {Record<string, string | undefined>} [env]
 */
export function enableGuardedIntegrationRegistryMode(env = process.env) {
  if (!isTestRuntime()) {
    throw new Error("[qa-registry] integration registry mode may only be enabled inside Vitest workers");
  }
  if (registryRootOverride) {
    throw new Error("[qa-registry] integration registry mode cannot be enabled with an isolated test root");
  }
  assertIntegrationRegistryPreconditions(env);
  integrationRegistryModeEnabled = true;
}

function isTestRuntime() {
  return process.env.VITEST === "true"
    || process.env.VITEST === "1"
    || typeof process.env.VITEST_WORKER_ID === "string";
}

function assertRegistryWriteAllowed() {
  if (!isTestRuntime()) return;
  if (registryRootOverride) return;
  if (integrationRegistryModeEnabled) return;
  throw new Error(
    "[qa-registry] refuse write: tests must call configureRegistryRootForTests() "
    + "or enableGuardedIntegrationRegistryMode() before mutating registry/recovery",
  );
}

function registryDir() {
  if (registryRootOverride) return registryRootOverride;
  return canonicalQaRegistryDir();
}

function registryPath() {
  return path.join(registryDir(), "registry.json");
}

function journalPath() {
  return path.join(registryDir(), "registry.journal.jsonl");
}

function lockPath() {
  return path.join(registryDir(), "registry.lock");
}

function recoveryPath() {
  return path.join(registryDir(), "recovery.jsonl");
}

/** @type {number} */
let registryLockDepth = 0;

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy wait — lock holder should release quickly
  }
}

/**
 * Exclusive file lock for cross-process serialized registry writes.
 * Reentrant within the same process so nested registry helpers can compose safely.
 * @template T
 * @param {() => T} operation
 * @returns {T}
 */
export function withRegistryLock(operation) {
  assertRegistryWriteAllowed();
  if (registryLockDepth > 0) {
    registryLockDepth += 1;
    try {
      return operation();
    } finally {
      registryLockDepth -= 1;
    }
  }

  fs.mkdirSync(registryDir(), { recursive: true });
  /** @type {number | null} */
  let fd = null;
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      fd = fs.openSync(lockPath(), "wx");
      break;
    } catch {
      sleepSync(5 + Math.min(attempt, 20));
    }
  }
  if (fd === null) {
    throw new Error("[qa-registry] failed to acquire registry lock");
  }
  registryLockDepth = 1;
  try {
    return operation();
  } finally {
    registryLockDepth = 0;
    fs.closeSync(fd);
    try {
      fs.unlinkSync(lockPath());
    } catch {
      // lock already released
    }
  }
}

/** @returns {Array<Record<string, unknown>>} */
function readJournalLines() {
  const journalFile = journalPath();
  if (!fs.existsSync(journalFile)) return [];
  return fs
    .readFileSync(journalFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** @returns {Array<Record<string, unknown>>} */
function readRecoveryLines() {
  const recoveryFile = recoveryPath();
  if (!fs.existsSync(recoveryFile)) return [];
  return fs
    .readFileSync(recoveryFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readRegistryBase() {
  try {
    return JSON.parse(fs.readFileSync(registryPath(), "utf8"));
  } catch {
    return { users: [] };
  }
}

/** Synthetic QA password written by Playwright global setup — never log or persist elsewhere. */
export function readQaSyntheticPassword() {
  const password = readRegistryBase().qaPassword;
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("[qa-registry] qaPassword missing from registry.json");
  }
  return password;
}

/** Merge base registry + append-only journal into authoritative state. */
export function mergeRegistryState() {
  const base = readRegistryBase();
  /** @type {Map<string, { userId: string; email?: string; suite?: string; runId?: string }>} */
  const usersById = new Map((base.users ?? []).map((user) => [user.userId, user]));
  for (const entry of readJournalLines()) {
    if (entry.type === "user" && typeof entry.userId === "string") {
      usersById.set(entry.userId, {
        userId: entry.userId,
        email: typeof entry.email === "string" ? entry.email : undefined,
        suite: typeof entry.suite === "string" ? entry.suite : undefined,
        runId: typeof entry.runId === "string" ? entry.runId : undefined,
      });
    }
    if (entry.type === "remove-user" && typeof entry.userId === "string") {
      usersById.delete(entry.userId);
    }
  }
  return {
    users: [...usersById.values()],
    recovery: readRecoveryLines(),
  };
}

export function readRegistry() {
  return mergeRegistryState();
}

/** @param {Record<string, unknown>} entry */
function appendJournal(entry) {
  fs.appendFileSync(journalPath(), `${JSON.stringify(entry)}\n`, "utf8");
}

/** @param {Record<string, unknown>} entry */
function appendRecovery(entry) {
  fs.appendFileSync(recoveryPath(), `${JSON.stringify(entry)}\n`, "utf8");
}

/**
 * Register a user before first mutation — merge-safe under lock.
 * @param {{ userId: string; email?: string; suite?: string; runId?: string }} entry
 */
export function registerUserEntry(entry) {
  if (!entry?.userId) {
    throw new Error("[qa-registry] userId required");
  }
  withRegistryLock(() => {
    appendJournal({
      type: "user",
      userId: entry.userId,
      email: entry.email,
      suite: entry.suite,
      runId: entry.runId,
      ts: Date.now(),
    });
  });
}

/** @param {string[]} userIds */
export function removeRegistryUsers(userIds) {
  withRegistryLock(() => {
    for (const userId of userIds) {
      appendJournal({ type: "remove-user", userId, ts: Date.now() });
    }
  });
}

/**
 * Persist refused/failed cleanup ids for orphan recovery.
 * @param {{ id: string; kind: string; reason: string; runId?: string }} entry
 */
export function recordRecoveryFailure(entry) {
  if (!entry?.id) {
    throw new Error("[qa-registry] recovery id required");
  }
  withRegistryLock(() => {
    appendRecovery({ ...entry, ts: Date.now() });
  });
}

export function readRecoveryFailures() {
  return readRecoveryLines();
}

export function writeRegistry(reg) {
  withRegistryLock(() => {
    fs.writeFileSync(registryPath(), JSON.stringify(reg, null, 2));
  });
}

export function addUser(reg, entry) {
  registerUserEntry(entry);
  reg.users.push(entry);
  return reg;
}

/** Compact journal into registry.json (operator/maintenance). */
export function compactRegistry() {
  withRegistryLock(() => {
    const merged = mergeRegistryState();
    fs.writeFileSync(registryPath(), JSON.stringify({ users: merged.users }, null, 2));
    fs.writeFileSync(journalPath(), "");
  });
}

/** @returns {string} */
export function registryPathsForTests() {
  return registryDir();
}
