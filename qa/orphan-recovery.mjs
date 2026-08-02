// Registry orphan recovery — cleans interrupted prior runs before minting new QA identities.
import { readRegistry, writeRegistry } from "./registry.mjs";
import { getSupabaseAdmin } from "./admin-client.mjs";
import { runTeardownForUserIds } from "./teardown-core.mjs";
import { maskUserId } from "./qa-classification.mjs";

/**
 * @returns {{ recovered: number; remaining: number; remainingUserIds: string[] }}
 */
export async function recoverRegistryOrphans() {
  const reg = readRegistry();
  const userIds = [...new Set((reg.users ?? []).map((u) => u.userId).filter(Boolean))];
  if (!userIds.length) {
    return { recovered: 0, remaining: 0, remainingUserIds: [] };
  }

  const admin = getSupabaseAdmin();
  const result = await runTeardownForUserIds(admin, userIds, {
    execute: true,
    registryIds: userIds,
  });

  const remainingIds = new Set(result.refused.map((row) => row.userId));
  const remainingUsers = (reg.users ?? []).filter((u) => remainingIds.has(u.userId));
  writeRegistry({ ...reg, users: remainingUsers });

  const recovered = userIds.length - remainingIds.size;
  if (result.refused.length) {
    for (const row of result.refused) {
      console.error(
        `[qa-orphan-recovery] refused ${maskUserId(row.userId)} (${row.reason})`,
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
  const reg = readRegistry();
  return (reg.users?.length ?? 0) > 0;
}
