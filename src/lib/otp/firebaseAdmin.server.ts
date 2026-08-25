import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getAuth, type Auth, type DecodedIdToken } from "firebase-admin/auth";
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
  "invalid_token" | "expired_token" | "missing_phone" | "phone_mismatch";

export type FirebasePhoneTokenVerifyResult =
  | { ok: true; phoneE164: string; decoded: DecodedIdToken }
  | { ok: false; error: FirebasePhoneTokenVerifyError };

export type FirebaseIdTokenVerifier = (idToken: string) => Promise<DecodedIdToken>;

function mapVerifyTokenError(error: unknown): FirebasePhoneTokenVerifyError {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : "";
  if (code.includes("expired")) return "expired_token";
  return "invalid_token";
}

export async function verifyFirebasePhoneIdToken(
  idToken: string,
  expectedPhoneE164: string,
  verifyToken: FirebaseIdTokenVerifier = (token) => getFirebaseAdminAuth().verifyIdToken(token),
): Promise<FirebasePhoneTokenVerifyResult> {
  let decoded: DecodedIdToken;
  try {
    decoded = await verifyToken(idToken);
  } catch (error) {
    return { ok: false, error: mapVerifyTokenError(error) };
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
