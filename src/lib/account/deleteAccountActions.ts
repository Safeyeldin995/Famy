import { supabase } from "@/integrations/supabase/client";
import type { AccountDeletionCheck } from "@/lib/account/accountDeletion.types";

export async function fetchAccountDeletionCheck(): Promise<AccountDeletionCheck> {
  const { data, error } = await supabase.rpc("account_deletion_check");
  if (error) throw error;
  return (data ?? { ok: false, reason: "not_authenticated" }) as AccountDeletionCheck;
}

export async function requestAccountDeletion(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token) {
    return { ok: false, error: "unauthorized" };
  }

  const response = await fetch("/api/account/delete", {
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
