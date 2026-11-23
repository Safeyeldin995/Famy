import { appConfig, supabase } from "./supabase";

export type SessionTokenResponse =
  | { ok: true; token: string; url: string; room: string }
  | { ok: false; error: string };

export async function fetchOnlineSessionToken(input: {
  bookingId: string;
  displayName?: string;
}): Promise<SessionTokenResponse> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) return { ok: false, error: "unauthorized" };

  const response = await fetch(`${appConfig.webOrigin.replace(/\/$/, "")}/api/session/token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({
      bookingId: input.bookingId,
      ...(input.displayName ? { displayName: input.displayName } : {}),
    }),
  });
  const body = (await response.json()) as {
    ok?: boolean;
    token?: string;
    url?: string;
    room?: string;
    error?: string;
  };
  if (!response.ok || !body.ok || !body.token || !body.url) {
    return { ok: false, error: body.error ?? "server_error" };
  }
  return { ok: true, token: body.token, url: body.url, room: (body as { room?: string }).room ?? "" };
}