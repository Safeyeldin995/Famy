import { getRequestHeader } from "@tanstack/react-start/server";
import {
  MOBILE_AUTH_INTENTS_HEADER,
  withMobileAuthCookies,
  type MobileAuthIntentsPayload,
} from "@/lib/auth/authIntent.server";

function attachIntents(body: unknown, intents?: MobileAuthIntentsPayload) {
  if (!intents) return body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return { ...body, intents };
  }
  return { value: body, intents };
}

export function mobileJson(body: unknown, status = 200, intents?: MobileAuthIntentsPayload) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  return new Response(JSON.stringify(attachIntents(body, intents)), { status, headers });
}

export async function runWithMobileAuthCookies<T>(fn: () => Promise<T>) {
  const intentsHeader = getRequestHeader(MOBILE_AUTH_INTENTS_HEADER) ?? undefined;
  return withMobileAuthCookies(intentsHeader, fn);
}
