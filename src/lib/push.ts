/**
 * Browser push registration. All permission requests happen only from an
 * explicit call site (a button's onClick) — nothing here runs on mount or
 * page load. isPushConfigured() reflects whether a public VAPID key has
 * been provisioned; until it has, callers should show an honest
 * "not available yet" state rather than a button that silently fails.
 */

export type PushAvailability = "unconfigured" | "unsupported" | "default" | "granted" | "denied";

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function isPushConfigured(): boolean {
  return !!(import.meta as any).env?.VITE_VAPID_PUBLIC_KEY;
}

export function getPushAvailability(): PushAvailability {
  if (!isPushConfigured()) return "unconfigured";
  if (!isPushSupported()) return "unsupported";
  return Notification.permission as PushAvailability;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function bufferToBase64(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function guessDeviceLabel(): string {
  const ua = navigator.userAgent || "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : "";
  return os ? `${browser} on ${os}` : browser;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  return navigator.serviceWorker.register("/sw.js");
}

export type PushSubscriptionPayload = { endpoint: string; p256dh: string; authKey: string; deviceLabel: string };

/** Must be called from a direct user-action handler (permission prompt requires it). */
export async function subscribeToPush(): Promise<PushSubscriptionPayload> {
  if (!isPushConfigured()) throw new Error("Push is not configured for this environment yet.");
  if (!isPushSupported()) throw new Error("This browser does not support push notifications.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "denied" : "dismissed");

  const reg = await registerServiceWorker();
  if (!reg) throw new Error("Service worker registration failed.");
  const ready = await navigator.serviceWorker.ready;

  let sub = await ready.pushManager.getSubscription();
  if (!sub) {
    sub = await ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array((import.meta as any).env.VITE_VAPID_PUBLIC_KEY) as BufferSource,
    });
  }

  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh || bufferToBase64(sub.getKey("p256dh")),
    authKey: json.keys?.auth || bufferToBase64(sub.getKey("auth")),
    deviceLabel: guessDeviceLabel(),
  };
}

/** Returns the endpoint that was unsubscribed (for server-side revoke), or null if there was none. */
export async function unsubscribeFromPush(): Promise<string | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!reg) return null;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}
