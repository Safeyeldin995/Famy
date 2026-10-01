import { afterEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  createDisposableDb,
  functionExecuteAllowed,
  functionIsSecurityInvoker,
  IDS,
  listRules,
  readMigration,
  seedIdentities,
  seedRule,
  tryReplace,
} from "./replace-provider-availability-harness";

const PREVIOUS = [
  { weekday: 1, start_time: "09:00:00", end_time: "12:00:00", timezone: "Africa/Cairo" },
  { weekday: 3, start_time: "13:00:00", end_time: "17:00:00", timezone: "Africa/Cairo" },
];

async function readyDb(): Promise<PGlite> {
  const db = await createDisposableDb();
  await seedIdentities(db);
  for (const rule of PREVIOUS) {
    await seedRule(db, IDS.provider, rule.weekday, rule.start_time, rule.end_time);
  }
  return db;
}

describe("replace_provider_availability", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("is SECURITY INVOKER with execute granted only to authenticated", async () => {
    const sql = readMigration();
    expect(sql).toMatch(/SECURITY INVOKER/);
    expect(sql).not.toMatch(/SECURITY DEFINER/);
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.replace_provider_availability(uuid, jsonb) FROM PUBLIC, anon",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.replace_provider_availability(uuid, jsonb) TO authenticated",
    );

    db = await createDisposableDb();
    expect(await functionIsSecurityInvoker(db)).toBe(true);
    expect(await functionExecuteAllowed(db, "authenticated")).toBe(true);
    expect(await functionExecuteAllowed(db, "anon")).toBe(false);
  });

  it("replaces existing rows exactly for a valid payload", async () => {
    db = await readyDb();
    const result = await tryReplace(db, {
      role: "authenticated",
      userId: IDS.providerUser,
      providerId: IDS.provider,
      rules: [
        { weekday: 2, start_time: "10:00", end_time: "14:00" },
        { weekday: 5, start_time: "08:00:00", end_time: "11:30:00" },
      ],
    });
    expect(result).toEqual({ ok: true });
    expect(await listRules(db, IDS.provider)).toEqual([
      { weekday: 2, start_time: "10:00:00", end_time: "14:00:00", timezone: "Africa/Cairo" },
      { weekday: 5, start_time: "08:00:00", end_time: "11:30:00", timezone: "Africa/Cairo" },
    ]);
  });

  it("clears weekly hours when the payload is an empty array", async () => {
    db = await readyDb();
    const result = await tryReplace(db, {
      role: "authenticated",
      userId: IDS.providerUser,
      providerId: IDS.provider,
      rules: [],
    });
    expect(result).toEqual({ ok: true });
    expect(await listRules(db, IDS.provider)).toEqual([]);
  });

  it("leaves previous rows unchanged when a rule is invalid", async () => {
    db = await readyDb();
    const result = await tryReplace(db, {
      role: "authenticated",
      userId: IDS.providerUser,
      providerId: IDS.provider,
      rules: [
        { weekday: 1, start_time: "09:00", end_time: "17:00" },
        { weekday: 2, start_time: "18:00", end_time: "10:00" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/23514|start_time must be before end_time/i);
    expect(await listRules(db, IDS.provider)).toEqual(PREVIOUS);
  });

  it("rejects overlapping same-day rules without writing", async () => {
    db = await readyDb();
    const result = await tryReplace(db, {
      role: "authenticated",
      userId: IDS.providerUser,
      providerId: IDS.provider,
      rules: [
        { weekday: 1, start_time: "09:00", end_time: "13:00" },
        { weekday: 1, start_time: "12:00", end_time: "17:00" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/23514|Overlapping availability/i);
    expect(await listRules(db, IDS.provider)).toEqual(PREVIOUS);
  });

  it("rejects another provider with 42501 and leaves rows unchanged", async () => {
    db = await readyDb();
    const result = await tryReplace(db, {
      role: "authenticated",
      userId: IDS.otherProviderUser,
      providerId: IDS.provider,
      rules: [{ weekday: 0, start_time: "09:00", end_time: "17:00" }],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/42501|Access denied/i);
    expect(await listRules(db, IDS.provider)).toEqual(PREVIOUS);
  });

  it("lets an admin replace another provider's weekly hours", async () => {
    db = await readyDb();
    const result = await tryReplace(db, {
      role: "authenticated",
      userId: IDS.adminUser,
      providerId: IDS.provider,
      rules: [{ weekday: 6, start_time: "11:00", end_time: "15:00" }],
    });
    expect(result).toEqual({ ok: true });
    expect(await listRules(db, IDS.provider)).toEqual([
      { weekday: 6, start_time: "11:00:00", end_time: "15:00:00", timezone: "Africa/Cairo" },
    ]);
  });

  it("does not let anon execute the function", async () => {
    db = await readyDb();
    expect(await functionExecuteAllowed(db, "anon")).toBe(false);
    const result = await tryReplace(db, {
      role: "anon",
      userId: null,
      providerId: IDS.provider,
      rules: [{ weekday: 1, start_time: "09:00", end_time: "17:00" }],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/42501|permission denied|must be owner/i);
    expect(await listRules(db, IDS.provider)).toEqual(PREVIOUS);
  });
});
