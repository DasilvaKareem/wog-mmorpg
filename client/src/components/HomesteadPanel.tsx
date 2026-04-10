import * as React from "react";

import { API_URL } from "@/config";
import { useWalletContext } from "@/context/WalletContext";
import { getAuthToken } from "@/lib/agentAuth";
import { gameBus } from "@/lib/eventBus";
import { WalletManager } from "@/lib/walletManager";
import type { Entity } from "@/types";

interface HomesteadPlacement {
  id: string;
  kind: string;
  x: number;
  y: number;
  rotation?: number;
  variant?: string | null;
  state?: Record<string, unknown>;
}

interface HomesteadTier {
  tier: number;
  width: number;
  height: number;
  upgradeCostGold: number;
}

interface HomesteadState {
  homesteadId: string;
  plotId: string;
  ownerWallet: string;
  publicZoneId: string;
  entrance: { x: number; y: number };
  instanceZoneId: string;
  sizeTier: number;
  width: number;
  height: number;
  buildingType: string | null;
  buildingStage: number;
  placements: HomesteadPlacement[];
  createdAt: number;
  updatedAt: number;
  lastEnteredAt: number | null;
}

interface OwnedHomesteadResponse {
  owned: boolean;
  homestead: HomesteadState | null;
  tiers: HomesteadTier[];
  enterRadius?: number;
}

interface HomesteadPanelProps {
  entity: Entity;
  currentZoneId: string | null;
}

const BORDER = "#29334d";
const PANEL = "#0a0f1a";
const TEXT = "#f1f5ff";
const DIM = "#8ea0ca";

function shortZoneName(zoneId: string): string {
  return zoneId.replace(/-/g, " ");
}

function placementDraft(input?: HomesteadPlacement[] | null): HomesteadPlacement[] {
  return Array.isArray(input) ? input.map((placement) => ({ ...placement })) : [];
}

function numberFromInput(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return await res.json() as T;
  } catch {
    return null;
  }
}

export function HomesteadPanel({ entity, currentZoneId }: HomesteadPanelProps): React.ReactElement {
  const { address, refreshBalance, refreshCharacterProgress } = useWalletContext();
  const [status, setStatus] = React.useState<OwnedHomesteadResponse | null>(null);
  const [placements, setPlacements] = React.useState<HomesteadPlacement[]>([]);
  const [busyAction, setBusyAction] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const ownerWallet = entity.walletAddress ?? null;
  const homestead = status?.homestead ?? null;
  const tiers = status?.tiers ?? [];
  const enterRadius = status?.enterRadius ?? 0;
  const insideHomestead = !!homestead && currentZoneId === homestead.instanceZoneId;
  const inPublicZone = !!homestead && currentZoneId === homestead.publicZoneId;
  const nextTier = homestead ? tiers.find((tier) => tier.tier === homestead.sizeTier + 1) ?? null : null;
  const distanceToEntrance = homestead && inPublicZone
    ? Math.hypot((entity.x ?? 0) - homestead.entrance.x, (entity.y ?? 0) - homestead.entrance.y)
    : null;

  const flash = React.useCallback((tone: "ok" | "error", text: string) => {
    setMessage({ tone, text });
  }, []);

  const loadHomestead = React.useCallback(async () => {
    if (!ownerWallet) {
      setStatus(null);
      setPlacements([]);
      return;
    }

    try {
      const res = await fetch(`${API_URL}/homestead/owned/${ownerWallet}`);
      if (!res.ok) {
        setStatus(null);
        return;
      }
      const data = await readJson<OwnedHomesteadResponse>(res);
      if (!data) return;
      setStatus(data);
      setPlacements(placementDraft(data.homestead?.placements));
    } catch {
      setStatus(null);
    }
  }, [ownerWallet]);

  React.useEffect(() => {
    void loadHomestead();
  }, [loadHomestead, currentZoneId]);

  async function authHeaders(): Promise<Record<string, string>> {
    const owner = address ?? WalletManager.getInstance().address;
    if (!owner) {
      throw new Error("Connect your wallet first.");
    }
    const token = await getAuthToken(owner);
    if (!token) {
      throw new Error("Failed to authenticate. Reconnect your wallet.");
    }
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }

  async function runHomesteadAction(
    label: string,
    path: string,
    body: Record<string, unknown>,
    onSuccess?: (data: any) => Promise<void>,
  ): Promise<void> {
    if (!ownerWallet) {
      flash("error", "This character has no wallet.");
      return;
    }

    setBusyAction(label);
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await readJson<any>(res);
      if (!res.ok) {
        throw new Error(String(data?.error ?? `Failed to ${label}.`));
      }
      await onSuccess?.(data);
      await refreshBalance();
      await refreshCharacterProgress(true);
      await loadHomestead();
    } catch (error) {
      flash("error", error instanceof Error ? error.message : `Failed to ${label}.`);
    } finally {
      setBusyAction(null);
    }
  }

  const handleEnter = React.useCallback(async () => {
    await runHomesteadAction(
      "enter",
      "/homestead/enter",
      { walletAddress: ownerWallet, entityId: entity.id },
      async (data) => {
        gameBus.emit("followPlayer", {
          zoneId: String(data.zoneId ?? homestead?.instanceZoneId ?? ""),
          walletAddress: ownerWallet ?? entity.walletAddress ?? "",
        });
        flash("ok", "Entered your homestead.");
      },
    );
  }, [entity.id, entity.walletAddress, flash, homestead?.instanceZoneId, ownerWallet]);

  const handleExit = React.useCallback(async () => {
    await runHomesteadAction(
      "exit",
      "/homestead/exit",
      { walletAddress: ownerWallet, entityId: entity.id },
      async (data) => {
        gameBus.emit("followPlayer", {
          zoneId: String(data.zoneId ?? homestead?.publicZoneId ?? ""),
          walletAddress: ownerWallet ?? entity.walletAddress ?? "",
        });
        flash("ok", "Returned to your plot entrance.");
      },
    );
  }, [entity.id, entity.walletAddress, flash, homestead?.publicZoneId, ownerWallet]);

  const handleUpgrade = React.useCallback(async () => {
    await runHomesteadAction(
      "upgrade",
      "/homestead/upgrade",
      { walletAddress: ownerWallet, entityId: entity.id },
      async (data) => {
        flash("ok", `Homestead upgraded to Tier ${data?.homestead?.sizeTier ?? "?"}.`);
      },
    );
  }, [entity.id, flash, ownerWallet]);

  const handleSaveLayout = React.useCallback(async () => {
    const cleaned = placements.map((placement, index) => ({
      id: placement.id?.trim() || `placement-${index + 1}`,
      kind: placement.kind?.trim() || "decoration",
      x: numberFromInput(String(placement.x), 0),
      y: numberFromInput(String(placement.y), 0),
      ...(typeof placement.rotation === "number" ? { rotation: placement.rotation } : {}),
      ...(placement.variant ? { variant: placement.variant.trim() } : {}),
      ...(placement.state ? { state: placement.state } : {}),
    }));

    await runHomesteadAction(
      "save layout",
      "/homestead/layout",
      { walletAddress: ownerWallet, entityId: entity.id, placements: cleaned },
      async () => {
        flash("ok", "Layout saved.");
      },
    );
  }, [entity.id, flash, ownerWallet, placements]);

  function updatePlacement(index: number, patch: Partial<HomesteadPlacement>) {
    setPlacements((current) =>
      current.map((placement, currentIndex) =>
        currentIndex === index ? { ...placement, ...patch } : placement
      )
    );
  }

  function addPlacement() {
    const next = placements.length + 1;
    setPlacements((current) => [
      ...current,
      {
        id: `placement-${next}`,
        kind: "crop-patch",
        variant: "",
        x: homestead ? Math.min(homestead.width - 24, 96 + next * 18) : 96,
        y: homestead ? Math.min(homestead.height - 24, 96 + next * 14) : 96,
      },
    ]);
  }

  function removePlacement(index: number) {
    setPlacements((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <div className="space-y-2 text-[10px]" style={{ fontFamily: "monospace" }}>
      <div className="border p-2" style={{ borderColor: BORDER, background: PANEL, color: TEXT }}>
        <div className="flex items-center justify-between">
          <span style={{ color: TEXT }}>Private Homestead</span>
          <button
            type="button"
            onClick={() => void loadHomestead()}
            className="border px-2 py-1 text-[9px]"
            style={{ borderColor: BORDER, color: DIM, background: "transparent" }}
          >
            Refresh
          </button>
        </div>
        <div className="mt-1" style={{ color: DIM }}>
          Farming is the crop profession loop. Homestead is your private owned realm.
        </div>
      </div>

      {!ownerWallet && (
        <div className="border p-2" style={{ borderColor: "#7a2d2d", background: "#2b1212", color: "#ffb3b3" }}>
          This character has no wallet address, so homestead ownership cannot be resolved.
        </div>
      )}

      {ownerWallet && status?.owned === false && (
        <div className="border p-2" style={{ borderColor: BORDER, background: PANEL, color: TEXT }}>
          <div>No owned plot yet.</div>
          <div className="mt-1" style={{ color: DIM }}>
            Claim land first, then this tab becomes your enter, upgrade, and layout console.
          </div>
        </div>
      )}

      {homestead && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="border p-2" style={{ borderColor: BORDER, background: PANEL, color: TEXT }}>
              <div style={{ color: DIM }}>Plot</div>
              <div className="mt-1">{homestead.plotId}</div>
              <div className="mt-1" style={{ color: DIM }}>
                {shortZoneName(homestead.publicZoneId)} @ {Math.round(homestead.entrance.x)}, {Math.round(homestead.entrance.y)}
              </div>
            </div>
            <div className="border p-2" style={{ borderColor: BORDER, background: PANEL, color: TEXT }}>
              <div style={{ color: DIM }}>Realm</div>
              <div className="mt-1">Tier {homestead.sizeTier}</div>
              <div className="mt-1" style={{ color: DIM }}>
                {homestead.width} x {homestead.height}
              </div>
            </div>
          </div>

          <div className="border p-2" style={{ borderColor: BORDER, background: PANEL, color: TEXT }}>
            <div className="flex flex-wrap gap-2">
              <span style={{ color: DIM }}>Status:</span>
              <span style={{ color: insideHomestead ? "#54f28b" : inPublicZone ? "#ffcc66" : "#9eb4e5" }}>
                {insideHomestead ? "Inside realm" : inPublicZone ? "At public entrance zone" : `In ${shortZoneName(currentZoneId ?? "unknown")}`}
              </span>
            </div>
            {distanceToEntrance != null && (
              <div className="mt-1" style={{ color: DIM }}>
                Entrance distance: {Math.round(distanceToEntrance)} / {Math.round(enterRadius)} units
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {!insideHomestead ? (
                <button
                  type="button"
                  onClick={() => void handleEnter()}
                  disabled={busyAction !== null}
                  className="border-2 border-black px-3 py-1 font-bold uppercase shadow-[2px_2px_0_0_#000] disabled:opacity-60"
                  style={{ background: "#1d5030", color: "#d7ffe2" }}
                >
                  {busyAction === "enter" ? "Entering..." : "Enter Homestead"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleExit()}
                  disabled={busyAction !== null}
                  className="border-2 border-black px-3 py-1 font-bold uppercase shadow-[2px_2px_0_0_#000] disabled:opacity-60"
                  style={{ background: "#3b2a13", color: "#ffe2a8" }}
                >
                  {busyAction === "exit" ? "Leaving..." : "Exit To Plot"}
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleUpgrade()}
                disabled={busyAction !== null || !insideHomestead || !nextTier}
                className="border px-3 py-1 uppercase disabled:opacity-40"
                style={{ borderColor: BORDER, background: "#1a2340", color: TEXT }}
              >
                {busyAction === "upgrade"
                  ? "Upgrading..."
                  : nextTier
                    ? `Upgrade (${nextTier.upgradeCostGold}g)`
                    : "Max Tier"}
              </button>
            </div>
          </div>

          {message && (
            <div
              className="border p-2"
              style={{
                borderColor: message.tone === "error" ? "#7a2d2d" : "#2d7a47",
                background: message.tone === "error" ? "#2b1212" : "#102017",
                color: message.tone === "error" ? "#ffb3b3" : "#c8ffd9",
              }}
            >
              {message.text}
            </div>
          )}

          <div className="border p-2" style={{ borderColor: BORDER, background: PANEL, color: TEXT }}>
            <div className="flex items-center justify-between">
              <span>Placement Layout</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={addPlacement}
                  className="border px-2 py-1 text-[9px]"
                  style={{ borderColor: BORDER, color: TEXT, background: "transparent" }}
                >
                  Add Object
                </button>
                <button
                  type="button"
                  onClick={() => setPlacements(placementDraft(homestead.placements))}
                  className="border px-2 py-1 text-[9px]"
                  style={{ borderColor: BORDER, color: DIM, background: "transparent" }}
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="mt-2 space-y-2">
              {placements.length === 0 && (
                <div style={{ color: DIM }}>
                  No placements yet. Add crop patches, markers, or decorations here.
                </div>
              )}

              {placements.map((placement, index) => (
                <div key={`${placement.id}-${index}`} className="grid grid-cols-12 gap-1 border p-2" style={{ borderColor: BORDER }}>
                  <input
                    value={placement.id}
                    onChange={(event) => updatePlacement(index, { id: event.target.value })}
                    className="col-span-3 border bg-[#0f1628] px-1 py-1 text-[9px] outline-none"
                    style={{ borderColor: BORDER, color: TEXT }}
                    placeholder="id"
                  />
                  <input
                    value={placement.kind}
                    onChange={(event) => updatePlacement(index, { kind: event.target.value })}
                    className="col-span-3 border bg-[#0f1628] px-1 py-1 text-[9px] outline-none"
                    style={{ borderColor: BORDER, color: TEXT }}
                    placeholder="kind"
                  />
                  <input
                    value={placement.variant ?? ""}
                    onChange={(event) => updatePlacement(index, { variant: event.target.value })}
                    className="col-span-2 border bg-[#0f1628] px-1 py-1 text-[9px] outline-none"
                    style={{ borderColor: BORDER, color: TEXT }}
                    placeholder="variant"
                  />
                  <input
                    type="number"
                    value={placement.x}
                    onChange={(event) => updatePlacement(index, { x: numberFromInput(event.target.value, placement.x) })}
                    className="col-span-1 border bg-[#0f1628] px-1 py-1 text-[9px] outline-none"
                    style={{ borderColor: BORDER, color: TEXT }}
                  />
                  <input
                    type="number"
                    value={placement.y}
                    onChange={(event) => updatePlacement(index, { y: numberFromInput(event.target.value, placement.y) })}
                    className="col-span-1 border bg-[#0f1628] px-1 py-1 text-[9px] outline-none"
                    style={{ borderColor: BORDER, color: TEXT }}
                  />
                  <button
                    type="button"
                    onClick={() => removePlacement(index)}
                    className="col-span-2 border px-1 py-1 text-[9px]"
                    style={{ borderColor: "#7a2d2d", color: "#ffb3b3", background: "#2b1212" }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-2 flex items-center justify-between">
              <span style={{ color: DIM }}>
                Edit and save while inside your private realm.
              </span>
              <button
                type="button"
                onClick={() => void handleSaveLayout()}
                disabled={busyAction !== null || !insideHomestead}
                className="border-2 border-black px-3 py-1 font-bold uppercase shadow-[2px_2px_0_0_#000] disabled:opacity-40"
                style={{ background: "#203b73", color: "#d9e7ff" }}
              >
                {busyAction === "save layout" ? "Saving..." : "Save Layout"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
