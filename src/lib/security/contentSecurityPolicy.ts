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

/** Build HTML document CSP for the web app (admin + /online + marketing). */
export function buildContentSecurityPolicy(env: NodeJS.ProcessEnv = process.env): string {
  const supabase = hostFromUrl(env.VITE_SUPABASE_URL ?? env.SUPABASE_URL);
  const liveKit = hostFromUrl(env.LIVEKIT_URL);
  const sentry = hostFromDsn(env.VITE_SENTRY_DSN ?? env.SENTRY_DSN);

  const connectSrc = ["'self'"];
  if (supabase) {
    connectSrc.push(supabase, supabase.replace(/^https:/, "wss:"));
  }
  if (liveKit) {
    connectSrc.push(liveKit, liveKit.replace(/^wss:/, "https:"));
  }
  connectSrc.push("https://accept.paymob.com");
  if (sentry) connectSrc.push(sentry);

  const imgSrc = ["'self'", "data:", "blob:", "https://storage.googleapis.com"];
  if (supabase) imgSrc.push(`${supabase}/storage/v1/object/public`);

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `script-src 'self' 'unsafe-inline'`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com data:`,
    `img-src ${imgSrc.join(" ")}`,
    `connect-src ${connectSrc.join(" ")}`,
    `media-src 'self' blob:`,
    `frame-src 'self' https://accept.paymob.com`,
    "frame-ancestors 'none'",
  ].join("; ");
}