/**
 * usePushNotifications
 *
 * Cross-platform Web Push subscription hook.
 * Works on:
 *   - Android (Chrome, Samsung Internet, Firefox)
 *   - iOS Safari 16.4+ / Chrome 128+ on iOS (requires app added to home screen)
 *   - Windows (Chrome, Edge, Firefox)
 *   - macOS (Safari 16.4+, Chrome, Firefox)
 *   - Linux (Chrome, Firefox)
 *
 * Usage:
 *   const { permission, supported, isSubscribed, subscribe, unsubscribe } = usePushNotifications(walletAddress);
 */

import { useState, useEffect, useCallback, useRef } from "react";

export type NotificationPermission = "default" | "granted" | "denied" | "unsupported";

export interface UsePushNotificationsResult {
  /** Whether the current browser supports push notifications */
  supported: boolean;
  /** Whether the app is running as an installed PWA */
  isInstalled: boolean;
  /** iOS-specific: whether user needs to "Add to Home Screen" first */
  needsInstallFirst: boolean;
  /** Current notification permission state */
  permission: NotificationPermission;
  /** Whether we have an active push subscription on the server */
  isSubscribed: boolean;
  /** Loading state during subscribe/unsubscribe */
  loading: boolean;
  /** Error message if last operation failed */
  error: string | null;
  /** Subscribe to push notifications */
  subscribe: () => Promise<void>;
  /** Unsubscribe from push notifications */
  unsubscribe: () => Promise<void>;
  /** Send a test push notification to this device */
  sendTestPush: () => Promise<void>;
}

function detectIsInstalled(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari standalone mode
  if ((window.navigator as any).standalone === true) return true;
  // Android / desktop — check display-mode
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  if (window.matchMedia("(display-mode: minimal-ui)").matches) return true;
  if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
  return false;
}

function detectIsIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function getVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch("/notifications/push/vapid-public-key");
    if (!res.ok) return null;
    const data = await res.json();
    return data.publicKey ?? null;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from(Array.from(rawData).map((c) => c.charCodeAt(0)));
}

export function usePushNotifications(
  walletAddress: string | null | undefined
): UsePushNotificationsResult {
  const supported = isPushSupported();
  const isIos = detectIsIos();
  const [isInstalled, setIsInstalled] = useState(detectIsInstalled);
  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (!supported) return "unsupported";
    return (Notification.permission as NotificationPermission);
  });
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // iOS needs the app added to home screen before push works
  const needsInstallFirst = isIos && !isInstalled;

  // Watch for PWA install state change (e.g. after user adds to home screen)
  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const onChange = () => setIsInstalled(detectIsInstalled());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Sync permission state
  useEffect(() => {
    if (!supported) return;
    setPermission(Notification.permission as NotificationPermission);
  }, [supported]);

  // Check existing subscription status on mount
  useEffect(() => {
    if (!supported || !walletAddress) return;
    let cancelled = false;

    (async () => {
      try {
        const sw = await navigator.serviceWorker.ready;
        const existing = await sw.pushManager.getSubscription();
        if (!cancelled) setIsSubscribed(!!existing);
      } catch {
        if (!cancelled) setIsSubscribed(false);
      }
    })();

    return () => { cancelled = true; };
  }, [supported, walletAddress]);

  const subscribe = useCallback(async () => {
    if (!supported || !walletAddress) return;
    if (needsInstallFirst) {
      setError("On iOS, please add World of Geneva to your Home Screen first, then enable notifications.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Fetch VAPID public key from server
      const vapidKey = await getVapidPublicKey();
      if (!vapidKey) {
        setError("Push notifications are not configured on this server.");
        return;
      }

      // 2. Request notification permission (requires user gesture)
      const perm = await Notification.requestPermission();
      setPermission(perm as NotificationPermission);
      if (perm !== "granted") {
        setError(
          perm === "denied"
            ? "Notifications were blocked. Please enable them in your browser settings."
            : "Notification permission was not granted."
        );
        return;
      }

      // 3. Wait for service worker to be ready
      const sw = await navigator.serviceWorker.ready;

      // 4. Subscribe to push manager
      const subscription = await sw.pushManager.subscribe({
        userVisibleOnly: true, // Required: must show notification on push (iOS + Chrome)
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      // 5. Send subscription to server
      const res = await fetch("/notifications/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: walletAddress,
          subscription: subscription.toJSON(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to save subscription");
      }

      setIsSubscribed(true);
    } catch (err: any) {
      setError(err.message ?? "Failed to enable push notifications");
    } finally {
      setLoading(false);
    }
  }, [supported, walletAddress, needsInstallFirst]);

  const unsubscribe = useCallback(async () => {
    if (!supported || !walletAddress) return;
    setLoading(true);
    setError(null);

    try {
      const sw = await navigator.serviceWorker.ready;
      const existing = await sw.pushManager.getSubscription();
      if (existing) {
        await existing.unsubscribe();
      }

      await fetch(`/notifications/push/subscribe/${walletAddress}`, {
        method: "DELETE",
      });

      setIsSubscribed(false);
    } catch (err: any) {
      setError(err.message ?? "Failed to disable push notifications");
    } finally {
      setLoading(false);
    }
  }, [supported, walletAddress]);

  const sendTestPush = useCallback(async () => {
    if (!walletAddress) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/notifications/push/test/${walletAddress}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Test push failed");
      }
    } catch (err: any) {
      setError(err.message ?? "Test push failed");
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  return {
    supported,
    isInstalled,
    needsInstallFirst,
    permission,
    isSubscribed,
    loading,
    error,
    subscribe,
    unsubscribe,
    sendTestPush,
  };
}
