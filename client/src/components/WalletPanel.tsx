import * as React from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { HpBar } from "@/components/ui/hp-bar";
import { Spinner } from "@/components/ui/spinner";

import { XpBar } from "@/components/ui/xp-bar";
import { API_URL } from "@/config";
import { useWallet } from "@/hooks/useWallet";
import { useWogNames } from "@/hooks/useWogNames";

const TIER_COLORS: Record<string, string> = {
  free: "#9aa7cc",
  starter: "#54f28b",
  pro: "#ffcc00",
};

export function WalletPanel(): React.ReactElement {
  const [collapsed, setCollapsed] = React.useState(false);
  const [tier, setTier] = React.useState<string | null>(null);
  const {
    address,
    balance,
    isConnected,
    loading,
    characterProgress,
    characterLoading,
    characters,
    selectedCharacterTokenId,
    selectCharacter,
    connect,
    disconnect,
  } = useWallet();
  const { dn } = useWogNames(address ? [address] : []);

  React.useEffect(() => {
    if (!address) { setTier(null); return; }
    fetch(`${API_URL}/agent/tier/${address}`).then(r => r.json()).then(d => setTier(d.tier ?? "free")).catch(() => setTier(null));
  }, [address]);

  return (
    <Card className="pointer-events-auto absolute right-2 top-12 z-30 w-48 sm:w-56 md:w-64 lg:w-80 max-w-[45vw] max-h-[45vh] overflow-auto md:right-4 md:top-4">
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
            Wallet
          </div>
        </CardTitle>
        {!collapsed && <CardDescription className="text-xs">Spectator inventory</CardDescription>}
      </CardHeader>
      {!collapsed && <CardContent className="space-y-3 text-[9px]">
        {!isConnected ? (
          <Button
            className="w-full"
            disabled={loading}
            onClick={() => {
              void connect().catch(() => undefined);
            }}
            type="button"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Spinner />
                Connecting
              </span>
            ) : (
              "Connect Wallet"
            )}
          </Button>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">Address</span>
              <div className="flex items-center gap-1">
                <Badge>{dn(address!)}</Badge>
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
              <div className="bg-[#54f28b] border-2 border-black px-1.5 py-0.5 shadow-[2px_2px_0_0_#000]">
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
            <div className="space-y-1 border-2 border-[#29334d] bg-[#11182b] p-2">
              <div className="flex items-center justify-between">
                <span className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">Character</span>
                <Badge variant="secondary">
                  {characterProgress ? (characterProgress.source === "live" ? "Live" : "NFT") : "--"}
                </Badge>
              </div>
              {characters.length > 1 && (
                <select
                  className="w-full border-2 border-[#29334d] bg-[#0a0f1e] px-1 py-0.5 text-[8px] text-[#f1f5ff] outline-none focus:border-[#54f28b]"
                  value={selectedCharacterTokenId ?? ""}
                  onChange={(e) => selectCharacter(e.target.value || null)}
                >
                  <option value="">Auto (highest level)</option>
                  {characters.map((c) => (
                    <option key={c.tokenId} value={c.tokenId}>
                      {c.name} — L{c.properties.level} {c.properties.race} {c.properties.class}
                    </option>
                  ))}
                </select>
              )}
              {characterLoading ? (
                <p className="text-[8px] text-[#9aa7cc]">Syncing character...</p>
              ) : characterProgress ? (
                <>
                  <p className="truncate text-[8px] text-[#f1f5ff]">{characterProgress.name}</p>
                  <HpBar hp={characterProgress.hp} maxHp={characterProgress.maxHp} />
                  <XpBar level={characterProgress.level} xp={characterProgress.xp} />
                </>
              ) : (
                <p className="text-[8px] text-[#9aa7cc]">No character data.</p>
              )}
            </div>
            <Link
              to="/champions"
              className="flex w-full items-center justify-center gap-1 border-2 border-[#ffcc00]/60 bg-[#2a2210] px-3 py-1.5 text-[8px] uppercase tracking-wide text-[#ffcc00] transition hover:bg-[#3d3218]"
            >
              View Champion
            </Link>
          </>
        )}
      </CardContent>}
    </Card>
  );
}
