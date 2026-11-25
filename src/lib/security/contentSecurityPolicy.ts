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

function uniqueSources(sources: string[]): string[] {
  return [...new Set(sources.filter(Boolean))];
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
    ...(supabase ? [supabase, supabase.replace(/^https:/, "wss:")] : []),
    ...(liveKit ? [liveKit, liveKit.replace(/^wss:/, "https:")] : []),
    "https://accept.paymob.com",
    sentry,
    ...firebase.connectSrc,
  ]);

  const imgSrc = uniqueSources([
    "'self'",
    "data:",
    "blob:",
    "https://storage.googleapis.com",
    ...(supabase ? [supabase, `${supabase}/storage/v1/object/`] : []),
  ]);

  const scriptSrc = uniqueSources(["'self'", "'unsafe-inline'", ...firebase.scriptSrc]);
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
    `frame-src ${frameSrc.join(" ")}`,
    "frame-ancestors 'none'",
  ].join("; ");
}