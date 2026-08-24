import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const FK_QUERY = `
SELECT
  child.relname AS child_table,
  parent.relname AS parent_table,
  nsp_parent.nspname AS parent_schema,
  CASE c.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
  END AS on_delete
FROM pg_constraint c
JOIN pg_class child ON c.conrelid = child.oid
JOIN pg_namespace nsp_child ON child.relnamespace = nsp_child.oid
JOIN pg_class parent ON c.confrelid = parent.oid
JOIN pg_namespace nsp_parent ON parent.relnamespace = nsp_parent.oid
WHERE c.contype = 'f'
  AND nsp_child.nspname = 'public'
ORDER BY child_table, parent_table;
`.replace(/\s+/g, " ").trim();

/**
 * @typedef {{ child: string; parent: string; parentSchema: string; onDelete: string }} FkEdge
 */

/**
 * @returns {{ edges: FkEdge[]; source: "pg_constraint" | "migrations" }}
 */
export function loadPublicFkEdges() {
  try {
    const raw = execSync(`npx supabase db query --linked ${JSON.stringify(FK_QUERY)}`, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const edges = parseSupabaseDbQueryOutput(raw);
    if (edges.length > 0) {
      return { edges, source: "pg_constraint" };
    }
  } catch {
    // IPv6 / CLI unavailable — fall back to migration-derived graph
  }
  return { edges: loadFkEdgesFromMigrations(), source: "migrations" };
}

/**
 * @param {string} raw
 * @returns {FkEdge[]}
 */
function parseSupabaseDbQueryOutput(raw) {
  /** @type {FkEdge[]} */
  const edges = [];
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("npm warn") || line.startsWith("{")) continue;
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length >= 4 && parts[0] !== "child_table") {
      edges.push({
        child: parts[0],
        parent: parts[1],
        parentSchema: parts[2],
        onDelete: parts[3],
      });
    }
  }
  return edges;
}

/**
 * Migration-derived FK edges for public.child → public.parent (and public → auth.users).
 * Kept in sync with applied migrations when live pg_constraint is unreachable.
 * @returns {FkEdge[]}
 */
export function loadFkEdgesFromMigrations() {
  const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
  const sql = fs
    .readdirSync(migrationsDir)
    .filter((n) => n.endsWith(".sql"))
    .map((n) => fs.readFileSync(path.join(migrationsDir, n), "utf8"))
    .join("\n");

  /** @type {Map<string, FkEdge>} */
  const edgeMap = new Map();

  function add(child, parent, parentSchema, onDelete = "NO ACTION") {
    const key = `${child}->${parentSchema}.${parent}`;
    edgeMap.set(key, { child, parent, parentSchema, onDelete });
  }

  const publicRef = /REFERENCES\s+public\.(\w+)\([^)]+\)(?:\s+ON DELETE\s+(\w+(?:\s+\w+)?))?/gi;
  const authRef = /REFERENCES\s+auth\.users\([^)]+\)(?:\s+ON DELETE\s+(\w+(?:\s+\w+)?))?/gi;

  const createBlocks = sql.match(/CREATE TABLE(?: IF NOT EXISTS)?\s+public\.(\w+)[\s\S]*?;/gi) ?? [];
  for (const block of createBlocks) {
    const childMatch = block.match(/CREATE TABLE(?: IF NOT EXISTS)?\s+public\.(\w+)/i);
    if (!childMatch) continue;
    const child = childMatch[1];
    let m;
    publicRef.lastIndex = 0;
    while ((m = publicRef.exec(block))) {
      add(child, m[1], "public", normalizeOnDelete(m[2]));
    }
    authRef.lastIndex = 0;
    while ((m = authRef.exec(block))) {
      add(child, "users", "auth", normalizeOnDelete(m[1]));
    }
  }

  const alterBlocks = sql.match(/ALTER TABLE\s+public\.(\w+)[\s\S]*?;/gi) ?? [];
  for (const block of alterBlocks) {
    const childMatch = block.match(/ALTER TABLE\s+public\.(\w+)/i);
    if (!childMatch) continue;
    const child = childMatch[1];
    let m;
    publicRef.lastIndex = 0;
    while ((m = publicRef.exec(block))) {
      add(child, m[1], "public", normalizeOnDelete(m[2]));
    }
    authRef.lastIndex = 0;
    while ((m = authRef.exec(block))) {
      add(child, "users", "auth", normalizeOnDelete(m[1]));
    }
  }

  const fkConstraintBlocks = sql.match(/FOREIGN KEY[\s\S]*?REFERENCES\s+public\.(\w+)\([^)]+\)(?:\s+ON DELETE\s+(\w+(?:\s+\w+)?))?/gi) ?? [];
  for (const block of fkConstraintBlocks) {
    const parentMatch = block.match(/REFERENCES\s+public\.(\w+)/i);
    const onDelMatch = block.match(/ON DELETE\s+(\w+(?:\s+\w+)?)/i);
    if (!parentMatch) continue;
    const alterCtx = sql.slice(Math.max(0, sql.indexOf(block) - 200), sql.indexOf(block));
    const childMatch = alterCtx.match(/ALTER TABLE\s+public\.(\w+)/i);
    if (childMatch) {
      add(childMatch[1], parentMatch[1], "public", normalizeOnDelete(onDelMatch?.[1]));
    }
  }

  // Manual supplements verified against migration intent where regex misses ALTER splits
  const manual = [
    ["bookings", "profiles", "public", "RESTRICT"],
    ["bookings", "providers", "public", "RESTRICT"],
    ["bookings", "services", "public", "RESTRICT"],
    ["bookings", "addresses", "public", "SET NULL"],
    ["bookings", "zones", "public", "SET NULL"],
    ["payments", "users", "auth", "RESTRICT"],
    ["payments", "payment_methods", "public", "RESTRICT"],
    ["payments", "bookings", "public", "CASCADE"],
    ["audit_logs", "users", "auth", "NO ACTION"],
    ["audit_logs", "bookings", "public", "SET NULL"],
    ["profiles", "users", "auth", "CASCADE"],
    ["providers", "profiles", "public", "CASCADE"],
    ["notifications", "bookings", "public", "SET NULL"],
    ["notifications", "users", "auth", "CASCADE"],
    ["notification_outbox", "notifications", "public", "CASCADE"],
    ["notification_outbox", "users", "auth", "CASCADE"],
    ["user_roles", "users", "auth", "CASCADE"],
    ["promo_code_redemptions", "promo_codes", "public", "RESTRICT"],
    ["promo_code_redemptions", "bookings", "public", "CASCADE"],
    ["promo_code_services", "promo_codes", "public", "RESTRICT"],
    ["service_requirements", "services", "public", "CASCADE"],
    ["provider_services", "services", "public", "CASCADE"],
    ["zone_services", "services", "public", "CASCADE"],
    ["zone_services", "zones", "public", "CASCADE"],
    ["zone_providers", "zones", "public", "CASCADE"],
    ["zone_providers", "providers", "public", "CASCADE"],
  ];
  for (const [child, parent, schema, onDelete] of manual) {
    add(child, parent, schema, onDelete);
  }

  return [...edgeMap.values()];
}

/**
 * @param {string | undefined} raw
 */
function normalizeOnDelete(raw) {
  if (!raw) return "NO ACTION";
  return raw.toUpperCase().replace(/\s+/g, " ");
}
