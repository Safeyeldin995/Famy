function hostFromUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    return new URL(raw.trim()).origin;
  } catch {
    return null;
  }
}

function hostFromDsn(dsn: string | undefined): string | null {
  if (!dsn?.trim()) return null;
  try {
    return new URL(dsn.trim()).origin;
  } catch {
    return null;
  }
}

function uniqueSources(sources: Array<string | null | undefined>): string[] {
  return [...new Set(sources.filter((s): s is string => Boolean(s)))];
}

function warnMissingCspOrigin(label: string, envKeys: string[]): void {
  console.warn(
    `[csp] Missing ${label} URL (${envKeys.join(" or ")}); connect-src/img-src may block ${label}.`,
  );
}

/** Firebase phone auth + reCAPTCHA hosts derived from client Firebase config when set. */
function firebaseCspSources(env: NodeJS.ProcessEnv): {
  scriptSrc: string[];
  frameSrc: string[];
  connectSrc: string[];
} {
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN?.trim();
  const authFrame = authDomain ? `https://${authDomain.replace(/^https?:\/\//, "")}` : null;

  return {
    scriptSrc: uniqueSources([
      "https://www.google.com",
      "https://www.gstatic.com",
      "https://apis.google.com",
    ]),
    frameSrc: uniqueSources([
      "https://www.google.com",
      "https://recaptcha.google.com",
      authFrame,
    ]),
    connectSrc: uniqueSources([
      "https://identitytoolkit.googleapis.com",
      "https://securetoken.googleapis.com",
      "https://www.google.com",
    ]),
  };
}

/**
 * LiveKit Cloud connects to regional edge hosts (e.g. wss://<project>.<region>.production.livekit.cloud),
 * not only the configured project URL, so allow the livekit.cloud subdomains when the project is hosted there.
 */
function liveKitCspSources(liveKit: string | null): string[] {
  if (!liveKit) return [];
  const https = liveKit.replace(/^wss:/, "https:");
  const wss = liveKit.replace(/^https:/, "wss:");
  const sources = [https, wss];
  try {
    if (new URL(https).hostname.endsWith(".livekit.cloud")) {
      sources.push("https://*.livekit.cloud", "wss://*.livekit.cloud");
    }
  } catch {
    // ignore malformed URL; the configured origin is still allowed
  }
  return sources;
}

/** Google Maps JavaScript API (address picker, admin zone map) script, tiles, fonts and API calls. */
const GOOGLE_MAPS_SCRIPT_SRC = ["https://maps.googleapis.com", "https://maps.gstatic.com"];
const GOOGLE_MAPS_IMG_SRC = [
  "https://*.googleapis.com",
  "https://*.gstatic.com",
  "https://*.google.com",
  "https://*.googleusercontent.com",
];
const GOOGLE_MAPS_CONNECT_SRC = ["https://maps.googleapis.com", "https://*.googleapis.com"];

/** Build HTML document CSP for the web app (admin + /online + marketing). */
export function buildContentSecurityPolicy(env: NodeJS.ProcessEnv = process.env): string {
  const supabase = hostFromUrl(env.VITE_SUPABASE_URL ?? env.SUPABASE_URL);
  if (!supabase) {
    warnMissingCspOrigin("Supabase", ["VITE_SUPABASE_URL", "SUPABASE_URL"]);
  }

  const liveKit = hostFromUrl(env.LIVEKIT_URL);
  if (!liveKit) {
    warnMissingCspOrigin("LiveKit", ["LIVEKIT_URL"]);
  }

  const sentry = hostFromDsn(env.VITE_SENTRY_DSN ?? env.SENTRY_DSN);
  const firebase = firebaseCspSources(env);

  const connectSrc = uniqueSources([
    "'self'",
    // Realtime uses the matching websocket scheme: wss:// for hosted projects,
    // ws:// for the local stack (http://127.0.0.1:54321) used by e2e-local CI.
    ...(supabase ? [supabase, supabase.replace(/^http(s?):/, "ws$1:")] : []),
    ...liveKitCspSources(liveKit),
    "https://accept.paymob.com",
    ...GOOGLE_MAPS_CONNECT_SRC,
    sentry,
    ...firebase.connectSrc,
  ]);

  const imgSrc = uniqueSources([
    "'self'",
    "data:",
    "blob:",
    "https://storage.googleapis.com",
    ...GOOGLE_MAPS_IMG_SRC,
    ...(supabase ? [supabase, `${supabase}/storage/v1/object/`] : []),
  ]);

  const scriptSrc = uniqueSources([
    "'self'",
    "'unsafe-inline'",
    ...firebase.scriptSrc,
    ...GOOGLE_MAPS_SCRIPT_SRC,
  ]);
  const frameSrc = uniqueSources(["'self'", "https://accept.paymob.com", ...firebase.frameSrc]);

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `script-src ${scriptSrc.join(" ")}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com data:`,
    `img-src ${imgSrc.join(" ")}`,
    `connect-src ${connectSrc.join(" ")}`,
    `media-src 'self' blob:`,
    `worker-src 'self' blob:`,
    `frame-src ${frameSrc.join(" ")}`,
    "frame-ancestors 'none'",
  ].join("; ");
}