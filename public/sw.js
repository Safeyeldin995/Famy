// Famy push service worker. Static file served from the app origin root —
// no build step, no bundler dependency; a service worker must live at a
// URL that controls the scope it needs (the whole app), so this can't be
// emitted from src/ without a bundler plugin this repo doesn't have.
// Handles push while the tab is backgrounded or the app is fully closed,
// per the "must work without a browser tab open" requirement.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Famy", body: event.data.text() };
  }

  const title = payload.title || "Famy";
  const options = {
    body: payload.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: payload.tag || undefined,
    data: { deepLink: payload.deepLink || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Focuses an existing app window when possible, otherwise opens one, then
// navigates to the safe server-provided deep link. The deep link itself
// already encodes only what its recipient is authorized to see (it was
// generated server-side for that specific user) — this handler does not
// need to (and cannot) make its own authorization decision.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const deepLink = (event.notification.data && event.notification.data.deepLink) || "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(deepLink);
              return;
            } catch {
              // fall through to postMessage below
            }
          }
          client.postMessage({ type: "famy-navigate", deepLink });
          return;
        }
      }
      await self.clients.openWindow(deepLink);
    })(),
  );
});
