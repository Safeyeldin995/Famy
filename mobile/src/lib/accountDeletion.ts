import { appConfig, supabase } from "./supabase";

export async function requestMobileAccountDeletion(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token) {
    return { ok: false, error: "unauthorized" };
  }

  const response = await fetch(`${appConfig.webOrigin.replace(/\/$/, "")}/api/account/delete`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
  });

  let body: { ok?: boolean; error?: string } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return { ok: false, error: "deletion_failed" };
  }

  if (!response.ok || !body.ok) {
    return { ok: false, error: body.error ?? "deletion_failed" };
  }
  return { ok: true };
}
