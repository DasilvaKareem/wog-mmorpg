import * as React from "react";
import { useWalletContext } from "@/context/WalletContext";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useBackgroundMusic } from "@/hooks/useBackgroundMusic";

const LS_SOUND = "wog-sound-enabled";

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === "1";
  } catch {
    return fallback;
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch { /* noop */ }
}

function detectIsPwa(): boolean {
  if (typeof window === "undefined") return false;
  if ((window.navigator as any).standalone === true) return true;
  return window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches;
}

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps): React.ReactElement | null {
  const { address } = useWalletContext();
  const push = usePushNotifications(address);
  const { muted: musicMuted, toggleMute: toggleMusic } = useBackgroundMusic("world-theme");

  const [soundEnabled, setSoundEnabled] = React.useState(() => readBool(LS_SOUND, true));
  const [isPwa] = React.useState(detectIsPwa);

  if (!open) return null;

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    writeBool(LS_SOUND, next);
    window.dispatchEvent(new CustomEvent("wog:sound-toggle", { detail: { enabled: next } }));
  };

  const handlePushToggle = async () => {
    if (push.isSubscribed) {
      await push.unsubscribe();
    } else {
      await push.subscribe();
    }
  };

  const pushActive = push.isSubscribed && push.permission === "granted";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-xs border-4 border-black bg-[#0c1424] shadow-[6px_6px_0_0_#000] font-mono"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-[#1a2a44] bg-[#111d33] px-4 py-2.5">
          <span className="text-[11px] uppercase tracking-widest text-[#ffcc00]">Settings</span>
          <button
            onClick={onClose}
            className="text-[14px] leading-none text-[#596a8a] hover:text-[#ffcc00] transition-colors"
          >
            x
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-1">
          {/* Push Notifications */}
          <ToggleRow
            label="Push Notifications"
            sublabel={
              !push.supported
                ? "Not supported"
                : push.needsInstallFirst
                  ? "Add to Home Screen first"
                  : push.permission === "denied"
                    ? "Blocked in browser"
                    : pushActive
                      ? "Receiving alerts"
                      : "Off"
            }
            enabled={pushActive}
            loading={push.loading}
            disabled={!push.supported || push.needsInstallFirst || push.permission === "denied" || !address}
            onToggle={handlePushToggle}
          />

          {push.error && (
            <p className="text-[8px] text-red-400 px-1 pb-1">{push.error}</p>
          )}

          {push.permission === "denied" && (
            <p className="text-[8px] text-[#596a8a] px-1 pb-1">
              Enable in browser settings to use push notifications.
            </p>
          )}

          {/* Sound */}
          <ToggleRow
            label="Sound Effects"
            sublabel={soundEnabled ? "On" : "Off"}
            enabled={soundEnabled}
            onToggle={toggleSound}
          />

          {/* Music */}
          <ToggleRow
            label="Music"
            sublabel={musicMuted ? "Off" : "On"}
            enabled={!musicMuted}
            onToggle={toggleMusic}
          />

          {/* PWA Reload */}
          {isPwa && (
            <button
              onClick={() => window.location.reload()}
              className="flex w-full items-center justify-between px-2 py-2 hover:bg-[#111d33] transition-colors"
            >
              <div className="text-left">
                <span className="block text-[10px] uppercase tracking-wide text-[#c0c8e0]">Reload App</span>
                <span className="block text-[8px] text-[#596a8a] mt-0.5">Refresh the game</span>
              </div>
              <span className="text-[16px] text-[#9aa7cc]">&#x21bb;</span>
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="border-t-2 border-[#1a2a44] px-4 py-2">
          <p className="text-[7px] text-[#3a4a6a] text-center uppercase tracking-wider">
            World of Geneva v0.1
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Toggle Row ──────────────────────────────────────────────────────── */

function ToggleRow({
  label,
  sublabel,
  enabled,
  loading,
  disabled,
  onToggle,
}: {
  label: string;
  sublabel?: string;
  enabled: boolean;
  loading?: boolean;
  disabled?: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      onClick={onToggle}
      disabled={disabled || loading}
      className="flex w-full items-center justify-between px-2 py-2 hover:bg-[#111d33] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <div className="text-left">
        <span className="block text-[10px] uppercase tracking-wide text-[#c0c8e0]">{label}</span>
        {sublabel && (
          <span className="block text-[8px] text-[#596a8a] mt-0.5">{sublabel}</span>
        )}
      </div>
      <div
        className={`relative w-8 h-4 rounded-full border-2 border-black transition-colors ${
          enabled ? "bg-[#54f28b]" : "bg-[#1a2a44]"
        }`}
      >
        <div
          className={`absolute top-0.5 w-2 h-2 rounded-full bg-white shadow-[1px_1px_0_0_#000] transition-transform ${
            enabled ? "translate-x-[14px]" : "translate-x-[2px]"
          }`}
        />
      </div>
    </button>
  );
}
