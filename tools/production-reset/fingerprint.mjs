import crypto from "node:crypto";
import { PRODUCTION_PROJECT_REF } from "./constants.mjs";
import { fingerprintSortedIds } from "./seed-catalog.mjs";

/**
 * @param {import("./fk-graph.mjs").FkEdge[]} edges
 */
export function fingerprintFkEdges(edges) {
  const canonical = [...edges]
    .map((e) => `${e.child}|${e.parentSchema}.${e.parent}|${e.onDelete}`)
    .sort()
    .join("\n");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * @param {Array<{ bucket: string; key: string }>} objects
 */
export function fingerprintStorageObjectKeys(objects) {
  const canonical = [...objects]
    .map((o) => `${o.bucket}:${o.key}`)
    .sort()
    .join("\n");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * @param {object} input
 */
export function buildFingerprintInput(input) {
  return {
    version: input.version,
    projectRef: PRODUCTION_PROJECT_REF,
    fkGraphSource: input.fkGraphSource,
    fkEdgesFingerprint: input.fkEdgesFingerprint,
    phaseATruncateRoots: input.phaseATruncateRoots,
    phaseAClosure: input.phaseAClosure,
    serviceDeleteFingerprint: input.serviceDeleteFingerprint,
    serviceKeepFingerprint: input.serviceKeepFingerprint,
    serviceRequirementDeleteFingerprint: input.serviceRequirementDeleteFingerprint,
    zoneDeleteFingerprint: input.zoneDeleteFingerprint,
    authUserIdsFingerprint: input.authUserIdsFingerprint,
    storageObjectKeysFingerprint: input.storageObjectKeysFingerprint,
    executeOrder: input.executeOrder,
    blockingInputs: input.blockingInputs,
  };
}

/**
 * @param {ReturnType<typeof buildFingerprintInput>} canonicalInput
 */
export function fingerprintFromCanonicalInput(canonicalInput) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalInput)).digest("hex");
}

/**
 * @param {{
 *   version: string;
 *   fkGraphSource: string;
 *   fkEdges: import("./fk-graph.mjs").FkEdge[];
 *   phaseATruncateRoots: string[];
 *   phaseAClosure: string[];
 *   serviceDeleteIds: string[];
 *   serviceKeepIds: string[];
 *   serviceRequirementDeleteIds: string[];
 *   zoneDeleteIds: string[];
 *   authUserIds: string[];
 *   storageObjects: Array<{ bucket: string; key: string }>;
 *   executeOrder: string[];
 *   blockingInputs: object;
 * }} planParts
 */
export function fingerprintPlan(planParts) {
  const canonicalInput = buildFingerprintInput({
    version: planParts.version,
    fkGraphSource: planParts.fkGraphSource,
    fkEdgesFingerprint: fingerprintFkEdges(planParts.fkEdges),
    phaseATruncateRoots: [...planParts.phaseATruncateRoots].sort(),
    phaseAClosure: planParts.phaseAClosure,
    serviceDeleteFingerprint: fingerprintSortedIds(planParts.serviceDeleteIds),
    serviceKeepFingerprint: fingerprintSortedIds(planParts.serviceKeepIds),
    serviceRequirementDeleteFingerprint: fingerprintSortedIds(planParts.serviceRequirementDeleteIds),
    zoneDeleteFingerprint: fingerprintSortedIds(planParts.zoneDeleteIds),
    authUserIdsFingerprint: fingerprintSortedIds(planParts.authUserIds),
    storageObjectKeysFingerprint: fingerprintStorageObjectKeys(planParts.storageObjects),
    executeOrder: planParts.executeOrder,
    blockingInputs: planParts.blockingInputs,
  });
  return fingerprintFromCanonicalInput(canonicalInput);
}
