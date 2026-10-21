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
