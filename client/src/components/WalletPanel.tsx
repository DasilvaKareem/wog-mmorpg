import * as React from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { HpBar } from "@/components/ui/hp-bar";

import { XpBar } from "@/components/ui/xp-bar";
import { API_URL } from "@/config";
import { useWallet } from "@/hooks/useWallet";
import { useWogNames } from "@/hooks/useWogNames";
import { gameBus } from "@/lib/eventBus";
import { getAuthToken } from "@/lib/agentAuth";
import { WalletManager } from "@/lib/walletManager";

const TIER_COLORS: Record<string, string> = {
  free: "#9aa7cc",
  starter: "#54f28b",
  pro: "#ffcc00",
};

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
      {characters.length > 0 && (
        <select
          className="w-full border-2 border-[#29334d] bg-[#0a0f1e] px-1 py-0.5 text-[8px] text-[#f1f5ff] outline-none focus:border-[#54f28b]"
          value={selectedCharacterTokenId ?? ""}
          disabled={switching}
          onChange={(e) => {
            const tokenId = e.target.value || null;
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
      {switching ? (
        <p className="text-[8px] text-[#9aa7cc]">Switching character...</p>
      ) : characterProgress ? (
        <button
          type="button"
          onClick={focusCharacter}
          className="w-full text-left cursor-pointer hover:bg-[#1a2440] transition-colors rounded px-1 py-0.5 -mx-1"
          title="Click to focus camera on character"
        >
          <HpBar hp={characterProgress.hp} maxHp={characterProgress.maxHp} />
          <XpBar level={characterProgress.level} xp={characterProgress.xp} />
        </button>
      ) : characterLoading ? (
        <p className="text-[8px] text-[#9aa7cc]">Syncing character...</p>
      ) : (
        <p className="text-[8px] text-[#9aa7cc]">No character data.</p>
      )}
    </div>
  );
}

export function WalletPanel(): React.ReactElement {
  const [collapsed, setCollapsed] = React.useState(false);
  const [tier, setTier] = React.useState<string | null>(null);
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

  // USDC balance on Base (for Tempo/MPP payments)
  const [usdcBalance, setUsdcBalance] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!address) { setUsdcBalance(null); return; }
    // Fetch USDC balance from Base chain (or Base Sepolia for testnet)
    const usdcContract = import.meta.env.VITE_MPP_CURRENCY_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    const rpcUrl = import.meta.env.VITE_MPP_RPC_URL || "https://sepolia.base.org";
    // ERC-20 balanceOf(address) call
    const data = "0x70a08231" + address.slice(2).padStart(64, "0");
    fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: usdcContract, data }, "latest"] }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (res.result && res.result !== "0x") {
          const raw = BigInt(res.result);
          // USDC has 6 decimals
          const dollars = Number(raw) / 1e6;
          setUsdcBalance(dollars.toFixed(2));
        } else {
          setUsdcBalance("0.00");
        }
      })
      .catch(() => setUsdcBalance(null));
  }, [address]);

  // Don't render the panel at all when not connected — the Navbar handles sign-in
  if (!isConnected) return <></>;

  return (
    <Card
      className="pointer-events-auto absolute right-2 top-12 z-30 w-48 sm:w-56 md:w-64 lg:w-80 max-w-[45vw] max-h-[45vh] overflow-auto md:right-4 md:top-4"
      data-tutorial-id="wallet-panel"
    >
      <CardHeader className="pb-2">
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
      {!collapsed && <CardContent className="space-y-3 text-[9px]">
        <div className="flex items-center justify-between">
          <span className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">Address</span>
          <div className="flex items-center gap-1">
            <Badge>{address ? dn(address) : "..."}</Badge>
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
        {usdcBalance !== null && (
          <div className="flex items-center justify-between">
            <span className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">USDC</span>
            <div className="bg-[#0a1a2a] border-2 border-[#5dadec] px-1.5 py-0.5 shadow-[2px_2px_0_0_#000]">
              <span className="text-[9px] font-bold text-[#5dadec]">${usdcBalance}</span>
            </div>
          </div>
        )}
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
        <div className="flex gap-2">
          <Link
            to="/champions"
            className="flex flex-1 items-center justify-center gap-1 border-2 border-[#ffcc00]/60 bg-[#2a2210] px-3 py-1.5 text-[8px] uppercase tracking-wide text-[#ffcc00] transition hover:bg-[#3d3218]"
          >
            View Champion
          </Link>
          <button
            type="button"
            onClick={() => gameBus.emit("inventoryOpen", undefined as never)}
            className="flex-1 border-2 border-[#b48efa]/40 bg-[#1a1028] px-3 py-1.5 text-[8px] uppercase tracking-wide text-[#b48efa] transition hover:bg-[#251840]"
          >
            Bag
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => gameBus.emit("characterOpen", undefined as never)}
            className="flex-1 border-2 border-[#c83232]/40 bg-[#1e1010] px-3 py-1.5 text-[8px] uppercase tracking-wide text-[#c83232] transition hover:bg-[#2a1818]"
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
            className="flex-1 border-2 border-[#ffcc00]/40 bg-[#1e1a10] px-3 py-1.5 text-[8px] uppercase tracking-wide text-[#ffcc00] transition hover:bg-[#2a2418] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Inspect
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => gameBus.emit("inboxOpen", undefined as never)}
            className="flex-1 border-2 border-[#6ea8fe]/40 bg-[#101a2e] px-3 py-1.5 text-[8px] uppercase tracking-wide text-[#6ea8fe] transition hover:bg-[#1a2840]"
          >
            Inbox
          </button>
          <button
            type="button"
            onClick={() => gameBus.emit("settingsOpen", undefined as never)}
            className="flex-1 border-2 border-[#9aa7cc]/40 bg-[#101a2e] px-3 py-1.5 text-[8px] uppercase tracking-wide text-[#9aa7cc] transition hover:bg-[#1a2840]"
          >
            Settings
          </button>
        </div>
      </CardContent>}
    </Card>
  );
}
