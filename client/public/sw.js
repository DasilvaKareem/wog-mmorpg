/**
 * World of Geneva — Service Worker
 *
 * Responsibilities:
 *  1. Cache static assets for offline/fast loading
 *  2. Handle Web Push notifications (all platforms)
 *  3. Handle notification clicks (focus/open app)
 *  4. Background sync for missed events
 */

const CACHE_NAME = "wog-v2";
const APP_SHELL = [
  "/",
  "/favicon.ico",
  "/favicon-192.png",
  "/favicon-512.png",
  "/manifest.json",
  "/browserconfig.xml",
  "/icons/pwa/icon-192x192.png",
  "/icons/pwa/icon-512x512.png",
  "/icons/pwa/icon-maskable-192x192.png",
  "/icons/pwa/icon-maskable-512x512.png",
];

// ── Install: pre-cache app shell ──────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network-first with cache fallback ──────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests; skip API/SSE calls
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/events") ||
    url.pathname.startsWith("/v1") ||
    url.pathname.startsWith("/v2") ||
    url.pathname.startsWith("/notifications")
  ) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // Cache fresh responses for static assets
        if (
          networkResponse.ok &&
          (url.pathname.startsWith("/assets/") ||
            url.pathname.startsWith("/icons/") ||
            url.pathname.startsWith("/sprites/") ||
            url.pathname.endsWith(".png") ||
            url.pathname.endsWith(".ico") ||
            url.pathname.endsWith(".json"))
        ) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return networkResponse;
      })
      .catch(() =>
        // Network failed — try cache, then offline fallback
        caches.match(request).then(
          (cached) =>
            cached ||
            caches.match("/").then(
              (fallback) =>
                fallback ||
                new Response("Offline — World of Geneva requires a connection to load.", {
                  status: 503,
                  headers: { "Content-Type": "text/plain" },
                })
            )
        )
      )
  );
});

// ── Push: receive server push → show notification ─────────────────────────
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "World of Geneva", body: event.data ? event.data.text() : "New activity!" };
  }

  const title = data.title || "World of Geneva";
  const options = {
    body: data.body || "Something happened in the world.",
    icon: "/favicon-192.png",
    badge: "/favicon-192.png",
    image: data.image || undefined,
    tag: data.tag || "wog-notification",
    data: {
      url: data.url || "/world",
      timestamp: Date.now(),
    },
    // Show even when app is in foreground on some platforms
    requireInteraction: false,
    silent: false,
    // Actions (Android / desktop only)
    actions: data.actions || [
      { action: "open", title: "Open Game" },
      { action: "dismiss", title: "Dismiss" },
    ],
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: focus or open the app ─────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const targetUrl = event.notification.data?.url || "/world";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // If app is already open, focus it and navigate
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client) {
              client.navigate(targetUrl);
            } else {
              client.postMessage({ type: "NAVIGATE", url: targetUrl });
            }
            return;
          }
        }
        // App not open — open a new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});

// ── Notification close (dismissed without click) ──────────────────────────
self.addEventListener("notificationclose", (_event) => {
  // Analytics hook — could postMessage back to client if needed
});

// ── Message: receive commands from the app ────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
