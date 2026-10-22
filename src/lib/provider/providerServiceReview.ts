export type ProviderServiceLinkStatus = "pending" | "approved" | "rejected" | "suspended" | string;

export function effectiveTeachingCapabilityStatus(
  capabilityStatus: string,
  serviceStatus: ProviderServiceLinkStatus | undefined,
): string {
  if (serviceStatus === "rejected") return "rejected";
  return capabilityStatus;
}

export function effectiveTeachingGroupStatuses(
  rowStatuses: string[],
  serviceStatus: ProviderServiceLinkStatus | undefined,
): string[] {
  if (serviceStatus === "rejected") return ["rejected"];
  return [...new Set(rowStatuses)];
}
