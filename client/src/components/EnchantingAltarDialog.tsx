import * as React from "react";

import { API_URL } from "@/config";
import { fetchZone } from "@/ShardClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWalletContext } from "@/context/WalletContext";
import { useGameBridge } from "@/hooks/useGameBridge";
import { getAuthToken } from "@/lib/agentAuth";
import { playSoundEffect } from "@/lib/soundEffects";
import { WalletManager } from "@/lib/walletManager";
import type { Entity } from "@/types";

type GateRank = NonNullable<Entity["gateRank"]>;

interface InventoryItem {
  tokenId: number;
  name: string;
  quantity: number;
}

interface DungeonKeyRecipe {
  rank: GateRank;
  requiredLevel: number;
  key: { tokenId: string; name: string };
  reagent: { tokenId: string; name: string };
}

interface ForgeContext {
  entityId: string;
  itemWallet: string;
  walletCandidates: string[];
}

interface JsonResult {
  ok: boolean;
  data: any;
}

const RANK_ORDER: GateRank[] = ["E", "D", "C", "B", "A", "S"];

async function readJson(res: Response): Promise<JsonResult> {
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, data };
}

export function EnchantingAltarDialog(): React.ReactElement | null {
  const { address } = useWalletContext();
  const [open, setOpen] = React.useState(false);
  const [altar, setAltar] = React.useState<Entity | null>(null);
  const [currentZoneId, setCurrentZoneId] = React.useState("village-square");
  const [forgeContext, setForgeContext] = React.useState<ForgeContext | null>(null);
  const [recipes, setRecipes] = React.useState<DungeonKeyRecipe[]>([]);
  const [inventory, setInventory] = React.useState<Record<number, number>>({});
  const [loading, setLoading] = React.useState(false);
  const [busyRank, setBusyRank] = React.useState<GateRank | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [messageTone, setMessageTone] = React.useState<"error" | "success" | null>(null);

  useGameBridge("zoneChanged", ({ zoneId }) => {
    setCurrentZoneId(zoneId);
  });

  useGameBridge("enchantingAltarClick", (entity) => {
    if (entity.type !== "enchanting-altar") return;
    setAltar(entity);
    setForgeContext(null);
    setRecipes([]);
    setInventory({});
    setMessage(null);
    setMessageTone(null);
    setOpen(true);
    playSoundEffect("ui_dialog_open");
  });

  const altarZoneId = altar?.zoneId ?? currentZoneId;

  const resolveControlledPlayer = React.useCallback(async (zoneId: string): Promise<ForgeContext> => {
    if (!address) {
      throw new Error("Connect your wallet first.");
    }

    const trackedWallet = await WalletManager.getInstance().getTrackedWalletAddress();
    const normalizedOwner = address.toLowerCase();
    const normalizedTracked = trackedWallet?.toLowerCase() ?? null;
    const zone = await fetchZone(zoneId);
    if (!zone) {
      throw new Error("Could not load the current zone.");
    }

    const candidates = [normalizedTracked, normalizedOwner].filter(Boolean) as string[];
    const player = Object.values(zone.entities).find((entity) => {
      if (entity.type !== "player") return false;
      const wallet = entity.walletAddress?.toLowerCase();
      return !!wallet && candidates.includes(wallet);
    });

    if (!player?.walletAddress) {
      throw new Error("Could not find your champion near this altar.");
    }

    const walletCandidates = Array.from(
      new Set([player.walletAddress, trackedWallet, address].filter(Boolean) as string[])
    );

    return {
      entityId: player.id,
      itemWallet: player.walletAddress,
      walletCandidates,
    };
  }, [address]);

  const loadForgeState = React.useCallback(async (zoneId: string) => {
    const context = await resolveControlledPlayer(zoneId);
    const [inventoryRes, keysRes] = await Promise.all([
      fetch(`${API_URL}/inventory/${context.itemWallet}`),
      fetch(`${API_URL}/dungeon/keys`),
    ]);

    const inventoryJson = inventoryRes.ok ? await inventoryRes.json() : { items: [] };
    const keysJson = keysRes.ok ? await keysRes.json() : [];
    const nextInventory: Record<number, number> = {};
    for (const item of (inventoryJson.items ?? []) as InventoryItem[]) {
      nextInventory[item.tokenId] = item.quantity;
    }

    const nextRecipes = (Array.isArray(keysJson) ? keysJson : [])
      .filter((recipe): recipe is DungeonKeyRecipe => RANK_ORDER.includes(recipe?.rank))
      .sort((left, right) => RANK_ORDER.indexOf(left.rank) - RANK_ORDER.indexOf(right.rank));

    setForgeContext(context);
    setInventory(nextInventory);
    setRecipes(nextRecipes);
  }, [resolveControlledPlayer]);

  React.useEffect(() => {
    if (!open || !altar) return;

    let cancelled = false;
    setLoading(true);
    setMessage(null);
    setMessageTone(null);

    void (async () => {
      try {
        await loadForgeState(altarZoneId);
      } catch (error) {
        if (!cancelled) {
          setForgeContext(null);
          setRecipes([]);
          setInventory({});
          setMessageTone("error");
          setMessage(error instanceof Error ? error.message : "Failed to load altar data.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [altar, altarZoneId, loadForgeState, open]);

  const handleForge = React.useCallback(async (recipe: DungeonKeyRecipe) => {
    if (!address || !altar || !forgeContext) return;

    setBusyRank(recipe.rank);
    setMessage(null);
    setMessageTone(null);

    try {
      const token = await getAuthToken(address);
      if (!token) {
        throw new Error("Failed to authenticate. Try reconnecting your wallet.");
      }

      let lastError = `Failed to forge ${recipe.key.name}.`;
      for (const walletAddress of forgeContext.walletCandidates) {
        const res = await fetch(`${API_URL}/dungeon/forge-key`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            walletAddress,
            zoneId: altarZoneId,
            entityId: forgeContext.entityId,
            altarId: altar.id,
            reagentTokenId: Number(recipe.reagent.tokenId),
          }),
        });
        const { ok, data } = await readJson(res);
        if (!ok) {
          lastError = data?.error ?? lastError;
          continue;
        }

        await loadForgeState(altarZoneId);
        setMessageTone("success");
        setMessage(`Forged ${recipe.key.name} from ${recipe.reagent.name}.`);
        playSoundEffect("ui_notification");
        return;
      }

      throw new Error(lastError);
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : `Failed to forge ${recipe.key.name}.`);
    } finally {
      setBusyRank(null);
    }
  }, [address, altar, altarZoneId, forgeContext, loadForgeState]);

  if (!altar) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="border-2 border-black bg-[#120d22] p-0 font-mono text-[#f6f1ff] shadow-[8px_8px_0_0_#000] sm:max-w-[720px]">
        <DialogHeader className="border-b-2 border-[#2c2354] bg-[#1a1433] px-5 py-4 text-left">
          <DialogTitle className="text-base font-bold uppercase tracking-[0.24em] text-[#dcc7ff]">
            Enchanter&apos;s Altar
          </DialogTitle>
          <DialogDescription className="mt-1 text-[11px] leading-5 text-[#b8abd9]">
            Convert brewed gate essences into dungeon keys. You must be close to the altar, and the key is forged on the wallet holding the reagent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-3 rounded border-2 border-[#2c2354] bg-[#120f20] p-3 text-[10px] uppercase tracking-[0.18em] text-[#9f93c4] sm:grid-cols-3">
            <div>
              <div className="text-[#796ca7]">Altar</div>
              <div className="mt-1 text-[11px] text-[#f6f1ff]">{altar.name}</div>
            </div>
            <div>
              <div className="text-[#796ca7]">Zone</div>
              <div className="mt-1 text-[11px] text-[#f6f1ff]">{altarZoneId}</div>
            </div>
            <div>
              <div className="text-[#796ca7]">Inventory Wallet</div>
              <div className="mt-1 break-all text-[11px] text-[#f6f1ff]">
                {forgeContext?.itemWallet ?? "Resolving..."}
              </div>
            </div>
          </div>

          {message && (
            <div
              className="border px-3 py-2 text-[11px]"
              style={{
                borderColor: messageTone === "error" ? "#7a2f3f" : "#23533b",
                background: messageTone === "error" ? "#2b1218" : "#11261a",
                color: messageTone === "error" ? "#ffb9c2" : "#c6ffd8",
              }}
            >
              {message}
            </div>
          )}

          {loading ? (
            <div className="rounded border-2 border-dashed border-[#3e3568] px-4 py-8 text-center text-[11px] uppercase tracking-[0.24em] text-[#b8abd9]">
              Loading forge options...
            </div>
          ) : recipes.length === 0 ? (
            <div className="rounded border-2 border-dashed border-[#3e3568] px-4 py-8 text-center text-[11px] uppercase tracking-[0.18em] text-[#b8abd9]">
              No dungeon key recipes available.
            </div>
          ) : (
            <div className="space-y-3">
              {recipes.map((recipe) => {
                const reagentTokenId = Number(recipe.reagent.tokenId);
                const owned = inventory[reagentTokenId] ?? 0;
                const canForge = owned > 0 && busyRank === null && !!forgeContext;

                return (
                  <div
                    key={recipe.rank}
                    className="grid gap-3 rounded border-2 border-[#30265f] bg-[#17112d] p-3 sm:grid-cols-[1.1fr_1fr_auto]"
                  >
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.22em] text-[#9f93c4]">
                        Rank {recipe.rank}
                      </div>
                      <div className="mt-1 text-sm font-bold text-[#f6f1ff]">{recipe.key.name}</div>
                      <div className="mt-1 text-[11px] leading-5 text-[#c7bdf0]">
                        Requires level {recipe.requiredLevel} dungeon access.
                      </div>
                    </div>

                    <div className="rounded border border-[#3f356f] bg-[#120d22] px-3 py-2 text-[11px]">
                      <div className="uppercase tracking-[0.18em] text-[#8879bc]">Reagent</div>
                      <div className="mt-1 font-bold text-[#f6f1ff]">{recipe.reagent.name}</div>
                      <div className="mt-2 text-[#c7bdf0]">
                        Owned: <span className={owned > 0 ? "text-[#7effb0]" : "text-[#ff9aa9]"}>{owned}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => void handleForge(recipe)}
                        disabled={!canForge}
                        className="border-2 border-black px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] shadow-[4px_4px_0_0_#000] transition hover:translate-y-[1px] hover:shadow-[3px_3px_0_0_#000] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-[4px_4px_0_0_#000]"
                        style={{
                          background: owned > 0 ? "#5e2ca5" : "#3b315c",
                          color: owned > 0 ? "#f7f0ff" : "#9f93c4",
                        }}
                      >
                        {busyRank === recipe.rank ? "Forging..." : `Forge ${recipe.key.name}`}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
