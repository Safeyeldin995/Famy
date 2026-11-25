import type { PaymobCheckoutChannel } from "./paymobChannels";

export const PAYMOB_EGYPT_BASE_URL = "https://accept.paymob.com";

export type PaymobConfig = {
  secretKey: string;
  publicKey: string;
  hmacSecret: string;
  integrationId: number;
  baseUrl: string;
  notificationUrl: string;
  appOrigin: string;
};

export class PaymobConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymobConfigurationError";
  }
}

function resolveNotificationUrl(env: NodeJS.ProcessEnv): string | null {
  const explicit = env.PAYMOB_NOTIFICATION_URL?.trim();
  if (explicit) return explicit;
  const supabaseUrl = env.SUPABASE_URL?.trim();
  if (!supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/paymob-webhook`;
}

function assertSecureNotificationUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PaymobConfigurationError("PAYMOB_NOTIFICATION_URL is not a valid URL");
  }
  const isLocalHttp =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (parsed.protocol !== "https:" && !isLocalHttp) {
    throw new PaymobConfigurationError(
      "PAYMOB_NOTIFICATION_URL must use https (plaintext http is only allowed for localhost)",
    );
  }
}

function resolveAppOrigin(env: NodeJS.ProcessEnv): string {
  const candidates = [env.FAMY_QA_APP_ORIGIN, env.FAMY_PRODUCTION_APP_ORIGIN, env.VITE_APP_ORIGIN];
  // On Vercel, fall back to this deployment's own address (Production uses the production
  // domain). Without it Paymob would send paying customers back to localhost.
  const vercelHost =
    env.VERCEL_ENV === "production" ? env.VERCEL_PROJECT_PRODUCTION_URL : env.VERCEL_URL;
  if (vercelHost?.trim())
    candidates.push(`https://${vercelHost.trim().replace(/^https?:\/\//, "")}`);
  const origin = candidates.map((c) => c?.trim()).find((c) => !!c) ?? "http://localhost:8099";
  return origin.replace(/\/$/, "");
}

export function readPaymobConfig(env: NodeJS.ProcessEnv = process.env): PaymobConfig {
  const secretKey = env.PAYMOB_SECRET_KEY?.trim();
  const publicKey = env.PAYMOB_PUBLIC_KEY?.trim();
  const hmacSecret = env.PAYMOB_HMAC_SECRET?.trim();
  const integrationRaw = env.PAYMOB_INTEGRATION_ID?.trim();
  const notificationUrl = resolveNotificationUrl(env);

  if (!secretKey) throw new PaymobConfigurationError("PAYMOB_SECRET_KEY is not configured");
  if (!publicKey) throw new PaymobConfigurationError("PAYMOB_PUBLIC_KEY is not configured");
  if (!hmacSecret) throw new PaymobConfigurationError("PAYMOB_HMAC_SECRET is not configured");
  if (!integrationRaw || !/^\d+$/.test(integrationRaw)) {
    throw new PaymobConfigurationError("PAYMOB_INTEGRATION_ID is not configured");
  }
  if (!notificationUrl) {
    throw new PaymobConfigurationError("PAYMOB_NOTIFICATION_URL or SUPABASE_URL is not configured");
  }
  assertSecureNotificationUrl(notificationUrl);

  return {
    secretKey,
    publicKey,
    hmacSecret,
    integrationId: Number(integrationRaw),
    baseUrl: PAYMOB_EGYPT_BASE_URL,
    notificationUrl,
    appOrigin: resolveAppOrigin(env),
  };
}

export function isPaymobConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    readPaymobConfig(env);
    return true;
  } catch {
    return false;
  }
}

function readOptionalIntegrationId(
  env: NodeJS.ProcessEnv,
  key: "PAYMOB_APPLE_PAY_INTEGRATION_ID" | "PAYMOB_GOOGLE_PAY_INTEGRATION_ID",
): number | null {
  const raw = env[key]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

export function isPaymobApplePayConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readOptionalIntegrationId(env, "PAYMOB_APPLE_PAY_INTEGRATION_ID") != null;
}

export function isPaymobGooglePayConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readOptionalIntegrationId(env, "PAYMOB_GOOGLE_PAY_INTEGRATION_ID") != null;
}

export type PaymobWalletCapabilities = {
  applePay: boolean;
  googlePay: boolean;
};

export function readPaymobWalletCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): PaymobWalletCapabilities {
  return {
    applePay: isPaymobApplePayConfigured(env),
    googlePay: isPaymobGooglePayConfigured(env),
  };
}

export function readOptionalPaymobIntegrationIdForChannel(channel: PaymobCheckoutChannel): number {
  const env = process.env;
  const card = readPaymobConfig(env);
  if (channel === "card") return card.integrationId;
  if (channel === "apple_pay") {
    const id = readOptionalIntegrationId(env, "PAYMOB_APPLE_PAY_INTEGRATION_ID");
    if (id == null) {
      throw new PaymobConfigurationError("PAYMOB_APPLE_PAY_INTEGRATION_ID is not configured");
    }
    return id;
  }
  const id = readOptionalIntegrationId(env, "PAYMOB_GOOGLE_PAY_INTEGRATION_ID");
  if (id == null) {
    throw new PaymobConfigurationError("PAYMOB_GOOGLE_PAY_INTEGRATION_ID is not configured");
  }
  return id;
}

export function buildPaymobUnifiedCheckoutUrl(
  publicKey: string,
  clientSecret: string,
  baseUrl = PAYMOB_EGYPT_BASE_URL,
): string {
  const url = new URL("/unifiedcheckout/", baseUrl);
  url.searchParams.set("publicKey", publicKey);
  url.searchParams.set("clientSecret", clientSecret);
  return url.toString();
}

export function buildPaymobBookingReturnUrl(appOrigin: string, bookingId: string): string {
  const url = new URL(`/booking/${bookingId}`, appOrigin);
  url.searchParams.set("paymob_return", "1");
  return url.toString();
}

export function buildPaymobOnlineWebLessonReturnUrl(appOrigin: string, bookingId: string): string {
  const url = new URL(`/online/lessons/${bookingId}`, appOrigin);
  url.searchParams.set("paymob_return", "1");
  return url.toString();
}
