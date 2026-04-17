import * as React from "react";

import { API_URL } from "@/config";
import { fetchZone, type ProfessionSkillDetail } from "@/ShardClient";
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

interface InventoryItem {
  tokenId: number;
  name: string;
  quantity: number;
}

interface AlchemyRecipe {
  recipeId: string;
  output: { tokenId: string; name: string; quantity: number };
  materials: Array<{ tokenId: string; name: string; quantity: number }>;
  copperCost: number;
  requiredSkillLevel: number;
  brewingTime: number;
}

interface BrewContext {
  entityId: string;
  itemWallet: string;
}

interface JsonResult {
  ok: boolean;
  data: any;
}

const GATE_ESSENCE_RECIPES = new Set([
  "crude-gate-essence",
  "lesser-gate-essence",
  "gate-essence",
  "greater-gate-essence",
  "superior-gate-essence",
  "supreme-gate-essence",
]);

async function readJson(res: Response): Promise<JsonResult> {
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, data };
}

export function AlchemyLabDialog(): React.ReactElement | null {
  const { address, professions, refreshProfessions } = useWalletContext();
  const [open, setOpen] = React.useState(false);
  const [lab, setLab] = React.useState<Entity | null>(null);
  const [currentZoneId, setCurrentZoneId] = React.useState("village-square");
  const [brewContext, setBrewContext] = React.useState<BrewContext | null>(null);
  const [recipes, setRecipes] = React.useState<AlchemyRecipe[]>([]);
  const [inventory, setInventory] = React.useState<Record<number, number>>({});
  const [loading, setLoading] = React.useState(false);
  const [busyRecipeId, setBusyRecipeId] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [messageTone, setMessageTone] = React.useState<"error" | "success" | null>(null);

  useGameBridge("zoneChanged", ({ zoneId }) => {
    setCurrentZoneId(zoneId);
  });

  useGameBridge("alchemyLabClick", (entity) => {
    if (entity.type !== "alchemy-lab") return;
    setLab(entity);
    setBrewContext(null);
    setRecipes([]);
    setInventory({});
    setMessage(null);
    setMessageTone(null);
    setOpen(true);
    playSoundEffect("ui_dialog_open");
  });

  const labZoneId = lab?.zoneId ?? currentZoneId;
  const learnedAlchemy = professions?.learned?.includes("alchemy") ?? false;
  const alchemySkill = (professions?.skills?.alchemy as ProfessionSkillDetail | undefined)?.level ?? 1;

  const resolveControlledPlayer = React.useCallback(async (zoneId: string): Promise<BrewContext> => {
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
      throw new Error("Could not find your champion near this alchemy lab.");
    }

    return {
      entityId: player.id,
      itemWallet: player.walletAddress,
    };
  }, [address]);

  const loadLabState = React.useCallback(async (zoneId: string) => {
    const context = await resolveControlledPlayer(zoneId);
    const [inventoryRes, recipesRes] = await Promise.all([
      fetch(`${API_URL}/inventory/${context.itemWallet}`),
      fetch(`${API_URL}/alchemy/recipes`),
    ]);

    const inventoryJson = inventoryRes.ok ? await inventoryRes.json() : { items: [] };
    const recipesJson = recipesRes.ok ? await recipesRes.json() : [];
    const nextInventory: Record<number, number> = {};
    for (const item of (inventoryJson.items ?? []) as InventoryItem[]) {
      nextInventory[item.tokenId] = item.quantity;
    }

    const nextRecipes = (Array.isArray(recipesJson) ? recipesJson : [])
      .filter((recipe): recipe is AlchemyRecipe => typeof recipe?.recipeId === "string")
      .sort((left, right) => {
        const leftGate = GATE_ESSENCE_RECIPES.has(left.recipeId) ? 0 : 1;
        const rightGate = GATE_ESSENCE_RECIPES.has(right.recipeId) ? 0 : 1;
        if (leftGate !== rightGate) return leftGate - rightGate;
        if (left.requiredSkillLevel !== right.requiredSkillLevel) {
          return left.requiredSkillLevel - right.requiredSkillLevel;
        }
        return left.output.name.localeCompare(right.output.name);
      });

    setBrewContext(context);
    setInventory(nextInventory);
    setRecipes(nextRecipes);
  }, [resolveControlledPlayer]);

  React.useEffect(() => {
    if (!open || !lab) return;

    let cancelled = false;
    setLoading(true);
    setMessage(null);
    setMessageTone(null);

    void (async () => {
      try {
        await loadLabState(labZoneId);
      } catch (error) {
        if (!cancelled) {
          setBrewContext(null);
          setRecipes([]);
          setInventory({});
          setMessageTone("error");
          setMessage(error instanceof Error ? error.message : "Failed to load alchemy lab.");
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
  }, [lab, labZoneId, loadLabState, open]);

  const handleBrew = React.useCallback(async (recipe: AlchemyRecipe) => {
    if (!address || !lab || !brewContext) return;

    setBusyRecipeId(recipe.recipeId);
    setMessage(null);
    setMessageTone(null);

    try {
      const token = await getAuthToken(address);
      if (!token) {
        throw new Error("Failed to authenticate. Try reconnecting your wallet.");
      }

      const res = await fetch(`${API_URL}/alchemy/brew`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          walletAddress: brewContext.itemWallet,
          zoneId: labZoneId,
          entityId: brewContext.entityId,
          alchemyLabId: lab.id,
          recipeId: recipe.recipeId,
        }),
      });
      const { ok, data } = await readJson(res);
      if (!ok) {
        throw new Error(data?.error ?? `Failed to brew ${recipe.output.name}.`);
      }

      await Promise.all([loadLabState(labZoneId), refreshProfessions()]);
      if (data?.failed) {
        setMessageTone("error");
        setMessage(data?.message ?? `${recipe.output.name} fizzled.`);
      } else {
        setMessageTone("success");
        setMessage(`Brewed ${data?.brewed?.name ?? recipe.output.name}.`);
        playSoundEffect("ui_notification");
      }
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : `Failed to brew ${recipe.output.name}.`);
    } finally {
      setBusyRecipeId(null);
    }
  }, [address, brewContext, lab, labZoneId, loadLabState, refreshProfessions]);

  if (!lab) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="border-2 border-black bg-[#0f1720] p-0 font-mono text-[#eef7ff] shadow-[8px_8px_0_0_#000] sm:max-w-[880px]">
        <DialogHeader className="border-b-2 border-[#23403f] bg-[#112322] px-5 py-4 text-left">
          <DialogTitle className="text-base font-bold uppercase tracking-[0.24em] text-[#9ef8cb]">
            Alchemy Lab
          </DialogTitle>
          <DialogDescription className="mt-1 text-[11px] leading-5 text-[#a6c4c0]">
            Brew potions, tonics, and gate essences directly from your champion&apos;s inventory. Gate essence recipes are listed first because they feed the dungeon key altar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-3 rounded border-2 border-[#23403f] bg-[#101a1c] p-3 text-[10px] uppercase tracking-[0.18em] text-[#7ea6a1] sm:grid-cols-4">
            <div>
              <div className="text-[#5d817c]">Lab</div>
              <div className="mt-1 text-[11px] text-[#eef7ff]">{lab.name}</div>
            </div>
            <div>
              <div className="text-[#5d817c]">Zone</div>
              <div className="mt-1 text-[11px] text-[#eef7ff]">{labZoneId}</div>
            </div>
            <div>
              <div className="text-[#5d817c]">Alchemy</div>
              <div className="mt-1 text-[11px] text-[#eef7ff]">
                {learnedAlchemy ? `Learned · Lv ${alchemySkill}` : "Not learned"}
              </div>
            </div>
            <div>
              <div className="text-[#5d817c]">Inventory Wallet</div>
              <div className="mt-1 break-all text-[11px] text-[#eef7ff]">
                {brewContext?.itemWallet ?? "Resolving..."}
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

          {!learnedAlchemy && !loading && (
            <div className="border border-[#6a4a1b] bg-[#271b0d] px-3 py-2 text-[11px] text-[#ffd89a]">
              Learn Alchemy from `Alchemist Mirelle` before brewing here.
            </div>
          )}

          {loading ? (
            <div className="rounded border-2 border-dashed border-[#325753] px-4 py-8 text-center text-[11px] uppercase tracking-[0.24em] text-[#a6c4c0]">
              Loading recipes...
            </div>
          ) : recipes.length === 0 ? (
            <div className="rounded border-2 border-dashed border-[#325753] px-4 py-8 text-center text-[11px] uppercase tracking-[0.18em] text-[#a6c4c0]">
              No alchemy recipes available.
            </div>
          ) : (
            <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
              {recipes.map((recipe) => {
                const missingSkill = alchemySkill < recipe.requiredSkillLevel;
                const missingMaterials = recipe.materials.some((material) => {
                  const owned = inventory[Number(material.tokenId)] ?? 0;
                  return owned < material.quantity;
                });
                const canBrew = learnedAlchemy && !missingSkill && !missingMaterials && busyRecipeId === null;
                const isGateEssence = GATE_ESSENCE_RECIPES.has(recipe.recipeId);

                return (
                  <div
                    key={recipe.recipeId}
                    className="grid gap-3 rounded border-2 border-[#254846] bg-[#111c1d] p-3 sm:grid-cols-[1.15fr_1.2fr_auto]"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-bold text-[#eef7ff]">{recipe.output.name}</div>
                        {isGateEssence && (
                          <span className="border border-[#2b7c5b] bg-[#113325] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em] text-[#8ff0bd]">
                            Gate
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[11px] text-[#a6c4c0]">
                        Skill {recipe.requiredSkillLevel} · {recipe.copperCost} copper · {recipe.brewingTime}s cooldown
                      </div>
                    </div>

                    <div className="rounded border border-[#2d5552] bg-[#0d1517] px-3 py-2 text-[11px]">
                      <div className="uppercase tracking-[0.18em] text-[#6fa39d]">Materials</div>
                      <div className="mt-1 space-y-1">
                        {recipe.materials.map((material) => {
                          const owned = inventory[Number(material.tokenId)] ?? 0;
                          const enough = owned >= material.quantity;
                          return (
                            <div key={`${recipe.recipeId}-${material.tokenId}`} className="flex items-center justify-between gap-3">
                              <span className="text-[#eef7ff]">{material.name}</span>
                              <span className={enough ? "text-[#8ff0bd]" : "text-[#ff9aa9]"}>
                                {owned}/{material.quantity}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex min-w-[150px] flex-col items-end justify-between gap-2">
                      <div className="text-right text-[10px] uppercase tracking-[0.16em] text-[#6fa39d]">
                        {missingSkill
                          ? `Need skill ${recipe.requiredSkillLevel}`
                          : missingMaterials
                            ? "Missing materials"
                            : learnedAlchemy
                              ? "Ready"
                              : "Learn alchemy"}
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleBrew(recipe)}
                        disabled={!canBrew}
                        className="border-2 border-black px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] shadow-[4px_4px_0_0_#000] transition hover:translate-y-[1px] hover:shadow-[3px_3px_0_0_#000] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-[4px_4px_0_0_#000]"
                        style={{
                          background: isGateEssence ? "#1e5a48" : "#225169",
                          color: "#eef7ff",
                        }}
                      >
                        {busyRecipeId === recipe.recipeId ? "Brewing..." : "Brew"}
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
