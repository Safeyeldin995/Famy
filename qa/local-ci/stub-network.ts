import type { BrowserContext } from "@playwright/test";

/**
 * Nothing outside the runner is called: every request that is not to the local
 * app or the local Supabase stack (Paymob, LiveKit, Resend, Firebase, Google
 * Maps and Fonts, Sentry, analytics) gets an empty 204 from the browser itself.
 * Stubbed hosts are recorded so a spec can assert a flow never reached one.
 */
export async function stubExternalNetwork(context: BrowserContext, stubbedHosts?: Set<string>) {
  await context.route(
    (url) => !(url.protocol === "data:" || url.protocol === "blob:" || isLoopback(url.hostname)),
    async (route) => {
      const host = new URL(route.request().url()).hostname;
      stubbedHosts?.add(host);
      await route.fulfill({
        status: 204,
        headers: { "access-control-allow-origin": "*" },
        body: "",
      });
    },
  );
}

function isLoopback(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}
