import { importPKCS8, SignJWT } from "jose";

const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";

type RevokeEnv = {
  APPLE_SIGNIN_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
};

function readApplePrivateKeyPem(env: RevokeEnv): string | null {
  const raw = env.APPLE_PRIVATE_KEY?.trim();
  if (!raw) return null;
  return raw.includes("BEGIN PRIVATE KEY") ? raw : raw.replace(/\\n/g, "\n");
}

export function appleSignInRevokeConfigured(env: RevokeEnv): boolean {
  return !!(
    env.APPLE_SIGNIN_CLIENT_ID?.trim() &&
    env.APPLE_TEAM_ID?.trim() &&
    env.APPLE_KEY_ID?.trim() &&
    readApplePrivateKeyPem(env)
  );
}

async function buildAppleClientSecret(env: RevokeEnv): Promise<string> {
  const pem = readApplePrivateKeyPem(env);
  if (!pem || !env.APPLE_SIGNIN_CLIENT_ID || !env.APPLE_TEAM_ID || !env.APPLE_KEY_ID) {
    throw new Error("APPLE_SIGNIN_NOT_CONFIGURED");
  }
  const key = await importPKCS8(pem, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env.APPLE_KEY_ID })
    .setIssuer(env.APPLE_TEAM_ID)
    .setIssuedAt()
    .setExpirationTime("5m")
    .setAudience("https://appleid.apple.com")
    .setSubject(env.APPLE_SIGNIN_CLIENT_ID)
    .sign(key);
}

/**
 * Revokes a native Sign in with Apple authorization code per guideline 5.1.1(v).
 * No-ops when env is missing so account deletion still succeeds in dev.
 */
export async function revokeAppleSignInAuthorizationCode(
  authorizationCode: string | null | undefined,
  env: RevokeEnv = process.env,
): Promise<void> {
  const code = authorizationCode?.trim();
  if (!code || !appleSignInRevokeConfigured(env)) return;

  const clientSecret = await buildAppleClientSecret(env);
  const body = new URLSearchParams({
    client_id: env.APPLE_SIGNIN_CLIENT_ID!.trim(),
    client_secret: clientSecret,
    token: code,
    token_type_hint: "authorization_code",
  });

  const response = await fetch(APPLE_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    console.error("[apple.revoke] non-ok response", response.status);
  }
}