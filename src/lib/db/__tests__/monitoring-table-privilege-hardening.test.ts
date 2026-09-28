import { describe, expect, it } from "vitest";
import {
  applySql,
  applySupabaseDefaultPrivileges,
  countErrorLogsAs,
  createDisposableDb,
  errorLogsAdminPolicy,
  ERROR_LOGS_MIGRATION,
  functionExecuteAllowed,
  grantPermissiveTableAcls,
  HARDENING_MIGRATION,
  insertErrorLogAs,
  publicTablePrivileges,
  RATE_LIMIT_MIGRATION,
  readMigration,
  rlsFlags,
  seedErrorLog,
  tablePrivilegeMatrix,
  type PrivilegeRow,
} from "./monitoring-privilege-harness";

const MUTATION_PRIVILEGES = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;

function allowedMap(rows: PrivilegeRow[], grantee: string): Record<string, boolean> {
  return Object.fromEntries(
    rows.filter((row) => row.grantee === grantee).map((row) => [row.privilege, row.allowed]),
  );
}

async function assertHardenedCatalog(db: Awaited<ReturnType<typeof createDisposableDb>>) {
  const errorLogs = await tablePrivilegeMatrix(db, "error_logs");
  const rateLimits = await tablePrivilegeMatrix(db, "error_log_rate_limits");

  expect(allowedMap(errorLogs, "anon")).toEqual({
    SELECT: false,
    INSERT: false,
    UPDATE: false,
    DELETE: false,
    TRUNCATE: false,
    REFERENCES: false,
    TRIGGER: false,
  });
  expect(allowedMap(errorLogs, "authenticated")).toEqual({
    SELECT: true,
    INSERT: false,
    UPDATE: false,
    DELETE: false,
    TRUNCATE: false,
    REFERENCES: false,
    TRIGGER: false,
  });
  expect(allowedMap(errorLogs, "service_role")).toEqual({
    SELECT: true,
    INSERT: true,
    UPDATE: true,
    DELETE: true,
    TRUNCATE: true,
    REFERENCES: true,
    TRIGGER: true,
  });

  for (const grantee of ["anon", "authenticated"] as const) {
    const privileges = allowedMap(rateLimits, grantee);
    expect(privileges.SELECT, `${grantee} SELECT on error_log_rate_limits`).toBe(false);
    for (const privilege of MUTATION_PRIVILEGES) {
      expect(privileges[privilege], `${grantee} ${privilege} on error_log_rate_limits`).toBe(false);
    }
  }
  expect(allowedMap(rateLimits, "service_role")).toEqual({
    SELECT: true,
    INSERT: true,
    UPDATE: true,
    DELETE: true,
    TRUNCATE: true,
    REFERENCES: true,
    TRIGGER: true,
  });

  expect(await publicTablePrivileges(db, "error_logs")).toEqual([]);
  expect(await publicTablePrivileges(db, "error_log_rate_limits")).toEqual([]);

  expect(await functionExecuteAllowed(db, "anon")).toBe(false);
  expect(await functionExecuteAllowed(db, "authenticated")).toBe(false);
  expect(await functionExecuteAllowed(db, "service_role")).toBe(true);

  const errorLogsRls = await rlsFlags(db, "error_logs");
  const rateLimitsRls = await rlsFlags(db, "error_log_rate_limits");
  expect(errorLogsRls.relrowsecurity).toBe(true);
  expect(rateLimitsRls.relrowsecurity).toBe(true);

  const policy = await errorLogsAdminPolicy(db);
  expect(policy.cmd).toBe("SELECT");
  expect(policy.roles).toEqual(["authenticated"]);
  expect(policy.qual ?? "").toMatch(/has_role/i);
}

async function assertAuthenticatedTruncateGranted(
  db: Awaited<ReturnType<typeof createDisposableDb>>,
  tableName: string,
) {
  const rows = await tablePrivilegeMatrix(db, tableName);
  expect(allowedMap(rows, "authenticated").TRUNCATE).toBe(true);
  expect(allowedMap(rows, "anon").TRUNCATE).toBe(true);
}

describe("monitoring table privilege hardening migration", () => {
  it("does not rewrite historical migrations or alter default privileges", () => {
    const hardening = readMigration(HARDENING_MIGRATION);
    const historical = readMigration(ERROR_LOGS_MIGRATION) + readMigration(RATE_LIMIT_MIGRATION);

    expect(hardening).toContain(
      "REVOKE ALL PRIVILEGES ON TABLE public.error_logs FROM PUBLIC, anon, authenticated",
    );
    expect(hardening).toContain("GRANT SELECT ON TABLE public.error_logs TO authenticated");
    expect(hardening).toContain("GRANT ALL PRIVILEGES ON TABLE public.error_logs TO service_role");
    expect(hardening).toContain(
      "REVOKE ALL PRIVILEGES ON TABLE public.error_log_rate_limits FROM PUBLIC, anon, authenticated",
    );
    expect(hardening).toContain(
      "GRANT ALL PRIVILEGES ON TABLE public.error_log_rate_limits TO service_role",
    );
    expect(hardening).not.toMatch(/ALTER\s+DEFAULT\s+PRIVILEGES/i);
    expect(historical).not.toContain("REVOKE ALL PRIVILEGES ON TABLE public.error_logs");
  });

  it("hardens privileges on a fresh replay with Supabase-like default grants", async () => {
    const db = await createDisposableDb();
    try {
      await applySupabaseDefaultPrivileges(db);
      await applySql(db, readMigration(ERROR_LOGS_MIGRATION));
      await applySql(db, readMigration(RATE_LIMIT_MIGRATION));
      await assertAuthenticatedTruncateGranted(db, "error_logs");
      await assertAuthenticatedTruncateGranted(db, "error_log_rate_limits");

      await applySql(db, readMigration(HARDENING_MIGRATION));
      await assertHardenedCatalog(db);
    } finally {
      await db.close();
    }
  });

  it("hardens an existing schema that still has permissive default grants", async () => {
    const db = await createDisposableDb();
    try {
      await applySql(db, readMigration(ERROR_LOGS_MIGRATION));
      await applySql(db, readMigration(RATE_LIMIT_MIGRATION));
      await grantPermissiveTableAcls(db, "error_logs");
      await grantPermissiveTableAcls(db, "error_log_rate_limits");
      await assertAuthenticatedTruncateGranted(db, "error_logs");
      await assertAuthenticatedTruncateGranted(db, "error_log_rate_limits");

      await applySql(db, readMigration(HARDENING_MIGRATION));
      await assertHardenedCatalog(db);
    } finally {
      await db.close();
    }
  });

  it("is idempotent and preserves admin-only reads plus service_role access", async () => {
    const db = await createDisposableDb();
    try {
      await applySql(db, readMigration(ERROR_LOGS_MIGRATION));
      await applySql(db, readMigration(RATE_LIMIT_MIGRATION));
      await grantPermissiveTableAcls(db, "error_logs");
      await grantPermissiveTableAcls(db, "error_log_rate_limits");
      await applySql(db, readMigration(HARDENING_MIGRATION));
      await applySql(db, readMigration(HARDENING_MIGRATION));
      await assertHardenedCatalog(db);

      const marker = "qa_privilege_hardening_marker";
      await seedErrorLog(db, marker);

      const anonRead = await countErrorLogsAs(db, "anon", marker);
      expect(anonRead.error ?? "").toMatch(/permission denied|42501/i);

      const nonAdminRead = await countErrorLogsAs(db, "authenticated", marker, { admin: false });
      expect(nonAdminRead.error).toBeUndefined();
      expect(nonAdminRead.count).toBe(0);

      const adminRead = await countErrorLogsAs(db, "authenticated", marker, { admin: true });
      expect(adminRead.error).toBeUndefined();
      expect(adminRead.count).toBe(1);

      const serviceRead = await countErrorLogsAs(db, "service_role", marker);
      expect(serviceRead.error).toBeUndefined();
      expect(serviceRead.count).toBe(1);

      const authenticatedInsert = await insertErrorLogAs(db, "authenticated", `${marker}_insert`);
      expect(authenticatedInsert.ok).toBe(false);
      expect(authenticatedInsert.error ?? "").toMatch(/permission denied|42501/i);

      const serviceInsert = await insertErrorLogAs(db, "service_role", `${marker}_service`);
      expect(serviceInsert.ok).toBe(true);
    } finally {
      await db.close();
    }
  });
});
