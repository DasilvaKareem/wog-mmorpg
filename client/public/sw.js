/**
 * World of Geneva — Service Worker
 *
 * Responsibilities:
 *  1. Cache static assets for instant loading (cache-first for immutables)
 *  2. Stale-while-revalidate for HTML shell (fast start, update in background)
 *  3. Handle Web Push notifications (all platforms)
 *  4. Handle notification clicks (focus/open app)
 */

const CACHE_NAME = "wog-1773335974";
const APP_SHELL = [
  "/",
  "/favicon.ico",
  "/favicon-192.png",
  "/favicon-512.png",
  "/manifest.json",
  "/browserconfig.xml",
  "/icons/pwa/icon-180x180.png",
  "/icons/pwa/icon-192x192.png",
  "/icons/pwa/icon-512x512.png",
  "/icons/pwa/icon-maskable-192x192.png",
  "/icons/pwa/icon-maskable-512x512.png",
  // HotkeyBar icons (always visible on /world)
  "/icons/armor.png",
  "/icons/commet.png",
  "/icons/essence.png",
  "/icons/gold.png",
  "/icons/heart.png",
  "/icons/level.png",
  "/icons/quest.png",
  "/icons/sword.png",
  "/icons/weapon.png",
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

// ── Fetch strategies ─────────────────────────────────────────────────────

// Cache-first: serve from cache instantly, only fetch on cache miss.
// Used for immutable assets (Vite hashed bundles, sprites, icons, fonts).
function cacheFirst(request) {
  return caches.match(request).then(
    (cached) =>
      cached ||
      fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
  );
}

// Stale-while-revalidate: serve cached version instantly, update in background.
// Used for HTML shell and manifest — fast start, picks up deploys on next load.
function staleWhileRevalidate(request) {
  return caches.match(request).then((cached) => {
    const networkFetch = fetch(request).then((response) => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
      }
      return response;
    });
    return cached || networkFetch;
  });
}

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

  const p = url.pathname;

  // 1. Vite hashed bundles — immutable (content hash in filename), cache-first
  if (p.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 2. Sprites & icons — stable filenames, cache-first
  if (
    p.startsWith("/sprites/") ||
    p.startsWith("/icons/") ||
    p.endsWith(".png") ||
    p.endsWith(".ico")
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 3. Fonts — cache-first
  if (p.endsWith(".woff2") || p.endsWith(".woff") || p.endsWith(".ttf")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 4. Navigation & HTML shell — stale-while-revalidate for instant start
  if (request.mode === "navigate" || p === "/" || p === "/manifest.json" || p === "/browserconfig.xml") {
    event.respondWith(
      staleWhileRevalidate(request).catch(() =>
        caches.match("/").then(
          (fallback) =>
            fallback ||
            new Response("Offline — World of Geneva requires a connection to load.", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
        )
      )
    );
    return;
  }

  // 5. Everything else same-origin — stale-while-revalidate
  event.respondWith(
    staleWhileRevalidate(request).catch(() =>
      caches.match(request).then(
        (cached) =>
          cached ||
          new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
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

  event.waitUntil(
    self.registration.showNotification(title, options).then(() => {
      // Increment app icon badge (PWA only, ignored if unsupported)
      if (navigator.setAppBadge) {
        navigator.setAppBadge().catch(() => {});
      }
    })
  );
});

// ── Notification click: focus or open the app ─────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Clear app icon badge when user interacts with a notification
  if (navigator.clearAppBadge) {
    navigator.clearAppBadge().catch(() => {});
  }

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
