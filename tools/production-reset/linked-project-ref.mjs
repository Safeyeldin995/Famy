import fs from "node:fs";
import path from "node:path";

/**
 * Resolve the Supabase project ref currently linked to the local CLI.
 * Mirrors what `npx supabase db query --linked` would target.
 *
 * @param {string} [cwd]
 * @returns {string | null}
 */
export function resolveLinkedSupabaseProjectRef(cwd = process.cwd()) {
  const refPath = path.join(cwd, "supabase", ".temp", "project-ref");
  if (fs.existsSync(refPath)) {
    const ref = fs.readFileSync(refPath, "utf8").trim();
    if (ref) return ref;
  }

  const linkedJsonPath = path.join(cwd, "supabase", ".temp", "linked-project.json");
  if (fs.existsSync(linkedJsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(linkedJsonPath, "utf8"));
      if (typeof parsed.ref === "string" && parsed.ref.trim()) {
        return parsed.ref.trim();
      }
    } catch {
      // ignore malformed linked-project.json
    }
  }

  return null;
}
