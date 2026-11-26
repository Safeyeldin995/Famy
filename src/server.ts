import "./lib/error-capture";
import { captureSentryServerException, initSentryServer } from "./lib/sentry/server";

initSentryServer();

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleQaMetaRequest } from "./lib/qa-meta-endpoint";
import {
  appleAppSiteAssociation,
  assetLinksDocument,
  wellKnownResponse,
} from "./lib/appLinks/wellKnown.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

async function logServerError(error: unknown, contextRoute: string, contextLabel: string) {
  try {
    const { logCapturedError } = await import("./lib/error-logging.server");
    await logCapturedError(error, {
      source: "server",
      contextRoute,
      contextLabel,
    });
    captureSentryServerException(error, { contextRoute, contextLabel });
  } catch (loggingError) {
    console.error("[server] Failed to persist server error_log row", loggingError);
  }
}

const HTML_SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

const PERMISSIONS_POLICY_DEFAULT = "camera=(), microphone=(), geolocation=(self)";
const PERMISSIONS_POLICY_ONLINE = "camera=(self), microphone=(self), geolocation=(self)";

/**
 * Camera/mic stay blocked site-wide except on the online-lessons surface, whose
 * live room (LiveKit) needs them. Permissions-Policy is fixed per document, and the
 * room is usually reached by client-side navigation from another /online page, so
 * the whole /online document must allow same-origin capture, not just /room URLs.
 */
export function permissionsPolicyForPath(pathname: string): string {
  return pathname === "/online" || pathname.startsWith("/online/")
    ? PERMISSIONS_POLICY_ONLINE
    : PERMISSIONS_POLICY_DEFAULT;
}

function applyHtmlSecurityHeaders(response: Response, pathname = "/"): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(HTML_SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  headers.set("Permissions-Policy", permissionsPolicyForPath(pathname));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  request: Request,
  response: Response,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  const captured = consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`);
  console.error(captured);
  await logServerError(captured, new URL(request.url).pathname, "ssr_http_error");
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/.well-known/assetlinks.json") {
        return wellKnownResponse(assetLinksDocument(process.env), "application/json; charset=utf-8");
      }
      if (pathname === "/.well-known/apple-app-site-association") {
        return wellKnownResponse(
          appleAppSiteAssociation(process.env),
          "application/json; charset=utf-8",
        );
      }
      const qaMeta = handleQaMetaRequest(request, process.env);
      if (qaMeta) return applyHtmlSecurityHeaders(qaMeta, pathname);

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return applyHtmlSecurityHeaders(
        await normalizeCatastrophicSsrResponse(request, response),
        pathname,
      );
    } catch (error) {
      console.error(error);
      await logServerError(error, new URL(request.url).pathname, "server_fetch_handler");
      return applyHtmlSecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
