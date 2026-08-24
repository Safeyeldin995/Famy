import { PHASE_A_TRUNCATE_ROOTS } from "./constants.mjs";
import { computeTruncateCascadeClosure } from "./fk-closure.mjs";

/** Minimum public FK edges expected from migration parsing — fail closed below this. */
export const MIN_MIGRATION_PUBLIC_FK_EDGE_COUNT = 70;

/** Minimum Phase A TRUNCATE CASCADE closure size — fail closed below this. */
export const MIN_PHASE_A_CLOSURE_TABLE_COUNT = 45;

/**
 * Known edges that must exist in any complete public FK graph used for reset planning.
 * @type {ReadonlyArray<{ child: string; parent: string; parentSchema?: string }>}
 */
export const REQUIRED_FK_EDGES = [
  { child: "payments", parent: "bookings", parentSchema: "public" },
  { child: "provider_services", parent: "providers", parentSchema: "public" },
  { child: "bookings", parent: "profiles", parentSchema: "public" },
  { child: "bookings", parent: "services", parentSchema: "public" },
  { child: "audit_logs", parent: "users", parentSchema: "auth" },
  { child: "user_roles", parent: "users", parentSchema: "auth" },
  { child: "service_requirements", parent: "services", parentSchema: "public" },
  { child: "zone_services", parent: "services", parentSchema: "public" },
  { child: "zone_services", parent: "zones", parentSchema: "public" },
];

/** Tables that must appear in Phase A closure when roots are complete. */
export const REQUIRED_PHASE_A_CLOSURE_TABLES = [
  "user_roles",
  "audit_logs",
  "payments",
  "bookings",
  "messages",
  "notifications",
];

/**
 * @param {import("./fk-graph.mjs").FkEdge[]} edges
 */
function edgeKey(edge) {
  return `${edge.child}->${edge.parentSchema}.${edge.parent}`;
}

/**
 * @param {import("./fk-graph.mjs").FkEdge[]} edges
 */
export function assertMigrationFkGraphComplete(edges) {
  if (edges.length < MIN_MIGRATION_PUBLIC_FK_EDGE_COUNT) {
    throw new Error(
      `[production-reset] Migration FK graph incomplete: ${edges.length} edges (minimum ${MIN_MIGRATION_PUBLIC_FK_EDGE_COUNT})`,
    );
  }

  const edgeSet = new Set(edges.map(edgeKey));
  const missing = REQUIRED_FK_EDGES.filter(
    (req) => !edgeSet.has(`${req.child}->${(req.parentSchema ?? "public")}.${req.parent}`),
  );
  if (missing.length > 0) {
    throw new Error(
      `[production-reset] Migration FK graph missing required edges: ${missing.map((e) => `${e.child}->${e.parent}`).join(", ")}`,
    );
  }
}

/**
 * @param {string[]} closure
 * @param {string[]} [roots]
 */
export function assertPhaseAClosureComplete(closure, roots = PHASE_A_TRUNCATE_ROOTS) {
  if (closure.length < MIN_PHASE_A_CLOSURE_TABLE_COUNT) {
    throw new Error(
      `[production-reset] Phase A closure too small: ${closure.length} tables (minimum ${MIN_PHASE_A_CLOSURE_TABLE_COUNT})`,
    );
  }

  for (const root of roots) {
    if (!closure.includes(root)) {
      throw new Error(`[production-reset] Phase A closure missing root table: ${root}`);
    }
  }

  const missing = REQUIRED_PHASE_A_CLOSURE_TABLES.filter((t) => !closure.includes(t));
  if (missing.length > 0) {
    throw new Error(
      `[production-reset] Phase A closure missing required tables: ${missing.join(", ")}`,
    );
  }

  const catalogLeak = ["services", "service_requirements", "promo_code_services"].filter((t) =>
    closure.includes(t),
  );
  if (catalogLeak.length > 0) {
    throw new Error(
      `[production-reset] Phase A closure must not include Phase B catalog tables: ${catalogLeak.join(", ")}`,
    );
  }
}

/**
 * Validate migration-derived graph and its Phase A closure — throws on gap.
 *
 * @param {import("./fk-graph.mjs").FkEdge[]} edges
 */
export function validateMigrationFkGraphAndClosure(edges) {
  assertMigrationFkGraphComplete(edges);
  const closure = computeTruncateCascadeClosure(edges, [...PHASE_A_TRUNCATE_ROOTS]);
  assertPhaseAClosureComplete(closure);
  return closure;
}
