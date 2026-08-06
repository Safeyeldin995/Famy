// Registry orphan recovery — cleans interrupted prior E2E runs before minting new QA identities.
import {
  readRegistry,
  writeRegistry,
  removeRegistryUsers,
  readE2eFixtureUserIds,
} from "./registry.mjs";
import { getSupabaseAdmin } from "./admin-client.mjs";
import { runTeardownForUserIds } from "./teardown-core.mjs";
import { maskUserId } from "./qa-classification.mjs";

/**
 * @returns {{ recovered: number; remaining: number; remainingUserIds: string[] }}
 */
export async function recoverRegistryOrphans() {
  const reg = readRegistry();
  const userIds = [...new Set(readE2eFixtureUserIds())];
  if (!userIds.length) {
    return { recovered: 0, remaining: 0, remainingUserIds: [] };
  }

  const admin = getSupabaseAdmin();
  const result = await runTeardownForUserIds(admin, userIds, {
    execute: true,
    registryIds: userIds,
  });

  const remainingIds = new Set([
    ...result.refused.map((row) => row.userId),
    ...result.failed.map((row) => row.userId),
    ...result.retained.map((row) => row.userId),
  ]);
  const remainingUsers = (reg.users ?? []).filter((u) => remainingIds.has(u.userId));
  if (result.succeeded.length) {
    removeRegistryUsers(result.succeeded);
  }
  writeRegistry({
    schemaVersion: reg.schemaVersion,
    qaPassword: reg.qaPassword,
    phones: reg.phones,
    e2eSnapshot: null,
    users: remainingUsers,
  });

  const recovered = userIds.length - remainingIds.size;
  if (result.refused.length) {
    for (const row of result.refused) {
      console.error(
        `[qa-orphan-recovery] refused ${maskUserId(row.userId)} (${row.reason})`,
      );
    }
  }
  if (result.failed.length) {
    for (const row of result.failed) {
      console.error(
        `[qa-orphan-recovery] failed ${maskUserId(row.userId)} (${row.reason})`,
      );
    }
  }

  return {
    recovered,
    remaining: remainingIds.size,
    remainingUserIds: [...remainingIds],
  };
}

export function registryHasPendingOrphans() {
  return readE2eFixtureUserIds().length > 0;
}
