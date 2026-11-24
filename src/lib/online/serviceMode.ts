export type ServiceDeliveryMode = "in_person" | "online";

export function isOnlineServiceMode(mode: string | null | undefined): mode is "online" {
  return mode === "online";
}

export function normalizeServiceDeliveryMode(raw: unknown): ServiceDeliveryMode {
  return raw === "online" ? "online" : "in_person";
}