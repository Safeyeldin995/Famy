import { describe, expect, it } from "vitest";
import {
  applySql,
  createDisposableDb,
  publicTablePrivileges,
  readMigration,
  tablePrivilegeMatrix,
  type PrivilegeRow,
} from "./monitoring-privilege-harness";

const MIGRATION = "20261111100000_otp_send_attempts.sql";

function allowedMap(rows: PrivilegeRow[], grantee: string): Record<string, boolean> {
  return Object.fromEntries(
    rows.filter((row) => row.grantee === grantee).map((row) => [row.privilege, row.allowed]),
  );
}

describe("otp_send_attempts privileges", () => {
  it("enables RLS, revokes anon/authenticated, and grants service_role only", async () => {
    const db = await createDisposableDb();
    try {
      await applySql(db, readMigration(MIGRATION));
      const matrix = await tablePrivilegeMatrix(db, "otp_send_attempts");

      expect(allowedMap(matrix, "anon")).toEqual({
        SELECT: false,
        INSERT: false,
        UPDATE: false,
        DELETE: false,
        TRUNCATE: false,
        REFERENCES: false,
        TRIGGER: false,
      });
      expect(allowedMap(matrix, "authenticated")).toEqual({
        SELECT: false,
        INSERT: false,
        UPDATE: false,
        DELETE: false,
        TRUNCATE: false,
        REFERENCES: false,
        TRIGGER: false,
      });
      expect(allowedMap(matrix, "service_role")).toEqual({
        SELECT: true,
        INSERT: true,
        UPDATE: true,
        DELETE: true,
        TRUNCATE: true,
        REFERENCES: true,
        TRIGGER: true,
      });
      expect(await publicTablePrivileges(db, "otp_send_attempts")).toEqual([]);
    } finally {
      await db.close();
    }
  }, 30_000);
});
