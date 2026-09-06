/**
 * OTP & auth server functions.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import {
  clearOtpPendingIntent,
  clearSetPasswordIntent,
  maskPhoneE164,
  readOtpPendingIntent,
  readSetPasswordIntent,
  setOtpPendingIntent,
  setSetPasswordIntent,
} from "@/lib/auth/authIntent.server";
import {
  claimPasswordSetupAuthorization,
  createPasswordSetupAuthorization,
  fromDbOtpPurpose,
  isPasswordSetupAuthorizationActive,
  readPasswordSetupAuthorization,
} from "@/lib/auth/passwordSetupAuth.server";
import { getRequestBearerUserId } from "@/lib/auth/requestAuth.server";
import { buildPasswordSetupRestartRequired } from "@/lib/auth/passwordSetupRecovery.server";
import { resolveSetPasswordContextFromCookie } from "@/lib/auth/passwordSetupContext.server";
import { authEmailForPhone } from "@/lib/auth/authEmail";
import { logPasswordSetupSession } from "@/lib/auth/passwordSetupSessionLog.server";
import type { OtpScreenContext, SetPasswordContext } from "@/lib/auth/authIntent.types";
import { isValidE164Phone, normalizePhoneE164 } from "@/lib/otp/normalizePhone";
import { toDbOtpPurpose } from "@/lib/otp/types";

const SendSchema = z.object({
  phone: z.string().min(1),
  purpose: z.enum(["signup", "reset"]),
  role: z.enum(["customer", "provider"]).optional(),
});
const VerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Invalid code"),
});
const VerifyFirebaseSchema = z.object({
  idToken: z.string().min(20),
});
const PasswordSchema = z.object({
  password: z.string().min(8),
});

function parseCanonicalPhone(raw: string): string {
  const phone = normalizePhoneE164(raw);
  if (!isValidE164Phone(phone)) {
    throw new Error("Invalid E.164 phone");
  }
  return phone;
}

function requestMeta() {
  const request = getRequest();
  const ipAddress =
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-vercel-forwarded-for")?.split(",").pop()?.trim() ??
    null;
  const userAgent = request.headers.get("user-agent");
  return { ipAddress, userAgent };
}

function authErrorCode(error: unknown): string {
  if (typeof error === "object" && error) {
    const record = error as { code?: string; status?: string | number };
    return String(record.code ?? record.status ?? "unknown");
  }
  return "unknown";
}

async function findUserIdByPhone(phone: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const authEmail = authEmailForPhone(phone);
  const phoneNoPlus = phone.replace(/^\+/, "");
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      console.error("[otp.verify.completeAuth]", {
        stage: "list_users",
        errorCode: authErrorCode(error),
      });
      throw error;
    }
    const u = data.users.find(
      (u) => u.email === authEmail || u.phone === phoneNoPlus || u.phone === phone,
    );
    if (u) return u.id;
    if (data.users.length < 200) break;
  }
  return null;
}

type VerifiedAuthInput = {
  phone: string;
  purpose: "signup" | "reset";
  role?: "customer" | "provider";
};

async function completeVerifiedAuth(data: VerifiedAuthInput) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { randomBytes } = await import("crypto");
    const interimPassword = randomBytes(32).toString("base64url");
    const authEmail = authEmailForPhone(data.phone);

    let userId = await findUserIdByPhone(data.phone);
    let isNewUser = false;

    if (data.purpose === "signup") {
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        phone: data.phone,
        password: interimPassword,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { phone: data.phone, signup_role: data.role ?? "customer" },
      });
      if (error) {
        console.error("[otp.verify.completeAuth]", {
          stage: "create_or_update_user",
          isSignup: data.purpose === "signup",
          errorCode: authErrorCode(error),
        });
        throw error;
      }
      userId = created.user!.id;
      isNewUser = true;
    } else {
      if (!userId) throw new Error("verified_reset_missing_user");
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        email: authEmail,
        email_confirm: true,
        password: interimPassword,
        phone_confirm: true,
      });
      if (error) {
        console.error("[otp.verify.completeAuth]", {
          stage: "create_or_update_user",
          isSignup: data.purpose === "signup",
          errorCode: authErrorCode(error),
        });
        throw error;
      }
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
        console.error("[otp.verify.completeAuth]", {
          stage: "role_assignment_check",
          roleErrPresent: !!roleErr,
          normalRolesCount: normalRoles.length,
          expectedRole,
          gotRole: normalRoles[0] ?? "none",
        });
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
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "Error";
    const message =
      error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120);
    console.error("[otp.verify.completeAuth]", { stage: "unexpected", errorName, message });
    throw error;
  }
}

function mapVerifyError(error: string) {
  if (error === "expired") return { ok: false as const, error: "invalid_code" as const };
  if (error === "max_attempts") return { ok: false as const, error: "invalid_code" as const };
  if (error === "invalid_code" || error === "not_found" || error === "already_used") {
    return { ok: false as const, error: "invalid_code" as const };
  }
  return { ok: false as const, error: "invalid_code" as const };
}

async function finalizeOtpVerification(pending: {
  phone: string;
  purpose: "signup" | "reset";
  role?: "customer" | "provider";
}) {
  const existingUserId = await findUserIdByPhone(pending.phone);
  if (pending.purpose === "signup" && existingUserId) {
    clearOtpPendingIntent();
    return { ok: false as const, error: "flow_mismatch" as const, nextStep: "signin" as const };
  }
  if (pending.purpose === "reset" && !existingUserId) {
    clearOtpPendingIntent();
    return { ok: false as const, error: "flow_mismatch" as const, nextStep: "signup" as const };
  }

  const authResult = await completeVerifiedAuth({
    phone: pending.phone,
    purpose: pending.purpose,
    role: pending.role,
  });

  const authId = await createPasswordSetupAuthorization({
    userId: authResult.userId,
    phone: pending.phone,
    purpose: toDbOtpPurpose(pending.purpose),
    role: pending.role,
  });

  clearOtpPendingIntent();
  setSetPasswordIntent({ authId });

  logPasswordSetupSession("after-verify-otp", {
    userId: authResult.userId,
    hasInterimSession: true,
  });

  return authResult;
}

function intentRedirectForPurpose(purpose: "signup" | "reset"): "/login" | "/auth/forgot" {
  return purpose === "reset" ? "/auth/forgot" : "/login";
}

function sanitizePasswordUpdateError(error: unknown): string {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code ?? "unknown")
      : "unknown";
  console.error("[password.setup] update failed", { code });
  return code;
}

async function verifyPasswordSignIn(
  userId: string,
  authEmail: string,
  password: string,
): Promise<boolean> {
  const { createClient } = await import("@supabase/supabase-js");
  const supa = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data: signed, error } = await supa.auth.signInWithPassword({
    email: authEmail,
    password,
  });
  if (error || !signed.session || signed.user?.id !== userId) {
    logPasswordSetupSession("server-signin-verify-failed", {
      userId,
      code: error?.code ?? (signed.user ? "user_mismatch" : "no_session"),
    });
    return false;
  }
  logPasswordSetupSession("server-signin-verify-ok", { userId });
  // Ephemeral server client (no storage/persistSession). signOut clears only this
  // in-memory session and cannot invalidate the browser's separate client session.
  await supa.auth.signOut();
  return true;
}

export const getOtpScreenContextFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<OtpScreenContext> => {
    const pending = readOtpPendingIntent();
    if (!pending) {
      return { ok: false, redirect: "/login" };
    }

    const now = Math.floor(Date.now() / 1000);
    if (pending.otpExp <= now) {
      clearOtpPendingIntent();
      return { ok: false, redirect: intentRedirectForPurpose(pending.purpose) };
    }

    const { resolveOtpProviderKind } = await import("@/lib/otp/otpProviderKind.server");
    const delivery = resolveOtpProviderKind() === "firebase" ? "firebase" : "server";

    return {
      ok: true,
      maskedPhone: maskPhoneE164(pending.phone),
      purpose: pending.purpose,
      role: pending.role,
      otpExpiresIn: Math.max(0, pending.otpExp - now),
      resendAvailableIn: Math.max(0, pending.resendAt - now),
      delivery,
    };
  },
);

export const getSetPasswordContextFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<SetPasswordContext> => {
    return resolveSetPasswordContextFromCookie();
  },
);

async function prepareFirebaseOtpIntent(params: {
  phone: string;
  purpose: "signup" | "reset";
  role?: "customer" | "provider";
}) {
  const phone = parseCanonicalPhone(params.phone);
  setOtpPendingIntent({
    phone,
    purpose: params.purpose,
    role: params.purpose === "signup" ? params.role : undefined,
    retryAfterSeconds: 30,
  });
  clearSetPasswordIntent();
  return {
    ok: true as const,
    retryAfter: 30,
    requiresVerification: true as const,
  };
}

async function issueOtpSend(params: {
  phone: string;
  purpose: "signup" | "reset";
  role?: "customer" | "provider";
}) {
  const phone = parseCanonicalPhone(params.phone);

  const { loadOtpCoreService } = await import("@/lib/otp/OtpCoreService.server");
  const otp = await loadOtpCoreService();
  const { ipAddress, userAgent } = requestMeta();
  const generated = await otp.generateOTP({
    phone,
    purpose: toDbOtpPurpose(params.purpose),
    ipAddress,
    userAgent,
  });

  if (!generated.ok) {
    const deliveryMessage =
      generated.error === "delivery_failed"
        ? "Could not deliver the verification code. Try again later."
        : generated.error === "temporarily_unavailable"
          ? "Verification delivery is temporarily unavailable. Try again shortly."
          : "Too many verification requests. Try again later.";
    return {
      ok: false as const,
      error: generated.error,
      retryAfter: generated.retryAfter,
      message: deliveryMessage,
    };
  }

  setOtpPendingIntent({
    phone,
    purpose: params.purpose,
    role: params.purpose === "signup" ? params.role : undefined,
    retryAfterSeconds: generated.retryAfter ?? 30,
  });
  clearSetPasswordIntent();

  return {
    ok: true as const,
    retryAfter: generated.retryAfter ?? 30,
    requiresVerification: true as const,
  };
}

export const sendOtpFn = createServerFn({ method: "POST" })
  .inputValidator((d) => SendSchema.parse(d))
  .handler(async ({ data }) => {
    const { isFirebaseOtpProvider } = await import("@/lib/otp/otpProviderKind.server");
    if (isFirebaseOtpProvider()) {
      return {
        ok: false as const,
        error: "provider_mismatch" as const,
        message: "Use the Firebase phone verification flow for this environment.",
      };
    }
    return issueOtpSend(data);
  });

export const beginFirebaseOtpFn = createServerFn({ method: "POST" })
  .inputValidator((d) => SendSchema.parse(d))
  .handler(async ({ data }) => {
    const {
      classifyFirebaseOtpBeginError,
      isAuthIntentSecretConfigured,
      logFirebaseOtpBeginFailure,
      maskPhoneSuffix,
    } = await import("@/lib/otp/firebaseOtpDiagnostics.server");
    const { getOtpProviderConfigurationStatus } = await import("@/lib/otp/otpProviderKind.server");

    const phoneSuffix = maskPhoneSuffix(data.phone);
    const providerStatus = getOtpProviderConfigurationStatus();
    const configuredOtpProvider = providerStatus.ok ? providerStatus.kind : providerStatus.configured;

    if (!providerStatus.ok || providerStatus.kind !== "firebase") {
      logFirebaseOtpBeginFailure({
        reason: "provider_mismatch",
        configuredOtpProvider,
        authIntentSecretConfigured: isAuthIntentSecretConfigured(),
        phoneSuffix,
      });
      return {
        ok: false as const,
        error: "provider_mismatch" as const,
        message: "Firebase OTP is not active in this environment.",
      };
    }

    try {
      return await prepareFirebaseOtpIntent(data);
    } catch (error) {
      const classified = classifyFirebaseOtpBeginError(error);
      logFirebaseOtpBeginFailure({
        reason: classified.reason,
        configuredOtpProvider,
        authIntentSecretConfigured: isAuthIntentSecretConfigured(),
        phoneSuffix,
        errorName: classified.errorName,
        errorCode: classified.errorCode,
        errorMessage: classified.errorMessage,
      });
      return {
        ok: false as const,
        error: classified.reason,
        message: "Could not start phone verification. Try again.",
      };
    }
  });

export const resendOtpFn = createServerFn({ method: "POST" }).handler(async () => {
  const pending = readOtpPendingIntent();
  if (!pending) {
    return {
      ok: false as const,
      error: "intent_missing" as const,
      message: "Verification session expired. Start again.",
    };
  }

  const now = Math.floor(Date.now() / 1000);
  if (pending.resendAt > now) {
    return {
      ok: false as const,
      error: "rate_limited" as const,
      retryAfter: pending.resendAt - now,
      message: "Please wait before requesting another code.",
    };
  }

  const { isFirebaseOtpProvider } = await import("@/lib/otp/otpProviderKind.server");
  if (isFirebaseOtpProvider()) {
    return prepareFirebaseOtpIntent({
      phone: pending.phone,
      purpose: pending.purpose,
      role: pending.role,
    });
  }

  return issueOtpSend({
    phone: pending.phone,
    purpose: pending.purpose,
    role: pending.role,
  });
});

export const verifyOtpFn = createServerFn({ method: "POST" })
  .inputValidator((d) => VerifySchema.parse(d))
  .handler(async ({ data }) => {
    const pending = readOtpPendingIntent();
    if (!pending) {
      return { ok: false as const, error: "invalid_code" as const };
    }

    const now = Math.floor(Date.now() / 1000);
    if (pending.otpExp <= now) {
      clearOtpPendingIntent();
      return { ok: false as const, error: "invalid_code" as const };
    }

    const { loadOtpCoreService } = await import("@/lib/otp/OtpCoreService.server");
    const otp = await loadOtpCoreService();
    const verified = await otp.verifyOTP({
      phone: pending.phone,
      purpose: toDbOtpPurpose(pending.purpose),
      code: data.code,
    });
    if (!verified.ok) return mapVerifyError(verified.error);

    return finalizeOtpVerification(pending);
  });

export const verifyFirebaseOtpFn = createServerFn({ method: "POST" })
  .inputValidator((d) => VerifyFirebaseSchema.parse(d))
  .handler(async ({ data }) => {
    const { isFirebaseOtpProvider } = await import("@/lib/otp/otpProviderKind.server");
    if (!isFirebaseOtpProvider()) {
      return { ok: false as const, error: "invalid_code" as const };
    }

    const pending = readOtpPendingIntent();
    if (!pending) {
      return { ok: false as const, error: "invalid_code" as const };
    }

    const now = Math.floor(Date.now() / 1000);
    if (pending.otpExp <= now) {
      clearOtpPendingIntent();
      return { ok: false as const, error: "invalid_code" as const };
    }

    const { verifyFirebasePhoneIdToken } = await import("@/lib/otp/firebaseAdmin.server");
    let verified;
    try {
      verified = await verifyFirebasePhoneIdToken(data.idToken, pending.phone);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "Error";
      const message =
        error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120);
      console.error("[otp.firebase.verify.server]", {
        outcome: "failure",
        reason: "verify_threw",
        errorName,
        message,
      });
      return { ok: false as const, error: "invalid_code" as const };
    }
    if (!verified.ok) {
      console.error("[otp.firebase.verify.server]", {
        outcome: "failure",
        reason: verified.error,
      });
      return { ok: false as const, error: "invalid_code" as const };
    }

    return finalizeOtpVerification(pending);
  });

export const completePasswordSetupFn = createServerFn({ method: "POST" })
  .inputValidator((d) => PasswordSchema.parse(d))
  .handler(async ({ data }) => {
    const cookieIntent = readSetPasswordIntent();
    if (!cookieIntent?.authId) {
      return {
        ok: false as const,
        error: "authorization_missing" as const,
        message: "Could not set password. Try again.",
      };
    }

    const requestUserId = await getRequestBearerUserId();
    logPasswordSetupSession("before-complete", {
      userId: requestUserId,
      hasBearer: !!requestUserId,
      authId: cookieIntent.authId,
    });
    if (!requestUserId) {
      clearSetPasswordIntent();
      return {
        ok: false as const,
        error: "authorization_missing" as const,
        message: "Could not set password. Try again.",
      };
    }

    const row = await readPasswordSetupAuthorization(cookieIntent.authId);
    if (!row || !isPasswordSetupAuthorizationActive(row) || row.user_id !== requestUserId) {
      clearSetPasswordIntent();
      return {
        ok: false as const,
        error: "authorization_missing" as const,
        message: "Could not set password. Try again.",
      };
    }

    const claimed = await claimPasswordSetupAuthorization({
      authId: cookieIntent.authId,
      userId: requestUserId,
      phone: row.phone,
      purpose: row.purpose,
    });

    if (claimed !== "ok") {
      clearSetPasswordIntent();
      return {
        ok: false as const,
        error: "authorization_missing" as const,
        message: "Could not set password. Try again.",
      };
    }

    const purpose = fromDbOtpPurpose(row.purpose);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(requestUserId, {
      password: data.password,
    });

    clearSetPasswordIntent();

    if (error) {
      sanitizePasswordUpdateError(error);
      return buildPasswordSetupRestartRequired(purpose);
    }

    logPasswordSetupSession("after-password-update", {
      userId: requestUserId,
      updated: true,
    });

    const authEmail = authEmailForPhone(row.phone);
    const signInVerified = await verifyPasswordSignIn(requestUserId, authEmail, data.password);
    if (!signInVerified) {
      return {
        ok: false as const,
        error: "sign_in_required" as const,
        message: "Password saved. Please sign in with your new password.",
        passwordUpdated: true as const,
      };
    }

    return {
      ok: true as const,
      userId: requestUserId,
      authEmail,
      purpose: fromDbOtpPurpose(row.purpose),
      role: row.signup_role ?? undefined,
    };
  });

export const abandonOtpFlowFn = createServerFn({ method: "POST" }).handler(async () => {
  clearOtpPendingIntent();
  clearSetPasswordIntent();
  return { ok: true as const };
});
