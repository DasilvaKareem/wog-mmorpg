import * as React from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { HpBar } from "@/components/ui/hp-bar";

import { XpBar } from "@/components/ui/xp-bar";
import { API_URL } from "@/config";
import { useWallet } from "@/hooks/useWallet";
import { MUSIC_TOGGLE_EVENT } from "@/hooks/useBackgroundMusic";
import { useWogNames } from "@/hooks/useWogNames";
import { gameBus } from "@/lib/eventBus";
import { getAuthToken } from "@/lib/agentAuth";
import { playSoundEffect } from "@/lib/soundEffects";
import { cn } from "@/lib/utils";
import { WalletManager } from "@/lib/walletManager";

const TIER_COLORS: Record<string, string> = {
  free: "#9aa7cc",
  starter: "#54f28b",
  pro: "#ffcc00",
};
const LS_SOUND = "wog-sound-enabled";
const LS_MUSIC_MUTED = "wog-music-muted";

function CharacterSection({
  characters,
  characterProgress,
  characterLoading,
  selectedCharacterTokenId,
  deployedCharacterName,
  selectCharacter,
  walletAddress,
}: {
  characters: import("@/types").OwnedCharacter[];
  characterProgress: import("@/ShardClient").WalletCharacterProgress | null;
  characterLoading: boolean;
  selectedCharacterTokenId: string | null;
  deployedCharacterName: string | null;
  selectCharacter: (tokenId: string | null) => void;
  walletAddress: string;
}): React.ReactElement {
  const [switching, setSwitching] = React.useState(false);
  const [showSwapMenu, setShowSwapMenu] = React.useState(false);

  const activeCharacter = React.useMemo(() => {
    if (selectedCharacterTokenId) {
      const selected = characters.find((c) => c.tokenId === selectedCharacterTokenId);
      if (selected) return selected;
    }

    if (deployedCharacterName) {
      const deployed = characters.find((c) => {
        const baseName = c.name.replace(/\s+the\s+\w+$/i, "").trim();
        return baseName === deployedCharacterName || c.name === deployedCharacterName;
      });
      if (deployed) return deployed;
    }

    return characters[0] ?? null;
  }, [characters, deployedCharacterName, selectedCharacterTokenId]);

  const activeCharacterName = activeCharacter?.name ?? deployedCharacterName ?? "No character";
  const activeCharacterLevel = characterProgress?.level ?? activeCharacter?.properties.level ?? null;
  const activeCharacterRace = activeCharacter?.properties.race ?? null;
  const activeCharacterClass = activeCharacter?.properties.class ?? null;

  function focusCharacter() {
    if (!characterProgress) return;
    if (characterProgress.zoneId) {
      gameBus.emit("switchZone", { zoneId: characterProgress.zoneId });
    }
    gameBus.emit("lockToPlayer", { walletAddress });
  }

  async function handleSwitch(tokenId: string) {
    if (switching) return;
    const char = characters.find((c) => c.tokenId === tokenId);
    if (!char) return;

    setSwitching(true);
    try {
      const token = await getAuthToken(walletAddress);
      if (!token) return;

      // Stop current agent — server now saves + despawns the old entity
      const stopRes = await fetch(`${API_URL}/agent/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ walletAddress }),
      });
      if (!stopRes.ok) {
        console.warn("[switch] Stop failed:", await stopRes.text());
      }

      // Deploy the new character
      const res = await fetch(`${API_URL}/agent/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          walletAddress,
          characterName: char.name,
          raceId: char.properties.race,
          classId: char.properties.class,
        }),
      });
      const data = await res.json();
      if (res.ok && data.custodialWallet) {
        WalletManager.getInstance().setCustodialAddress(data.custodialWallet);
      }

      // Focus camera on the new character's zone + lock to them
      if (res.ok && data.zoneId) {
        gameBus.emit("switchZone", { zoneId: data.zoneId });
      }
      gameBus.emit("lockToPlayer", { walletAddress });
    } catch {
      // silent
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="space-y-1 border-2 border-[#29334d] bg-[#11182b] p-2">
      <div className="flex items-center justify-between">
        <span className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">Character</span>
        <Badge variant="secondary">
          {switching ? "Switching..." : characterProgress ? (characterProgress.source === "live" ? "Live" : "NFT") : "--"}
        </Badge>
      </div>
      {switching ? (
        <p className="text-[8px] text-[#9aa7cc]">Switching character...</p>
      ) : characterProgress ? (
        <div className="space-y-1">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={focusCharacter}
              className="flex-1 text-left cursor-pointer rounded border-2 border-[#29334d] bg-[#0a0f1e] px-2 py-1 transition-colors hover:border-[#54f28b] hover:bg-[#10182b]"
              title="Click to center the camera on your character"
            >
              <div className="mb-1 flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {characterProgress.source === "live" && (
                      <span className="text-[8px] font-bold uppercase tracking-wide text-[#54f28b]">[live]</span>
                    )}
                    <span className="min-w-0 break-words text-[9px] leading-tight text-[#f1f5ff]">{activeCharacterName}</span>
                  </div>
                  {(activeCharacterRace || activeCharacterClass) && (
                    <div className="mt-0.5 break-words text-[8px] leading-tight text-[#9aa7cc]">
                      {[activeCharacterRace, activeCharacterClass].filter(Boolean).join(" • ")}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                  {activeCharacterLevel != null && (
                    <span className="text-[8px] font-bold text-[#ffcc00]">L{activeCharacterLevel}</span>
                  )}
                  <span className="text-[8px] font-bold uppercase tracking-wide text-[#54f28b]">
                    Center
                  </span>
                </div>
              </div>
              <HpBar hp={characterProgress.hp} maxHp={characterProgress.maxHp} />
              <XpBar level={characterProgress.level} xp={characterProgress.xp} />
            </button>
            {characters.length > 1 && (
              <button
                type="button"
                onClick={() => setShowSwapMenu((prev) => !prev)}
                disabled={switching}
                className="shrink-0 border-2 border-[#ffcc00]/40 bg-[#1e1a10] px-2 py-1 text-[8px] font-bold uppercase tracking-wide text-[#ffcc00] transition hover:bg-[#2a2418] disabled:opacity-40"
                title="Choose a different character"
              >
                {showSwapMenu ? "Hide" : "Swap"}
              </button>
            )}
          </div>
          {showSwapMenu && characters.length > 1 && (
            <select
              className="w-full border-2 border-[#29334d] bg-[#0a0f1e] px-1 py-0.5 text-[8px] text-[#f1f5ff] outline-none focus:border-[#54f28b]"
              value={selectedCharacterTokenId ?? ""}
              disabled={switching}
              onChange={(e) => {
                const tokenId = e.target.value || null;
                setShowSwapMenu(false);
                selectCharacter(tokenId);
                if (tokenId && tokenId !== selectedCharacterTokenId) {
                  void handleSwitch(tokenId);
                }
              }}
            >
              {characters.length > 1 && (
                <option value="">
                  {deployedCharacterName ? `${deployedCharacterName} (active)` : "None"}
                </option>
              )}
              {characters.map((c) => {
                const baseName = c.name.replace(/\s+the\s+\w+$/i, "").trim();
                const isDeployed = deployedCharacterName && (baseName === deployedCharacterName || c.name === deployedCharacterName);
                return (
                  <option key={c.tokenId} value={c.tokenId}>
                    {isDeployed ? "[LIVE] " : ""}{c.name} — L{c.properties.level} {c.properties.race} {c.properties.class}
                  </option>
                );
              })}
            </select>
          )}
        </div>
      ) : characterLoading ? (
        <p className="text-[8px] text-[#9aa7cc]">Syncing character...</p>
      ) : characters.length > 0 ? (
        <div className="space-y-1">
          <div className="flex gap-2">
            <div className="flex-1 rounded border-2 border-[#29334d] bg-[#0a0f1e] px-2 py-1">
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 break-words text-[9px] leading-tight text-[#f1f5ff]">{activeCharacterName}</span>
                {activeCharacterLevel != null && (
                  <span className="shrink-0 text-[8px] font-bold text-[#ffcc00]">L{activeCharacterLevel}</span>
                )}
              </div>
              {(activeCharacterRace || activeCharacterClass) && (
                <div className="mt-0.5 break-words text-[8px] leading-tight text-[#9aa7cc]">
                  {[activeCharacterRace, activeCharacterClass].filter(Boolean).join(" • ")}
                </div>
              )}
            </div>
            {characters.length > 1 && (
              <button
                type="button"
                onClick={() => setShowSwapMenu((prev) => !prev)}
                disabled={switching}
                className="shrink-0 border-2 border-[#ffcc00]/40 bg-[#1e1a10] px-2 py-1 text-[8px] font-bold uppercase tracking-wide text-[#ffcc00] transition hover:bg-[#2a2418] disabled:opacity-40"
                title="Choose a different character"
              >
                {showSwapMenu ? "Hide" : "Swap"}
              </button>
            )}
          </div>
          {showSwapMenu && characters.length > 1 && (
            <select
              className="w-full border-2 border-[#29334d] bg-[#0a0f1e] px-1 py-0.5 text-[8px] text-[#f1f5ff] outline-none focus:border-[#54f28b]"
              value={selectedCharacterTokenId ?? ""}
              disabled={switching}
              onChange={(e) => {
                const tokenId = e.target.value || null;
                setShowSwapMenu(false);
                selectCharacter(tokenId);
                if (tokenId && tokenId !== selectedCharacterTokenId) {
                  void handleSwitch(tokenId);
                }
              }}
            >
              {characters.length > 1 && (
                <option value="">
                  {deployedCharacterName ? `${deployedCharacterName} (active)` : "None"}
                </option>
              )}
              {characters.map((c) => {
                const baseName = c.name.replace(/\s+the\s+\w+$/i, "").trim();
                const isDeployed = deployedCharacterName && (baseName === deployedCharacterName || c.name === deployedCharacterName);
                return (
                  <option key={c.tokenId} value={c.tokenId}>
                    {isDeployed ? "[LIVE] " : ""}{c.name} — L{c.properties.level} {c.properties.race} {c.properties.class}
                  </option>
                );
              })}
            </select>
          )}
          <p className="text-[8px] text-[#9aa7cc]">Character not live. Use Swap to deploy one.</p>
        </div>
      ) : (
        <p className="text-[8px] text-[#9aa7cc]">No character data.</p>
      )}
    </div>
  );
}

export function WalletPanel({ className }: { className?: string } = {}): React.ReactElement {
  const [collapsed, setCollapsed] = React.useState(false);
  const [tier, setTier] = React.useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = React.useState(() => {
    try {
      return window.localStorage.getItem(LS_SOUND) !== "0";
    } catch {
      return true;
    }
  });
  const [musicMuted, setMusicMuted] = React.useState(() => {
    try {
      return window.localStorage.getItem(LS_MUSIC_MUTED) === "1";
    } catch {
      return false;
    }
  });
  const [isFullscreen, setIsFullscreen] = React.useState(() => {
    if (typeof document === "undefined") return false;
    return Boolean(document.fullscreenElement);
  });
  const {
    address,
    balance,
    isConnected,
    characterProgress,
    characterLoading,
    characters,
    selectedCharacterTokenId,
    deployedCharacterName,
    selectCharacter,
    disconnect,
  } = useWallet();
  const { dn } = useWogNames(address ? [address] : []);

  React.useEffect(() => {
    if (!address) { setTier(null); return; }
    fetch(`${API_URL}/agent/tier/${address}`).then(r => r.json()).then(d => setTier(d.tier ?? "free")).catch(() => setTier(null));
  }, [address]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const updateFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const syncFromStorage = () => {
      try {
        setSoundEnabled(window.localStorage.getItem(LS_SOUND) !== "0");
        setMusicMuted(window.localStorage.getItem(LS_MUSIC_MUTED) === "1");
      } catch {
        // noop
      }
    };

    window.addEventListener("storage", syncFromStorage);
    window.addEventListener("wog:sound-toggle", syncFromStorage as EventListener);
    window.addEventListener(MUSIC_TOGGLE_EVENT, syncFromStorage as EventListener);
    return () => {
      window.removeEventListener("storage", syncFromStorage);
      window.removeEventListener("wog:sound-toggle", syncFromStorage as EventListener);
      window.removeEventListener(MUSIC_TOGGLE_EVENT, syncFromStorage as EventListener);
    };
  }, []);

  const toggleAudioMute = React.useCallback(() => {
    playSoundEffect("ui_button_click");
    try {
      const nextSoundEnabled = !soundEnabled;
      const nextMusicMuted = !musicMuted;
      window.localStorage.setItem(LS_SOUND, nextSoundEnabled ? "1" : "0");
      window.localStorage.setItem(LS_MUSIC_MUTED, nextMusicMuted ? "1" : "0");
      setSoundEnabled(nextSoundEnabled);
      setMusicMuted(nextMusicMuted);
      window.dispatchEvent(new CustomEvent("wog:sound-toggle", { detail: { enabled: nextSoundEnabled } }));
      window.dispatchEvent(new CustomEvent(MUSIC_TOGGLE_EVENT, { detail: { muted: nextMusicMuted } }));
    } catch {
      // noop
    }
  }, [musicMuted, soundEnabled]);

  const toggleFullscreen = React.useCallback(async () => {
    playSoundEffect("ui_button_click");
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // noop
    }
  }, []);

  const audioMuted = !soundEnabled && musicMuted;
  const actionTileClass = "flex min-h-8 items-center justify-center border-2 px-2.5 py-1 text-center text-[7px] uppercase tracking-wide transition sm:text-[8px]";

  // Don't render the panel at all when not connected — the Navbar handles sign-in
  if (!isConnected) return <></>;

  return (
    <Card
      className={cn(
        "pointer-events-auto flex h-full min-h-0 w-full max-w-none flex-col overflow-hidden",
        className,
      )}
      data-tutorial-id="wallet-panel"
    >
      <CardHeader className="shrink-0 pb-2">
        <CardTitle className="flex items-center justify-between text-sm md:text-base">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="text-[10px] text-[#9aa7cc] hover:text-[#edf2ff] transition-colors"
              type="button"
            >
              {collapsed ? "+" : "−"}
            </button>
            Inventory
          </div>
        </CardTitle>
      </CardHeader>
      {!collapsed && <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto text-[9px]">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">Address</span>
          <div className="flex min-w-0 items-center gap-1">
            <Badge className="min-w-0 max-w-[11rem] truncate">{address ? dn(address) : "..."}</Badge>
            <button
              onClick={disconnect}
              className="border-2 border-[#ff4444]/40 bg-[#2a1010] px-1.5 py-0.5 text-[7px] uppercase tracking-wide text-[#ff4444] transition hover:bg-[#3d1818]"
              type="button"
              title="Disconnect wallet"
            >
              X
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">Gold</span>
          <div className="bg-[#1a2a10] border-2 border-[#54f28b] px-1.5 py-0.5 shadow-[2px_2px_0_0_#000]">
            {balance?.gold ? (
              <CurrencyDisplay amount={balance.gold} size="sm" />
            ) : (
              <span className="text-[8px] text-black">...</span>
            )}
          </div>
        </div>
        {tier && (
          <div className="flex items-center justify-between">
            <span className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">Plan</span>
            <Link
              to="/champions"
              className="border-2 px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wide cursor-pointer transition hover:brightness-125"
              style={{ color: TIER_COLORS[tier] ?? "#9aa7cc", borderColor: (TIER_COLORS[tier] ?? "#9aa7cc") + "44", backgroundColor: (TIER_COLORS[tier] ?? "#9aa7cc") + "11" }}
            >
              {tier} ↗
            </Link>
          </div>
        )}
        <CharacterSection
          characters={characters}
          characterProgress={characterProgress}
          characterLoading={characterLoading}
          selectedCharacterTokenId={selectedCharacterTokenId}
          deployedCharacterName={deployedCharacterName}
          selectCharacter={selectCharacter}
          walletAddress={address!}
        />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-2 pt-1">
          <Link
            to="/champions"
            className={cn(actionTileClass, "border-[#ffcc00]/60 bg-[#2a2210] text-[#ffcc00] hover:bg-[#3d3218]")}
          >
            View Champion
          </Link>
          <button
            type="button"
            onClick={() => gameBus.emit("inventoryOpen", undefined as never)}
            className={cn(actionTileClass, "border-[#b48efa]/40 bg-[#1a1028] text-[#b48efa] hover:bg-[#251840]")}
          >
            Bag
          </button>
          <button
            type="button"
            onClick={() => gameBus.emit("characterOpen", undefined as never)}
            className={cn(actionTileClass, "border-[#c83232]/40 bg-[#1e1010] text-[#c83232] hover:bg-[#2a1818]")}
          >
            Character
          </button>
          <button
            type="button"
            onClick={() => {
              if (address) {
                const zoneId = characterProgress?.zoneId;
                if (zoneId) {
                  gameBus.emit("inspectSelf", { zoneId, walletAddress: address });
                } else {
                  // No known zone — scan all zones for this player
                  fetch(`${API_URL}/zones`).then(r => r.json()).then(zones => {
                    const zoneIds = Object.keys(zones);
                    for (const zid of zoneIds) {
                      fetch(`${API_URL}/zones/${zid}`).then(r => r.json()).then(data => {
                        const entities = data.entities as Record<string, any> | undefined;
                        if (!entities) return;
                        const normalized = address.toLowerCase();
                        const custodial = WalletManager.getInstance().custodialAddress?.toLowerCase();
                        const self = Object.values(entities).find(e => {
                          if (e.type !== "player") return false;
                          const ew = e.walletAddress?.toLowerCase();
                          return ew === normalized || (custodial && ew === custodial);
                        });
                        if (self) gameBus.emit("inspectSelf", { zoneId: zid, walletAddress: address });
                      }).catch(() => {});
                    }
                  }).catch(() => {});
                }
              }
            }}
            disabled={!address}
            className={cn(actionTileClass, "border-[#ffcc00]/40 bg-[#1e1a10] text-[#ffcc00] hover:bg-[#2a2418] disabled:cursor-not-allowed disabled:opacity-40")}
          >
            Inspect
          </button>
          <button
            type="button"
            onClick={() => gameBus.emit("inboxOpen", undefined as never)}
            className={cn(actionTileClass, "border-[#6ea8fe]/40 bg-[#101a2e] text-[#6ea8fe] hover:bg-[#1a2840]")}
          >
            Inbox
          </button>
          <button
            type="button"
            onClick={() => gameBus.emit("settingsOpen", undefined as never)}
            className={cn(actionTileClass, "border-[#9aa7cc]/40 bg-[#101a2e] text-[#9aa7cc] hover:bg-[#1a2840]")}
          >
            Settings
          </button>
          <button
            type="button"
            onClick={toggleAudioMute}
            className={cn(actionTileClass, "border-[#54f28b]/40 bg-[#0f1e10] text-[#54f28b] hover:bg-[#1a2e18]")}
          >
            {audioMuted ? "Unmute" : "Mute"}
          </button>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className={cn(actionTileClass, "border-[#6ea8fe]/40 bg-[#101a2e] text-[#6ea8fe] hover:bg-[#1a2840]")}
          >
            {isFullscreen ? "Window" : "Fullscreen"}
          </button>
        </div>
      </CardContent>}
    </Card>
  );
}
