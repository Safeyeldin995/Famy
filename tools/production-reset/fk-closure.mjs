/**
 * TRUNCATE … CASCADE closure: all public tables with an FK reference TO any table in the set.
 * @param {import("./fk-graph.mjs").FkEdge[]} edges
 * @param {string[]} roots
 * @returns {string[]}
 */
export function computeTruncateCascadeClosure(edges, roots) {
  const closure = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (edge.parentSchema !== "public") continue;
      if (closure.has(edge.parent) && !closure.has(edge.child)) {
        closure.add(edge.child);
        changed = true;
      }
    }
  }
  return [...closure].sort();
}

/**
 * Phase B service DELETE cascades (ON DELETE CASCADE children of services).
 * @param {import("./fk-graph.mjs").FkEdge[]} edges
 */
export function computeServiceDeleteCascadeTables(edges) {
  const children = edges
    .filter((e) => e.parent === "services" && e.parentSchema === "public" && e.onDelete === "CASCADE")
    .map((e) => e.child);
  return [...new Set(["services", ...children])].sort();
}
