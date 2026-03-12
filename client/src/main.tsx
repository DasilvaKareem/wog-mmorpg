import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThirdwebProvider } from "thirdweb/react";

import App from "@/App";
import "@/index.css";

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

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <ThirdwebProvider>
      <App />
    </ThirdwebProvider>
  </StrictMode>
);
