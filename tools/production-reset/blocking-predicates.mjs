import { CATALOG_KEEP_TABLES } from "./constants.mjs";
import { isQaFixtureName, SEED_SERVICE_SLUGS, SEED_SERVICE_SLUG_SET } from "./seed-catalog.mjs";

export const EXPECTED_SEED_SERVICE_COUNT = SEED_SERVICE_SLUGS.length;

/**
 * Fail-closed catalog / target classification checks for Production reset planning.
 *
 * @param {{
 *   phaseAClosure: string[];
 *   seedServices: Array<{ id: string; slug: string; name_en?: string | null }>;
 *   deleteServices: Array<{ id: string; slug: string; name_en?: string | null }>;
 *   zones: Array<{ id: string; name_en?: string | null }>;
 * }} input
 */
export function evaluateCatalogBlockingChecks(input) {
  /** @type {string[]} */
  const blockedReasons = [];

  const catalogInClosure = input.phaseAClosure.filter((t) => CATALOG_KEEP_TABLES.has(t));
  if (catalogInClosure.length > 0) {
    blockedReasons.push(`phase-a-closure-includes-catalog:${catalogInClosure.join(",")}`);
  }

  if (input.seedServices.length !== EXPECTED_SEED_SERVICE_COUNT) {
    blockedReasons.push(
      `seed-service-count-mismatch:expected=${EXPECTED_SEED_SERVICE_COUNT},actual=${input.seedServices.length}`,
    );
  }

  const seedSlugsPresent = new Set(input.seedServices.map((s) => s.slug));
  for (const slug of SEED_SERVICE_SLUGS) {
    if (!seedSlugsPresent.has(slug)) {
      blockedReasons.push(`missing-seed-slug:${slug}`);
    }
  }

  const unexpectedSeedServices = input.seedServices.filter((s) => !SEED_SERVICE_SLUG_SET.has(s.slug));
  if (unexpectedSeedServices.length > 0) {
    blockedReasons.push(
      `unexpected-seed-slug:${unexpectedSeedServices.map((s) => s.slug).join(",")}`,
    );
  }

  const nonQaDeleteServices = input.deleteServices.filter((s) => !isQaFixtureName(s.name_en));
  if (nonQaDeleteServices.length > 0) {
    blockedReasons.push(`delete-service-missing-qa-marker:count=${nonQaDeleteServices.length}`);
  }

  const qaZones = input.zones.filter((z) => isQaFixtureName(z.name_en));
  const nonQaZones = input.zones.filter((z) => !isQaFixtureName(z.name_en));
  if (nonQaZones.length > 0) {
    blockedReasons.push(`zone-missing-qa-marker:count=${nonQaZones.length}`);
  }

  if (qaZones.length !== input.zones.length) {
    blockedReasons.push(
      `zone-qa-shaped-count-mismatch:qa=${qaZones.length},total=${input.zones.length}`,
    );
  }

  return {
    blocked: blockedReasons.length > 0,
    blockedReasons,
    blockedReason: blockedReasons.length > 0 ? blockedReasons.join("; ") : null,
    blockingInputs: {
      seedServiceCount: input.seedServices.length,
      deleteServiceCount: input.deleteServices.length,
      deleteServicesAllQaMarked: nonQaDeleteServices.length === 0,
      zoneCount: input.zones.length,
      zoneQaShapedCount: qaZones.length,
      zonesAllQaMarked: nonQaZones.length === 0 && qaZones.length === input.zones.length,
      catalogTablesInPhaseAClosure: catalogInClosure,
    },
  };
}
