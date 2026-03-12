/**
 * PushNotificationBanner
 *
 * Prompts the user to enable push notifications.
 * Handles platform-specific cases:
 *   - iOS: explains "Add to Home Screen" requirement
 *   - Android/Desktop: shows enable button
 *   - Already subscribed: shows manage option
 *   - Denied: shows instructions to re-enable
 *   - Not supported: hides silently
 */

import * as React from "react";
import { usePushNotifications } from "@/hooks/usePushNotifications";

interface PushNotificationBannerProps {
  walletAddress: string | null | undefined;
}

export function PushNotificationBanner({ walletAddress }: PushNotificationBannerProps): React.ReactElement | null {
  const {
    supported,
    needsInstallFirst,
    permission,
    isSubscribed,
    loading,
    error,
    subscribe,
    unsubscribe,
    sendTestPush,
  } = usePushNotifications(walletAddress);

  const [dismissed, setDismissed] = React.useState(() => {
    try {
      return localStorage.getItem("wog-push-dismissed") === "1";
    } catch {
      return false;
    }
  });
  const [showManage, setShowManage] = React.useState(false);

  const dismiss = React.useCallback(() => {
    setDismissed(true);
    try { localStorage.setItem("wog-push-dismissed", "1"); } catch { /* noop */ }
  }, []);

  // Don't render if: not supported, already subscribed (unless managing), or dismissed
  if (!supported) return null;
  if (dismissed && !showManage) return null;
  if (isSubscribed && !showManage) return null;
  if (permission === "denied" && !showManage) return null;

  // ── Already subscribed — show manage panel ────────────────────────────
  if (isSubscribed && showManage) {
    return (
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4">
        <div className="rounded-xl border border-white/10 bg-[#0b1520]/95 backdrop-blur-sm p-4 shadow-2xl">
          <p className="text-sm font-semibold text-green-400 mb-1">Push notifications active</p>
          <p className="text-xs text-white/60 mb-3">
            You'll be alerted on level-ups, deaths, and world events.
          </p>
          <div className="flex gap-2">
            <button
              onClick={sendTestPush}
              disabled={loading}
              className="flex-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs py-2 px-3 transition disabled:opacity-50"
            >
              Send Test
            </button>
            <button
              onClick={unsubscribe}
              disabled={loading}
              className="flex-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs py-2 px-3 transition disabled:opacity-50"
            >
              {loading ? "..." : "Disable"}
            </button>
            <button
              onClick={() => setShowManage(false)}
              className="rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-xs py-2 px-3 transition"
            >
              Close
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>
      </div>
    );
  }

  // ── Permission denied — show re-enable instructions ───────────────────
  if (permission === "denied") {
    return (
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4">
        <div className="rounded-xl border border-yellow-500/20 bg-[#0b1520]/95 backdrop-blur-sm p-4 shadow-2xl">
          <div className="flex justify-between items-start mb-1">
            <p className="text-sm font-semibold text-yellow-400">Notifications blocked</p>
            <button onClick={dismiss} className="text-white/40 hover:text-white/70 text-lg leading-none ml-2">×</button>
          </div>
          <p className="text-xs text-white/60">
            To re-enable, open your browser settings and allow notifications for this site.
          </p>
        </div>
      </div>
    );
  }

  // ── iOS — needs Add to Home Screen first ─────────────────────────────
  if (needsInstallFirst) {
    return (
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4">
        <div className="rounded-xl border border-white/10 bg-[#0b1520]/95 backdrop-blur-sm p-4 shadow-2xl">
          <div className="flex justify-between items-start mb-2">
            <p className="text-sm font-semibold text-amber-300">Enable game notifications</p>
            <button onClick={dismiss} className="text-white/40 hover:text-white/70 text-lg leading-none ml-2">×</button>
          </div>
          <p className="text-xs text-white/70 mb-3">
            On iOS, tap <span className="font-semibold text-white">Share</span> then{" "}
            <span className="font-semibold text-white">Add to Home Screen</span> to enable push notifications for level-ups, deaths, and world events.
          </p>
          <div className="flex items-center gap-2 text-white/40 text-xs">
            <span className="text-2xl">⬆</span>
            <span>Tap Share → Add to Home Screen</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Default prompt ────────────────────────────────────────────────────
  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4">
      <div className="rounded-xl border border-white/10 bg-[#0b1520]/95 backdrop-blur-sm p-4 shadow-2xl">
        <div className="flex justify-between items-start mb-2">
          <p className="text-sm font-semibold text-white">Get notified in-game</p>
          <button
            onClick={dismiss}
            className="text-white/40 hover:text-white/70 text-lg leading-none ml-2"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
        <p className="text-xs text-white/60 mb-3">
          Receive push notifications for level-ups, deaths, quest completions, and world events — even when the game is in the background.
        </p>
        {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={subscribe}
            disabled={loading || !walletAddress}
            className="flex-1 rounded-lg bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-black font-semibold text-sm py-2 px-4 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Enabling..." : "Enable Notifications"}
          </button>
          <button
            onClick={dismiss}
            className="rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-sm py-2 px-3 transition"
          >
            Not now
          </button>
        </div>
        {!walletAddress && (
          <p className="mt-2 text-xs text-white/40">Connect your wallet first to enable notifications.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Small bell icon button to manage notification settings.
 * Place in Navbar or HotkeyBar.
 */
export function NotificationSettingsButton({
  walletAddress,
}: {
  walletAddress: string | null | undefined;
}): React.ReactElement | null {
  const { supported, isSubscribed, permission } = usePushNotifications(walletAddress);
  const [open, setOpen] = React.useState(false);

  if (!supported) return null;

  const active = isSubscribed && permission === "granted";

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        title={active ? "Notifications on" : "Enable notifications"}
        className={`relative flex items-center justify-center w-8 h-8 rounded-lg transition ${
          active
            ? "text-amber-400 hover:text-amber-300"
            : "text-white/40 hover:text-white/70"
        }`}
        aria-label="Notification settings"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill={active ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={1.5}
          className="w-5 h-5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>
        {active && (
          <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-amber-400 rounded-full" />
        )}
      </button>

      {open && (
        <NotificationSettingsPanel
          walletAddress={walletAddress}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function NotificationSettingsPanel({
  walletAddress,
  onClose,
}: {
  walletAddress: string | null | undefined;
  onClose: () => void;
}): React.ReactElement {
  const {
    supported,
    needsInstallFirst,
    permission,
    isSubscribed,
    loading,
    error,
    subscribe,
    unsubscribe,
    sendTestPush,
  } = usePushNotifications(walletAddress);

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl border border-white/10 bg-[#0b1520]/98 backdrop-blur-sm p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-semibold text-white">Push Notifications</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/70 text-xl leading-none">×</button>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2 mb-4">
          <div className={`w-2.5 h-2.5 rounded-full ${isSubscribed && permission === "granted" ? "bg-green-400" : "bg-white/20"}`} />
          <span className="text-sm text-white/70">
            {!supported && "Not supported in this browser"}
            {supported && needsInstallFirst && "Add to Home Screen required (iOS)"}
            {supported && !needsInstallFirst && permission === "denied" && "Blocked in browser settings"}
            {supported && !needsInstallFirst && permission === "granted" && isSubscribed && "Active — receiving notifications"}
            {supported && !needsInstallFirst && permission === "granted" && !isSubscribed && "Enabled but not subscribed"}
            {supported && !needsInstallFirst && permission === "default" && "Not yet enabled"}
          </span>
        </div>

        {/* Platform-specific instructions */}
        {needsInstallFirst && (
          <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <p className="text-xs text-amber-300">
              On iOS Safari, tap <strong>Share ⬆</strong> then <strong>Add to Home Screen</strong> to enable push notifications.
            </p>
          </div>
        )}

        {permission === "denied" && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-xs text-red-300">
              Notifications are blocked. Open your browser/OS settings and allow notifications for worldofgeneva.xyz.
            </p>
          </div>
        )}

        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

        {/* What you'll receive */}
        <div className="mb-4 space-y-1.5">
          {[
            "Level-up milestones",
            "Death alerts",
            "Quest completions",
            "World events & invasions",
          ].map((item) => (
            <div key={item} className="flex items-center gap-2 text-xs text-white/60">
              <span className="text-amber-400">•</span>
              {item}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {!isSubscribed && !needsInstallFirst && permission !== "denied" && (
            <button
              onClick={subscribe}
              disabled={loading || !walletAddress}
              className="w-full rounded-lg bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-black font-semibold text-sm py-2.5 transition disabled:opacity-50"
            >
              {loading ? "Enabling..." : "Enable Push Notifications"}
            </button>
          )}
          {isSubscribed && (
            <>
              <button
                onClick={sendTestPush}
                disabled={loading}
                className="w-full rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm py-2.5 transition disabled:opacity-50"
              >
                {loading ? "Sending..." : "Send Test Notification"}
              </button>
              <button
                onClick={unsubscribe}
                disabled={loading}
                className="w-full rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-sm py-2.5 transition disabled:opacity-50"
              >
                {loading ? "Disabling..." : "Disable Notifications"}
              </button>
            </>
          )}
        </div>

        <p className="mt-3 text-xs text-white/30 text-center">
          Works on Android, iOS 16.4+, Windows, macOS, and Linux
        </p>
      </div>
    </div>
  );
}
