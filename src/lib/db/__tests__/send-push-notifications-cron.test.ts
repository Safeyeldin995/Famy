import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  applySql,
  createDisposableDb,
  queryRows,
  readMigration,
} from "./monitoring-privilege-harness";
import { applyCronOnlyStubs, applySchedulerStubs } from "./supabase-scheduler-stubs.harness";
import {
  createMigrationReplayDb,
  readMigrationFile,
  replayAllMigrations,
} from "./migration-replay.harness";

export const SEND_PUSH_CRON_MIGRATION = "20261004110000_send_push_notifications_cron.sql";

async function createSendPushCronDb(): Promise<PGlite> {
  const db = await createDisposableDb();
  await applySchedulerStubs(db);
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
  await applySql(db, readMigration(SEND_PUSH_CRON_MIGRATION));
  return db;
}

describe("send-push-notifications cron migration", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("schedules famy-send-push-notifications and references Vault without literal secrets", () => {
    const sql = readMigrationFile(SEND_PUSH_CRON_MIGRATION);
    expect(sql).toContain("famy-send-push-notifications");
    expect(sql).toContain("vault.decrypted_secrets");
    expect(sql).toContain("'notification_worker_secret'");
    expect(sql).toContain("'project_url'");
    expect(sql).toContain("famy_invoke_send_push_notifications");
    expect(sql).toContain("extname = 'pg_net'");
    expect(sql).toContain("p.proname = 'http_post'");
    expect(sql).not.toMatch(/x-worker-secret['"],\s*'[A-Za-z0-9+/=]{8,}/);
    expect(sql).not.toMatch(/supabase\.co/i);
    expect(sql).not.toMatch(/mjhk/i);
  });

  it("does not schedule the cron job when pg_cron is present but pg_net is absent", async () => {
    db = await createDisposableDb();
    await applyCronOnlyStubs(db);
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
    await applySql(db, readMigration(SEND_PUSH_CRON_MIGRATION));
    const jobs = await queryRows<{ jobname: string }>(
      db,
      `SELECT jobname::text AS jobname FROM cron.job WHERE jobname = 'famy-send-push-notifications'`,
    );
    expect(jobs).toHaveLength(0);
  });

  it("registers the pg_cron job when extensions are stubbed", async () => {
    db = await createSendPushCronDb();
    const jobs = await queryRows<{ jobname: string; command: string; schedule: string }>(
      db,
      `SELECT jobname::text AS jobname, command, schedule FROM cron.job WHERE jobname = 'famy-send-push-notifications'`,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.schedule).toBe("* * * * *");
    expect(jobs[0]?.command).toContain("famy_invoke_send_push_notifications");
  });

  it("no-ops without Vault secrets (NOTICE, not error)", async () => {
    db = await createSendPushCronDb();
    await expect(
      db.query(`SELECT public.famy_invoke_send_push_notifications()`),
    ).resolves.toBeDefined();
    const url = await queryRows<{ c: string }>(
      db,
      `SELECT count(*)::text AS c FROM net._http_journal`,
    );
    expect(url[0]?.c).toBe("0");
  });

  it("POSTs to the edge function when Vault secrets exist", async () => {
    db = await createSendPushCronDb();
    await db.query(`INSERT INTO vault.secrets (name, secret) VALUES ($1, $2), ($3, $4)`, [
      "notification_worker_secret",
      "test-worker-secret-value",
      "project_url",
      "https://example.test",
    ]);
    await db.query(`SELECT public.famy_invoke_send_push_notifications()`);
    const row = await queryRows<{ url: string; headers: string }>(
      db,
      `SELECT url, headers FROM net._http_journal ORDER BY id DESC LIMIT 1`,
    );
    expect(row[0]?.url).toBe("https://example.test/functions/v1/send-push-notifications");
    expect(row[0]?.headers).toContain("x-worker-secret");
    expect(row[0]?.headers).toContain("test-worker-secret-value");
  });
});

describe("full migration replay", () => {
  it("replays the migrations folder cleanly with scheduler stubs", async () => {
    const db = await createMigrationReplayDb();
    try {
      await replayAllMigrations(db);
      const jobs = await queryRows<{ jobname: string }>(
        db,
        `SELECT jobname::text AS jobname FROM cron.job WHERE jobname = 'famy-send-push-notifications'`,
      );
      expect(jobs).toHaveLength(1);
      const permissions = await queryRows<{
        anon: boolean;
        authenticated: boolean;
        service_role: boolean;
      }>(
        db,
        `SELECT
          has_function_privilege('anon', 'public.get_notification_worker_secret()', 'EXECUTE') AS anon,
          has_function_privilege('authenticated', 'public.get_notification_worker_secret()', 'EXECUTE') AS authenticated,
          has_function_privilege('service_role', 'public.get_notification_worker_secret()', 'EXECUTE') AS service_role`,
      );
      expect(permissions).toEqual([
        { anon: false, authenticated: false, service_role: true },
      ]);
      const eligibilitySignatures = await queryRows<{ internal: string; wrapper: string; anon: boolean; authenticated: boolean }>(
        db,
        `SELECT
          pg_get_function_result('public.marketplace_eligibility_internal(uuid,uuid,uuid)'::regprocedure) AS internal,
          pg_get_function_result('public.provider_marketplace_eligibility(uuid,uuid,uuid)'::regprocedure) AS wrapper,
          has_function_privilege('anon', 'public.marketplace_eligibility_internal(uuid,uuid,uuid)', 'EXECUTE') AS anon,
          has_function_privilege('authenticated', 'public.marketplace_eligibility_internal(uuid,uuid,uuid)', 'EXECUTE') AS authenticated`,
      );
      expect(eligibilitySignatures[0]?.internal).toBe(eligibilitySignatures[0]?.wrapper);
      expect(eligibilitySignatures[0]?.anon).toBe(false);
      expect(eligibilitySignatures[0]?.authenticated).toBe(false);
    } finally {
      await db.close();
    }
  });
});
