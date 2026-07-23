/**
 * OTP & auth server functions.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { isValidE164Phone, normalizePhoneE164 } from "@/lib/otp/normalizePhone";
import { toDbOtpPurpose } from "@/lib/otp/types";

const SendSchema = z.object({
  phone: z.string().min(1),
  purpose: z.enum(["signup", "reset"]),
});
const VerifySchema = z.object({
  phone: z.string().min(1),
  code: z.string().regex(/^\d{4,8}$/, "Invalid code"),
  purpose: z.enum(["signup", "reset"]),
  role: z.enum(["customer", "provider"]).optional(),
});

function parseCanonicalPhone(raw: string): string {
  const phone = normalizePhoneE164(raw);
  if (!isValidE164Phone(phone)) {
    throw new Error("Invalid E.164 phone");
  }
  return phone;
}

/** Deterministic synthetic email used as the auth identifier for a phone. */
export function authEmailForPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return `phone-${digits}@famio.local`;
}

function requestMeta() {
  const request = getRequest();
  const ipAddress = request.headers.get("x-real-ip")
    ?? request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-vercel-forwarded-for")?.split(",").pop()?.trim()
    ?? null;
  const userAgent = request.headers.get("user-agent");
  return { ipAddress, userAgent };
}

async function findUserIdByPhone(phone: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const authEmail = authEmailForPhone(phone);
  const phoneNoPlus = phone.replace(/^\+/, "");
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

type VerifyAuthInput = z.infer<typeof VerifySchema> & { phone: string };

async function completeVerifiedAuth(data: VerifyAuthInput) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { randomBytes } = await import("crypto");
  const interimPassword = randomBytes(32).toString("base64url");
  const authEmail = authEmailForPhone(data.phone);

  let userId = await findUserIdByPhone(data.phone);
  let isNewUser = false;

  if (data.purpose === "signup") {
    if (userId) return { ok: false as const, error: "already_registered" as const };
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: authEmail,
      phone: data.phone,
      password: interimPassword,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { phone: data.phone, signup_role: data.role ?? "customer" },
    });
    if (error) throw error;
    userId = created.user!.id;
    isNewUser = true;
  } else {
    if (!userId) return { ok: false as const, error: "no_account" as const };
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      email: authEmail,
      email_confirm: true,
      password: interimPassword,
      phone_confirm: true,
    });
    if (error) throw error;
  }

  if (data.purpose === "signup" && userId) {
    const expectedRole = data.role ?? "customer";
    const { data: assignedRoles, error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const normalRoles = (assignedRoles ?? [])
      .map((row) => row.role)
      .filter((role) => role === "customer" || role === "provider");
    if (roleErr || normalRoles.length !== 1 || normalRoles[0] !== expectedRole) {
      if (isNewUser) await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(roleErr?.message ?? "signup_identity_assignment_failed");
    }
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supa = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data: signed, error: signErr } = await supa.auth.signInWithPassword({
    email: authEmail,
    password: interimPassword,
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
}

function mapVerifyError(error: string) {
  if (error === "expired") return { ok: false as const, error: "expired" as const };
  if (error === "max_attempts") return { ok: false as const, error: "max_attempts" as const };
  if (error === "invalid_code" || error === "not_found" || error === "already_used") {
    return { ok: false as const, error: "invalid_code" as const };
  }
  return { ok: false as const, error: "unknown" as const };
}

export const sendOtpFn = createServerFn({ method: "POST" })
  .inputValidator((d) => SendSchema.parse(d))
  .handler(async ({ data }) => {
    const phone = parseCanonicalPhone(data.phone);
    const existingId = await findUserIdByPhone(phone);
    if (data.purpose === "signup" && existingId) {
      return { ok: false as const, error: "already_registered" };
    }
    if (data.purpose === "reset" && !existingId) {
      return { ok: false as const, error: "no_account" };
    }

    const { loadOtpCoreService } = await import("@/lib/otp/OtpCoreService.server");
    const otp = await loadOtpCoreService();
    const { ipAddress, userAgent } = requestMeta();
    const generated = await otp.generateOTP({
      phone,
      purpose: toDbOtpPurpose(data.purpose),
      ipAddress,
      userAgent,
    });

    if (!generated.ok) {
      const deliveryMessage = generated.error === "delivery_failed"
        ? "Could not deliver the verification code. Try again later."
        : generated.error === "temporarily_unavailable"
          ? "Verification delivery is temporarily unavailable. Try again shortly."
          : generated.error === "rate_limited_phone"
            ? "Too many verification requests for this phone. Try again later."
            : "Too many verification requests from this network. Try again later.";
      return {
        ok: false as const,
        error: generated.error,
        retryAfter: generated.retryAfter,
        message: deliveryMessage,
      };
    }

    return {
      ok: true as const,
      retryAfter: generated.retryAfter ?? 30,
      requiresVerification: true as const,
    };
  });

export const verifyOtpFn = createServerFn({ method: "POST" })
  .inputValidator((d) => VerifySchema.parse(d))
  .handler(async ({ data }) => {
    const phone = parseCanonicalPhone(data.phone);
    const { loadOtpCoreService } = await import("@/lib/otp/OtpCoreService.server");
    const otp = await loadOtpCoreService();
    const verified = await otp.verifyOTP({
      phone,
      purpose: toDbOtpPurpose(data.purpose),
      code: data.code,
    });
    if (!verified.ok) return mapVerifyError(verified.error);
    return completeVerifiedAuth({ ...data, phone });
  });
