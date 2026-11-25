import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getRequestBearerToken, getRequestBearerUserId } from "@/lib/auth/requestAuth.server";
import { sendParentGuardianEmail } from "@/lib/email/parentGuardianEmail.server";

const SendParentGuardianEmailSchema = z.object({
  linkId: z.string().uuid().optional(),
});

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

export const sendParentGuardianEmailFn = createServerFn({ method: "POST" })
  .validator((data) => SendParentGuardianEmailSchema.parse(data))
  .handler(async ({ data }) => {
    const userId = await getRequestBearerUserId();
    if (!userId) {
      return { ok: false as const, reason: "Authentication required" };
    }
    const token = getRequestBearerToken();
    if (!token) {
      return { ok: false as const, reason: "Authentication required" };
    }

    const supabase = createAuthedSupabase(token);
    const { data: claimed, error } = await (supabase.rpc as any)("claim_parent_guardian_email_send", {
      p_link_id: data.linkId ?? null,
    });
    if (error) {
      return { ok: false as const, reason: error.message };
    }
    const payload = claimed as {
      parent_email: string;
      student_name: string;
      flag_token: string;
      deduplicated?: boolean;
    };
    if (payload.deduplicated) {
      return { ok: true as const, deduplicated: true };
    }

    return sendParentGuardianEmail({
      parentEmail: payload.parent_email,
      studentName: payload.student_name,
      flagToken: payload.flag_token,
    });
  });