import { getRequestBearerUserId } from "@/lib/auth/requestAuth.server";
import type { SessionJoinParty } from "@/lib/livekit/sessionAccess";

/** How a caller proved they may join an online session (phase 1: Supabase bearer only). */
export type SessionJoinCredential =
  | { kind: "authenticated"; userId: string }
  | { kind: "session_code"; userId: string; party: SessionJoinParty };

/**
 * Resolve join credentials from the incoming HTTP request.
 * Phase 2 can add one-time session codes without changing `authorizeSessionJoin`.
 */
export async function resolveSessionJoinCredential(
  _request: Request,
): Promise<SessionJoinCredential | null> {
  const userId = await getRequestBearerUserId();
  if (!userId) return null;
  return { kind: "authenticated", userId };
}