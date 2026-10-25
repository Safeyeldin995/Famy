import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getAuth, type Auth, type DecodedIdToken } from "firebase-admin/auth";
import { OTP_PENDING_TTL_SECONDS } from "@/lib/auth/authIntent.constants";
import { isValidE164Phone, normalizePhoneE164 } from "./normalizePhone";

export type FirebaseAdminConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

export class FirebaseAdminConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirebaseAdminConfigurationError";
  }
}

export function readFirebaseAdminConfig(env: NodeJS.ProcessEnv = process.env): FirebaseAdminConfig {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKeyRaw = env.FIREBASE_PRIVATE_KEY?.trim();

  if (!projectId) {
    throw new FirebaseAdminConfigurationError("FIREBASE_PROJECT_ID is not configured");
  }
  if (!clientEmail) {
    throw new FirebaseAdminConfigurationError("FIREBASE_CLIENT_EMAIL is not configured");
  }
  if (!privateKeyRaw) {
    throw new FirebaseAdminConfigurationError("FIREBASE_PRIVATE_KEY is not configured");
  }

  return {
    projectId,
    clientEmail,
    privateKey: privateKeyRaw.replace(/\\n/g, "\n"),
  };
}

let cachedAuth: Auth | undefined;

export function getFirebaseAdminAuth(config = readFirebaseAdminConfig()): Auth {
  if (cachedAuth) return cachedAuth;

  let app: App;
  if (getApps().length > 0) {
    app = getApps()[0]!;
  } else {
    app = initializeApp({
      credential: cert({
        projectId: config.projectId,
        clientEmail: config.clientEmail,
        privateKey: config.privateKey,
      }),
    });
  }

  cachedAuth = getAuth(app);
  return cachedAuth;
}

export function resetFirebaseAdminAuthForTests(): void {
  cachedAuth = undefined;
}

export type FirebasePhoneTokenVerifyError =
  | "invalid_token"
  | "expired_token"
  | "missing_phone"
  | "phone_mismatch";

export type FirebasePhoneTokenVerifyResult =
  | { ok: true; phoneE164: string; decoded: DecodedIdToken }
  | { ok: false; error: FirebasePhoneTokenVerifyError };

export type FirebaseIdTokenVerifier = (idToken: string) => Promise<DecodedIdToken>;

export type VerifyFirebasePhoneIdTokenOptions = {
  verifyToken?: FirebaseIdTokenVerifier;
  /** Earliest allowed Firebase `auth_time` (unix seconds), e.g. OTP intent start. */
  minAuthTimeSec?: number;
  nowSec?: number;
  clockSkewSec?: number;
};

const DEFAULT_CLOCK_SKEW_SEC = 60;

function mapVerifyTokenError(error: unknown): FirebasePhoneTokenVerifyError {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : "";
  if (code.includes("expired")) return "expired_token";
  return "invalid_token";
}

function isAuthTimeFreshForOtpIntent(
  decoded: DecodedIdToken,
  options: VerifyFirebasePhoneIdTokenOptions,
): boolean {
  const authTime = decoded.auth_time;
  if (typeof authTime !== "number" || !Number.isFinite(authTime)) {
    return false;
  }
  const now = options.nowSec ?? Math.floor(Date.now() / 1000);
  const skew = options.clockSkewSec ?? DEFAULT_CLOCK_SKEW_SEC;
  const minAuth = options.minAuthTimeSec;
  if (minAuth !== undefined && authTime < minAuth - skew) {
    return false;
  }
  return authTime >= now - OTP_PENDING_TTL_SECONDS - skew;
}

export async function verifyFirebasePhoneIdToken(
  idToken: string,
  expectedPhoneE164: string,
  verifyTokenOrOptions?: FirebaseIdTokenVerifier | VerifyFirebasePhoneIdTokenOptions,
): Promise<FirebasePhoneTokenVerifyResult> {
  const options: VerifyFirebasePhoneIdTokenOptions =
    typeof verifyTokenOrOptions === "function"
      ? { verifyToken: verifyTokenOrOptions }
      : (verifyTokenOrOptions ?? {});

  const verifyToken =
    options.verifyToken ?? ((token) => getFirebaseAdminAuth().verifyIdToken(token, true));

  let decoded: DecodedIdToken;
  try {
    decoded = await verifyToken(idToken);
  } catch (error) {
    return { ok: false, error: mapVerifyTokenError(error) };
  }

  if (!isAuthTimeFreshForOtpIntent(decoded, options)) {
    return { ok: false, error: "expired_token" };
  }

  if (!decoded.phone_number) {
    return { ok: false, error: "missing_phone" };
  }

  const tokenPhone = normalizePhoneE164(decoded.phone_number);
  const expectedPhone = normalizePhoneE164(expectedPhoneE164);

  if (!isValidE164Phone(tokenPhone) || !isValidE164Phone(expectedPhone)) {
    return { ok: false, error: "phone_mismatch" };
  }

  if (tokenPhone !== expectedPhone) {
    return { ok: false, error: "phone_mismatch" };
  }

  return { ok: true, phoneE164: tokenPhone, decoded };
}
