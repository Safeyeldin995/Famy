export type ProviderServiceRowStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "paused"
  | "removed";

export type ProviderServiceListRow = {
  service_id: string;
  status: ProviderServiceRowStatus;
  rejection_reason?: string | null;
};

export type ProviderServiceGroupKey =
  | "active"
  | "pending"
  | "paused"
  | "rejected";

const GROUP_ORDER: ProviderServiceGroupKey[] = ["active", "pending", "paused", "rejected"];

export function providerServiceGroupKey(
  status: ProviderServiceRowStatus,
): ProviderServiceGroupKey | null {
  switch (status) {
    case "approved":
      return "active";
    case "pending":
      return "pending";
    case "paused":
      return "paused";
    case "rejected":
      return "rejected";
    case "removed":
      return null;
    default:
      return null;
  }
}

export function groupProviderServices<T extends ProviderServiceListRow>(
  rows: T[],
): { key: ProviderServiceGroupKey; items: T[] }[] {
  const buckets = new Map<ProviderServiceGroupKey, T[]>();
  for (const row of rows) {
    const key = providerServiceGroupKey(row.status);
    if (!key) continue;
    const list = buckets.get(key) ?? [];
    list.push(row);
    buckets.set(key, list);
  }
  return GROUP_ORDER.filter((key) => (buckets.get(key)?.length ?? 0) > 0).map((key) => ({
    key,
    items: buckets.get(key)!,
  }));
}

export function providerServiceStatusI18nKey(status: ProviderServiceRowStatus): string {
  switch (status) {
    case "approved":
      return "pro.serviceLifecycle.statusActive";
    case "pending":
      return "pro.serviceLifecycle.statusPending";
    case "paused":
      return "pro.serviceLifecycle.statusPaused";
    case "rejected":
      return "pro.serviceLifecycle.statusRejected";
    default:
      return `providerSetup.status.${status}`;
  }
}