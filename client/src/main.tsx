import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThirdwebProvider } from "thirdweb/react";
import { PostHogProvider } from "@posthog/react";

import App from "@/App";
import "@/index.css";

const posthogOptions = {
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
  defaults: "2026-01-30",
} as const;

const CHUNK_RELOAD_KEY = "wog:chunk-reload-at";

function reloadOnceForChunkError(): void {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || "0");
    if (Date.now() - last < 15_000) return;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    // Ignore storage failures and still attempt a single reload.
  }
  window.location.reload();
}

// ── Badge clear on focus ──────────────────────────────────────────────────
// Clear app icon badge when user returns to the app (PWA only).
if (navigator.clearAppBadge) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      navigator.clearAppBadge().catch(() => {});
    }
  });
}

// ── Service Worker registration ───────────────────────────────────────────
// Registers /sw.js for offline caching and Web Push notifications.
// Works on: Android, iOS 16.4+, Windows, macOS, Linux.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        console.log("[sw] Registered, scope:", registration.scope);
        // Activate new SW immediately when update is found
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });

        // Poll for SW updates every 5 min so PWA users get fresh deploys fast
        setInterval(() => registration.update(), 5 * 60 * 1000);
        // Also check on visibility change (user returns to the tab/app)
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") registration.update();
        });
      })
      .catch((err) => {
        console.warn("[sw] Registration failed:", err);
      });

    // Reload when new SW takes control
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}

window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  reloadOnceForChunkError();
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message = typeof reason === "object" && reason && "message" in reason
    ? String((reason as { message?: unknown }).message ?? "")
    : String(reason ?? "");
  if (message.includes("Failed to fetch dynamically imported module")) {
    reloadOnceForChunkError();
  }
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <PostHogProvider apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_KEY} options={posthogOptions}>
      <ThirdwebProvider>
        <App />
      </ThirdwebProvider>
    </PostHogProvider>
  </StrictMode>
);
