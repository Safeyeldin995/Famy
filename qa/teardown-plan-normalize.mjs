import { canonicalizeLocator } from "./teardown-row-locators.mjs";

/** Phases where the same physical row may be attributed to multiple eligible users. */
export const CO_OWNED_PHASES = new Set(["booking_child", "booking"]);

/**
 * @param {string} table
 * @param {string} phase
 * @param {import("./teardown-row-locators.mjs").RowLocator} locator
 * @param {Record<string, string>} key
 */
export function physicalRowIdentity(table, phase, locator, key) {
  const canon = canonicalizeLocator({ ...locator, keys: [key] });
  return `${phase}:${table}:${canon.kind}:${canon.columns.join(",")}:${JSON.stringify(canon.keys[0])}`;
}

/**
 * @param {string | undefined} userId
 * @param {string[] | undefined} ownerUserIds
 */
export function deletionOwnersIncludeUser(userId, ownerUserIds, ownerUserId) {
  if (ownerUserIds?.length) return ownerUserIds.includes(userId);
  return ownerUserId === userId;
}

/**
 * Collapse duplicate per-user attributions into one physical row per locator key.
 * @param {Array<{
 *   table: string;
 *   phase: string;
 *   locator: import("./teardown-row-locators.mjs").RowLocator;
 *   ownerUserId?: string;
 *   resourceKey?: string;
 * }>} rawDeletions
 */
export function normalizePlanDeletions(rawDeletions) {
  /** @type {Array<{
   *   table: string;
   *   phase: string;
   *   locator: import("./teardown-row-locators.mjs").RowLocator;
   *   ownerUserIds: string[];
   *   ownerUserId?: string;
   *   coOwned: boolean;
   *   resourceKey?: string;
   * }>} */
  const normalized = [];

  /** @type {Map<string, {
   *   table: string;
   *   phase: string;
   *   locatorMeta: import("./teardown-row-locators.mjs").RowLocator;
   *   key: Record<string, string>;
   *   ownerUserIds: Set<string>;
   *   resourceKey?: string;
   * }>} */
  const physicalRows = new Map();

  for (const row of rawDeletions) {
    if (row.resourceKey) {
      normalized.push({
        table: row.table,
        phase: row.phase,
        locator: row.locator,
        ownerUserIds: [],
        coOwned: false,
        resourceKey: row.resourceKey,
      });
      continue;
    }

    for (const key of row.locator.keys) {
      const identity = physicalRowIdentity(row.table, row.phase, row.locator, key);
      if (!physicalRows.has(identity)) {
        physicalRows.set(identity, {
          table: row.table,
          phase: row.phase,
          locatorMeta: {
            kind: row.locator.kind,
            columns: [...row.locator.columns],
            keys: [],
          },
          key,
          ownerUserIds: new Set(),
          resourceKey: row.resourceKey,
        });
      }
      const entry = physicalRows.get(identity);
      if (row.ownerUserId) entry.ownerUserIds.add(row.ownerUserId);
    }
  }

  /** @type {Map<string, { table: string; phase: string; locatorMeta: object; keys: Record<string,string>[]; ownerUserIds: string[]; resourceKey?: string }>} */
  const grouped = new Map();

  for (const entry of physicalRows.values()) {
    const ownerUserIds = [...entry.ownerUserIds].sort();
    const groupKey = `${entry.table}:${entry.phase}:${entry.locatorMeta.kind}:${entry.locatorMeta.columns.join(",")}:${ownerUserIds.join(",")}`;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        table: entry.table,
        phase: entry.phase,
        locatorMeta: entry.locatorMeta,
        keys: [],
        ownerUserIds,
        resourceKey: entry.resourceKey,
      });
    }
    grouped.get(groupKey).keys.push(entry.key);
  }

  for (const group of grouped.values()) {
    const coOwned = CO_OWNED_PHASES.has(group.phase) && group.ownerUserIds.length > 1;
    normalized.push({
      table: group.table,
      phase: group.phase,
      locator: {
        kind: group.locatorMeta.kind,
        columns: group.locatorMeta.columns,
        keys: group.keys,
      },
      ownerUserIds: group.ownerUserIds,
      ownerUserId: group.ownerUserIds.length === 1 ? group.ownerUserIds[0] : undefined,
      coOwned,
      resourceKey: group.resourceKey,
    });
  }

  return normalized.sort((a, b) =>
    `${a.phase}:${a.table}:${JSON.stringify(a.locator.keys)}`.localeCompare(
      `${b.phase}:${b.table}:${JSON.stringify(b.locator.keys)}`,
    ),
  );
}

/**
 * @param {Array<{ table: string; phase: string; locator: import("./teardown-row-locators.mjs").RowLocator; ownerUserId?: string; ownerUserIds?: string[] }>} deletions
 */
export function countBookingMetrics(deletions) {
  let uniqueOwnedBookings = 0;
  let bookingOwnerAttributions = 0;

  for (const row of deletions) {
    if (row.table !== "bookings") continue;
    uniqueOwnedBookings += row.locator.keys.length;
    const owners = row.ownerUserIds?.length
      ? row.ownerUserIds.length
      : row.ownerUserId
        ? 1
        : 0;
    bookingOwnerAttributions += row.locator.keys.length * owners;
  }

  return { uniqueOwnedBookings, bookingOwnerAttributions };
}

/**
 * @param {Array<{ table: string; locator: import("./teardown-row-locators.mjs").RowLocator; ownerUserId?: string; ownerUserIds?: string[] }>} deletions
 */
export function computeTableMetricBreakdown(deletions) {
  /** @type {Record<string, { unique_keys: number; owner_attributions: number }>} */
  const breakdown = {};

  for (const row of deletions) {
    if (!breakdown[row.table]) breakdown[row.table] = { unique_keys: 0, owner_attributions: 0 };
    const owners = row.ownerUserIds?.length
      ? row.ownerUserIds.length
      : row.ownerUserId
        ? 1
        : 0;
    breakdown[row.table].unique_keys += row.locator.keys.length;
    breakdown[row.table].owner_attributions += row.locator.keys.length * Math.max(owners, 1);
  }

  return breakdown;
}
