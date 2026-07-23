import {
  clearSetPasswordIntent,
  maskPhoneE164,
  readSetPasswordIntent,
} from "@/lib/auth/authIntent.server";
import {
  fromDbOtpPurpose,
  isPasswordSetupAuthorizationActive,
  readPasswordSetupAuthorization,
} from "@/lib/auth/passwordSetupAuth.server";
import { getRequestBearerUserId } from "@/lib/auth/requestAuth.server";

export async function resolveSetPasswordContextFromCookie() {
  const cookieIntent = readSetPasswordIntent();
  if (!cookieIntent?.authId) {
    return { ok: false as const, redirect: "/login" as const };
  }

  const row = await readPasswordSetupAuthorization(cookieIntent.authId);
  if (!row || !isPasswordSetupAuthorizationActive(row)) {
    clearSetPasswordIntent();
    return { ok: false as const, redirect: "/login" as const };
  }

  const requestUserId = await getRequestBearerUserId();
  if (!requestUserId || requestUserId !== row.user_id) {
    clearSetPasswordIntent();
    return { ok: false as const, redirect: "/login" as const };
  }

  return {
    ok: true as const,
    maskedPhone: maskPhoneE164(row.phone),
    purpose: fromDbOtpPurpose(row.purpose),
    role: row.signup_role ?? undefined,
  };
}
