import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HpBar } from "@/components/ui/hp-bar";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { XpBar } from "@/components/ui/xp-bar";
import { useWallet } from "@/hooks/useWallet";

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function WalletPanel(): React.ReactElement {
  const [equippingTokenId, setEquippingTokenId] = React.useState<string | null>(null);
  const {
    address,
    balance,
    isConnected,
    loading,
    characterProgress,
    characterLoading,
    connect,
    equipItem,
  } = useWallet();
  const { notify } = useToast();

  return (
    <Card className="pointer-events-auto absolute right-4 top-4 z-30 w-80">
      <CardHeader className="pb-2">
        <CardTitle>Wallet</CardTitle>
        <CardDescription>Spectator inventory</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-[9px]">
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
              <Badge>{truncateAddress(address!)}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">Gold</span>
              <Badge variant="success">{balance?.gold ?? "..."}</Badge>
            </div>
            <div className="space-y-1 border-2 border-[#29334d] bg-[#11182b] p-2">
              <div className="flex items-center justify-between">
                <span className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">Character</span>
                <Badge variant="secondary">
                  {characterProgress ? (characterProgress.source === "live" ? "Live" : "NFT") : "--"}
                </Badge>
              </div>
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
            <div>
              <p className="mb-1 text-[8px] uppercase tracking-wide text-[#9aa7cc]">Items</p>
              <div className="max-h-24 space-y-1 overflow-auto pr-1">
                {balance?.items?.length ? (
                  balance.items.map((item) => (
                    <div
                      className="flex items-center justify-between gap-2 border-2 border-[#29334d] bg-[#11182b] px-2 py-1 text-[8px]"
                      key={`${item.tokenId}-${item.name}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[#f1f5ff]">{item.name}</p>
                        <p className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">
                          x{item.balance}
                          {item.equipSlot ? `  |  ${item.equipSlot}` : ""}
                          {item.maxDurability ? `  |  dura ${item.maxDurability}` : ""}
                        </p>
                      </div>
                      {item.equipSlot ? (
                        <Button
                          className="h-6 px-2 text-[7px]"
                          disabled={equippingTokenId === item.tokenId}
                          onClick={() => {
                            const tokenId = Number(item.tokenId);
                            if (!Number.isFinite(tokenId)) return;
                            setEquippingTokenId(item.tokenId);
                            void equipItem(tokenId)
                              .then((ok) => {
                                notify(
                                  ok
                                    ? `Equipped ${item.name} (${item.equipSlot}).`
                                    : `Could not equip ${item.name}.`,
                                  ok ? "success" : "error"
                                );
                              })
                              .finally(() => {
                                setEquippingTokenId(null);
                              });
                          }}
                          type="button"
                          variant="secondary"
                        >
                          Equip
                        </Button>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-[8px] text-[#9aa7cc]">No items</p>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
