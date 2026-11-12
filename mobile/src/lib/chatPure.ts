export type ChatPhase = "unavailable" | "writable" | "readonly" | "disputed";

const WRITABLE_STATUSES = new Set([
  "confirmed",
  "on_the_way",
  "arrived",
  "arrival_confirmed",
  "in_progress",
  "completion_requested",
]);
const TERMINAL_STATUSES = new Set(["completed", "cancelled", "no_show"]);

export function chatPhaseForStatus(status: string | undefined): ChatPhase {
  if (!status) return "unavailable";
  if (status === "disputed") return "disputed";
  if (WRITABLE_STATUSES.has(status)) return "writable";
  if (TERMINAL_STATUSES.has(status)) return "readonly";
  return "unavailable";
}

export function conversationUnread(
  last: { created_at: string; sender_id: string | null } | undefined,
  meId: string,
  lastReadAt: string | null | undefined,
): boolean {
  if (!last?.created_at) return false;
  if (last.sender_id && last.sender_id === meId) return false;
  if (!lastReadAt) return true;
  return new Date(lastReadAt).getTime() < new Date(last.created_at).getTime();
}
