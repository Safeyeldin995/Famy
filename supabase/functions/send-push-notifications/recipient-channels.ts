/** Pure query specs for loading active push channels — guarded by unit tests. */

export type NullIsFilter = { column: string; value: null };

export type RecipientChannelQuerySpec = {
  table: string;
  select: string;
  nullIsFilters: NullIsFilter[];
  /** Column names that must never appear in nullIsFilters (schema drift guard). */
  forbiddenNullIsColumns: string[];
};

export const PUSH_SUBSCRIPTION_CHANNEL: RecipientChannelQuerySpec = {
  table: "push_subscriptions",
  select: "endpoint, p256dh, auth_key",
  nullIsFilters: [{ column: "revoked_at", value: null }],
  forbiddenNullIsColumns: [],
};

export const DEVICE_PUSH_TOKEN_CHANNEL: RecipientChannelQuerySpec = {
  table: "device_push_tokens",
  select: "token",
  nullIsFilters: [{ column: "revoked_at", value: null }],
  forbiddenNullIsColumns: ["expired_at"],
};

export function validateRecipientChannelSpec(spec: RecipientChannelQuerySpec): void {
  for (const forbidden of spec.forbiddenNullIsColumns) {
    if (spec.nullIsFilters.some((f) => f.column === forbidden)) {
      throw new Error(`forbidden null filter column: ${forbidden}`);
    }
  }
  for (const f of spec.nullIsFilters) {
    if (f.value !== null) throw new Error(`only IS NULL filters are supported: ${f.column}`);
  }
}

export type DeviceTokenRow = { token: string | null };

export function deviceTokensFromRows(rows: DeviceTokenRow[] | null | undefined): string[] {
  return (rows ?? []).map((r) => r.token).filter((t): t is string => Boolean(t));
}
