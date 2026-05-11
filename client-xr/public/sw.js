// Tombstone service worker.
// Replaces the previous main-client SW that was installed under scope "/".
// Wipes caches, unregisters itself, and reloads any controlled clients so
// they fetch the new XR site directly from the network.

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {}
    try {
      await self.registration.unregister();
    } catch {}
    try {
      const clientList = await self.clients.matchAll({ type: "window" });
      for (const client of clientList) {
        try { client.navigate(client.url); } catch {}
      }
    } catch {}
  })());
});

// No fetch handler — requests go straight to the network.
