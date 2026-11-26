import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { sendParentGuardianEmail } from "@/lib/email/parentGuardianEmail.server";

export type ParentGuardianEmailFlowResult =
  | { ok: true; deduplicated?: boolean }
  | { ok: false; reason: string };

function createAuthedSupabase(token: string) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    throw new Error("Supabase is not configured");
  }
  return createClient<Database>(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type ClaimPayload = {
  parent_email: string;
  student_name: string;
  flag_token: string;
  send_id?: string;
  deduplicated?: boolean;
};

/**
 * Claims the student's email slot (as the student, so the database checks ownership and
 * limits), sends the guardian email, and gives the slot back when the provider refuses the
 * message so a failure never counts as "sent". Used by the website and the app.
 */
export async function claimAndSendParentGuardianEmail(input: {
  token: string;
  linkId?: string | null;
}): Promise<ParentGuardianEmailFlowResult> {
  const supabase = createAuthedSupabase(input.token);
  const { data: claimed, error } = await (supabase.rpc as any)("claim_parent_guardian_email_send", {
    p_link_id: input.linkId ?? null,
  });
  if (error) {
    return { ok: false, reason: error.message };
  }
  const payload = claimed as ClaimPayload;
  if (payload.deduplicated) {
    return { ok: true, deduplicated: true };
  }

  let result: ParentGuardianEmailFlowResult;
  try {
    result = await sendParentGuardianEmail({
      parentEmail: payload.parent_email,
      studentName: payload.student_name,
      flagToken: payload.flag_token,
    });
  } catch (e) {
    result = { ok: false, reason: e instanceof Error ? e.message : "send failed" };
  }

  if (!result.ok && payload.send_id) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await (supabaseAdmin.rpc as any)("release_parent_guardian_email_claim", {
        p_send_id: payload.send_id,
      });
    } catch {
      console.error("[parent-guardian-email] could not release the failed send");
    }
  }
  return result;
}
