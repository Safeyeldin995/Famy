/**
 * Guarded QA integration registry mode — explicit multi-signal enablement only.
 * Network-free validation used by Vitest workers and unit tests.
 */
import path from "node:path";
import { validateQaEnvironment } from "./env-guard.mjs";
import {
  KNOWN_PRODUCTION_PROJECT_REF,
  KNOWN_QA_PROJECT_REF,
  parseSupabaseProjectRef,
} from "./qa-identity.mjs";

export const QA_INTEGRATION_REGISTRY_MARKER = "QA_INTEGRATION_REGISTRY";
export const OTP_INTEGRATION_MARKER = "OTP_INTEGRATION";
export const CANONICAL_QA_REGISTRY_RELATIVE = "qa/.auth";

/**
 * @param {Record<string, string | undefined>} env
 */
export function hasIntegrationSuiteMarker(env) {
  return env[QA_INTEGRATION_REGISTRY_MARKER] === "1"
    || env[OTP_INTEGRATION_MARKER] === "1";
}

/**
 * Validate all preconditions before enabling canonical registry writes in Vitest workers.
 * @param {Record<string, string | undefined>} env
 */
export function assertIntegrationRegistryPreconditions(env) {
  if (env.FAMY_ENV !== "qa") {
    throw new Error("[qa-registry] integration registry mode requires FAMY_ENV=qa");
  }

  if (!hasIntegrationSuiteMarker(env)) {
    throw new Error(
      "[qa-registry] integration registry mode requires explicit integration-suite marker "
      + `(${QA_INTEGRATION_REGISTRY_MARKER}=1 or ${OTP_INTEGRATION_MARKER}=1)`,
    );
  }

  validateQaEnvironment(env);

  const actualRef = parseSupabaseProjectRef(env.QA_SUPABASE_URL);
  if (actualRef !== KNOWN_QA_PROJECT_REF) {
    throw new Error("[qa-registry] integration registry mode requires the known QA project ref");
  }
  if (actualRef === KNOWN_PRODUCTION_PROJECT_REF) {
    throw new Error("[qa-registry] integration registry mode refuses Production project ref");
  }
}

/**
 * @param {string} [cwd]
 */
export function canonicalQaRegistryDir(cwd = process.cwd()) {
  return path.resolve(cwd, CANONICAL_QA_REGISTRY_RELATIVE);
}
