/**
 * OTP & auth server functions.
 *
 * Signup flow:
 *   sendOtpFn({ phone, purpose: 'signup' }) — errors if phone already registered.
 *   verifyOtpFn({ phone, code, role }) — verifies, creates user, assigns role, signs in.
 *   Client then routes to /auth/set-password, where user sets a real password
 *   via `supabase.auth.updateUser({ password })` (signed-in client call).
 *
 * Returning sign-in:
 *   Pure client-side `supabase.auth.signInWithPassword({ email: authEmailForPhone(phone), password })`.
 *
 * Forgot password:
 *   sendOtpFn({ phone, purpose: 'reset' }) — errors if phone not registered.
 *   verifyOtpFn({ phone, code, purpose: 'reset' }) — verifies, rotates to derived
 *   password, signs user in. Client then forces /auth/set-password.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const SendSchema = z.object({
  phone: z.string().regex(/^\+\d{8,15}$/, "Invalid E.164 phone"),
  purpose: z.enum(["signup", "reset"]),
});
const VerifySchema = z.object({
  phone: z.string().regex(/^\+\d{8,15}$/, "Invalid E.164 phone"),
  code: z.string().regex(/^\d{4,8}$/, "Invalid code"),
  purpose: z.enum(["signup", "reset"]),
  role: z.enum(["customer", "provider"]).optional(),
});

function basicAuth(sid: string, token: string) {
  return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

/** Deterministic synthetic email used as the auth identifier for a phone. */
export function authEmailForPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return `phone-${digits}@famio.local`;
}

async function twilioVerifyFetch(path: string, body: Record<string, string>) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!accountSid || !authToken || !serviceSid) {
    throw new Error("Twilio not configured");
  }
  const url = `https://verify.twilio.com/v2/Services/${serviceSid}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: basicAuth(accountSid, authToken),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

async function findUserIdByPhone(phone: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const authEmail = authEmailForPhone(phone);
  const phoneNoPlus = phone.replace(/^\+/, "");
  // Paginate (admin.listUsers is paginated; scan first ~1000 users).
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find(
      (u) => u.email === authEmail || u.phone === phoneNoPlus || u.phone === phone,
    );
    if (u) return u.id;
    if (data.users.length < 200) break;
  }
  return null;
}

export const sendOtpFn = createServerFn({ method: "POST" })
  .inputValidator((d) => SendSchema.parse(d))
  .handler(async ({ data }) => {
    // ─────────────────────────────────────────────────────────────────────
    // TEMPORARY: OTP disabled during pre-launch validation phase.
    // Re-enable before accepting unmonitored public signups.
    // Phone-number existence is still used to gate signup vs reset, but no
    // SMS is sent and any code is accepted by verifyOtpFn below.
    // ─────────────────────────────────────────────────────────────────────
    const existingId = await findUserIdByPhone(data.phone);
    if (data.purpose === "signup" && existingId) {
      return { ok: false as const, error: "already_registered" };
    }
    if (data.purpose === "reset" && !existingId) {
      return { ok: false as const, error: "no_account" };
    }
    return { ok: true as const, retryAfter: 30 };
  });

export const verifyOtpFn = createServerFn({ method: "POST" })
  .inputValidator((d) => VerifySchema.parse(d))
  .handler(async ({ data }) => {
    // ─────────────────────────────────────────────────────────────────────
    // TEMPORARY: OTP disabled during pre-launch validation phase.
    // Re-enable before accepting unmonitored public signups.
    // We skip the Twilio VerificationCheck entirely and accept any code.
    // ─────────────────────────────────────────────────────────────────────





    // 2) Resolve / create the auth user.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createHmac } = await import("crypto");
    const secret = process.env.OTP_SIGNIN_SECRET;
    if (!secret) throw new Error("OTP_SIGNIN_SECRET missing");
    const derivedPassword = createHmac("sha256", secret).update(data.phone).digest("hex");
    const authEmail = authEmailForPhone(data.phone);

    let userId = await findUserIdByPhone(data.phone);
    let isNewUser = false;

    if (data.purpose === "signup") {
      if (userId) return { ok: false as const, error: "already_registered" as const };
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        phone: data.phone,
        password: derivedPassword,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { phone: data.phone },
      });
      if (error) throw error;
      userId = created.user!.id;
      isNewUser = true;
    } else {
      // reset: rotate password to derived value so we can sign in deterministically.
      if (!userId) return { ok: false as const, error: "no_account" as const };
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        email: authEmail,
        email_confirm: true,
        password: derivedPassword,
        phone_confirm: true,
      });
      if (error) throw error;
    }

    // 3) Assign provider role for provider signups (idempotent).
    if (data.purpose === "signup" && data.role === "provider" && userId) {
      const { error: roleErr } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: userId, role: "provider" }, { onConflict: "user_id,role" });
      if (roleErr) console.error("[otp.verify] role assign error", roleErr);
    }

    // 4) Sign in server-side, return tokens for the client to setSession.
    const { createClient } = await import("@supabase/supabase-js");
    const supa = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data: signed, error: signErr } = await supa.auth.signInWithPassword({
      email: authEmail,
      password: derivedPassword,
    });
    if (signErr || !signed.session) {
      console.error("[otp.verify] sign-in failed", signErr);
      throw new Error(signErr?.message ?? "signin_failed");
    }

    return {
      ok: true as const,
      userId: userId!,
      isNewUser,
      access_token: signed.session.access_token,
      refresh_token: signed.session.refresh_token,
    };
  });
