import { describe, expect, it } from "vitest";
import {
  applySql,
  createDisposableDb,
  queryRows,
  readMigration,
} from "./monitoring-privilege-harness";

const MIGRATION = "20261001150000_auth_user_lookup_by_phone.sql";
const FN = "public.auth_user_id_for_phone(text, text)";

async function functionExecuteAllowed(
  db: Awaited<ReturnType<typeof createDisposableDb>>,
  grantee: string,
): Promise<boolean> {
  const rows = await queryRows<{ allowed: boolean }>(
    db,
    `
      SELECT has_function_privilege($1, $2, 'EXECUTE') AS allowed
    `,
    [grantee, FN],
  );
  return Boolean(rows[0]?.allowed);
}

describe("auth_user_id_for_phone grants", () => {
  it("revokes PUBLIC/anon/authenticated and grants execute to service_role only", async () => {
    const db = await createDisposableDb();
    try {
      await applySql(
        db,
        `
          CREATE TABLE IF NOT EXISTS auth.users (
            id uuid PRIMARY KEY,
            email text,
            phone text
          );
        `,
      );
      await applySql(db, readMigration(MIGRATION));

      expect(await functionExecuteAllowed(db, "anon")).toBe(false);
      expect(await functionExecuteAllowed(db, "authenticated")).toBe(false);
      expect(await functionExecuteAllowed(db, "service_role")).toBe(true);
    } finally {
      await db.close();
    }
  });
});
