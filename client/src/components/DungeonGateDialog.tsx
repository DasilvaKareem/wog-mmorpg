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
import { gameBus } from "@/lib/eventBus";
import { playSoundEffect } from "@/lib/soundEffects";
import { WalletManager } from "@/lib/walletManager";
import type { Entity } from "@/types";

const RANK_LEVEL_REQUIREMENTS: Record<NonNullable<Entity["gateRank"]>, number> = {
  E: 3,
  D: 7,
  C: 12,
  B: 18,
  A: 28,
  S: 40,
};

const RANK_KEY_NAMES: Record<NonNullable<Entity["gateRank"]>, string> = {
  E: "E-Key",
  D: "D-Key",
  C: "C-Key",
  B: "B-Key",
  A: "A-Key",
  S: "S-Key",
};

interface JsonResult {
  ok: boolean;
  data: any;
}

async function readJson(res: Response): Promise<JsonResult> {
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, data };
}

export function DungeonGateDialog(): React.ReactElement | null {
  const { address, refreshCharacterProgress } = useWalletContext();
  const [open, setOpen] = React.useState(false);
  const [gate, setGate] = React.useState<Entity | null>(null);
  const [currentZoneId, setCurrentZoneId] = React.useState("village-square");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [messageTone, setMessageTone] = React.useState<"error" | "success" | null>(null);

  useGameBridge("zoneChanged", ({ zoneId }) => {
    setCurrentZoneId(zoneId);
  });

  useGameBridge("dungeonGateClick", (entity) => {
    if (entity.type !== "dungeon-gate") return;
    setGate(entity);
    setMessage(null);
    setMessageTone(null);
    setOpen(true);
    playSoundEffect("ui_dialog_open");
  });

  const currentGateZoneId = gate?.zoneId ?? currentZoneId;
  const insideDungeon = currentZoneId.startsWith("dungeon-");

  const resolveControlledPlayer = React.useCallback(async (zoneId: string) => {
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

    if (!player) {
      throw new Error("Could not find your champion in this zone.");
    }

    const walletCandidates = Array.from(
      new Set([player.walletAddress, trackedWallet, address].filter(Boolean) as string[])
    );

    return { player, walletCandidates };
  }, [address]);

  const ensureParty = React.useCallback(async (leaderId: string, zoneId: string, token: string) => {
    const res = await fetch(`${API_URL}/party/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ zoneId, leaderId }),
    });
    const { ok, data } = await readJson(res);
    if (ok) return;
    const error = String(data?.error ?? "");
    if (!error.toLowerCase().includes("already in a party")) {
      throw new Error(error || "Failed to create a party.");
    }
  }, []);

  const handleOpenGate = React.useCallback(async () => {
    if (!gate) return;
    if (!address) {
      setMessageTone("error");
      setMessage("Connect your wallet first.");
      return;
    }

    setBusy(true);
    setMessage(null);
    setMessageTone(null);

    try {
      const token = await getAuthToken(address);
      if (!token) {
        throw new Error("Failed to authenticate. Try reconnecting your wallet.");
      }

      const { player, walletCandidates } = await resolveControlledPlayer(currentGateZoneId);
      await ensureParty(player.id, currentGateZoneId, token);

      let lastError = "Failed to open dungeon gate.";
      for (const walletAddress of walletCandidates) {
        const res = await fetch(`${API_URL}/dungeon/open`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            walletAddress,
            zoneId: currentGateZoneId,
            entityId: player.id,
            gateEntityId: gate.id,
          }),
        });
        const { ok, data } = await readJson(res);
        if (!ok) {
          lastError = data?.error ?? lastError;
          continue;
        }

        await refreshCharacterProgress(true);
        gameBus.emit("followPlayer", {
          zoneId: data.dungeonZoneId,
          walletAddress: player.walletAddress ?? walletAddress,
        });
        setMessageTone("success");
        setMessage(`Entered Rank ${data.rank}${data.isDangerGate ? " DANGER" : ""} dungeon.`);
        setOpen(false);
        return;
      }

      throw new Error(lastError);
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Failed to open dungeon gate.");
    } finally {
      setBusy(false);
    }
  }, [address, currentGateZoneId, ensureParty, gate, refreshCharacterProgress, resolveControlledPlayer]);

  const handleLeaveDungeon = React.useCallback(async () => {
    if (!insideDungeon || !address) return;

    setBusy(true);
    setMessage(null);
    setMessageTone(null);

    try {
      const token = await getAuthToken(address);
      if (!token) {
        throw new Error("Failed to authenticate. Try reconnecting your wallet.");
      }

      const { player, walletCandidates } = await resolveControlledPlayer(currentZoneId);
      let lastError = "Failed to leave dungeon.";

      for (const walletAddress of walletCandidates) {
        const res = await fetch(`${API_URL}/dungeon/leave`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            walletAddress,
            entityId: player.id,
          }),
        });
        const { ok, data } = await readJson(res);
        if (!ok) {
          lastError = data?.error ?? lastError;
          continue;
        }

        await refreshCharacterProgress(true);
        gameBus.emit("followPlayer", {
          zoneId: data.returnedToZone,
          walletAddress: player.walletAddress ?? walletAddress,
        });
        setMessageTone("success");
        setMessage("Left dungeon.");
        return;
      }

      throw new Error(lastError);
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Failed to leave dungeon.");
    } finally {
      setBusy(false);
    }
  }, [address, currentZoneId, insideDungeon, refreshCharacterProgress, resolveControlledPlayer]);

  return (
    <>
      {insideDungeon && (
        <div className="pointer-events-none fixed left-4 top-16 z-40">
          <button
            type="button"
            onClick={() => void handleLeaveDungeon()}
            disabled={busy}
            className="pointer-events-auto border-2 border-black bg-[#401414]/90 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wide text-[#ffcc99] shadow-[4px_4px_0_0_#000] disabled:cursor-wait disabled:opacity-60"
            title="Leave dungeon"
          >
            {busy ? "Leaving..." : "Leave Dungeon"}
          </button>
        </div>
      )}

      {message && !open && (
        <div className="pointer-events-none fixed left-1/2 top-16 z-40 -translate-x-1/2">
          <div
            className="border-2 border-black px-3 py-2 font-mono text-[10px] shadow-[4px_4px_0_0_#000]"
            style={{
              background: messageTone === "error" ? "#3a1010" : "#10261a",
              color: messageTone === "error" ? "#ffb3b3" : "#c8ffd9",
            }}
          >
            {message}
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md border-[#29334d] bg-[#11182b] p-0 text-[#f1f5ff]">
          <DialogHeader className="border-b-2 border-[#29334d] bg-[#1a2340] p-4">
            <DialogTitle className="font-mono text-sm">
              {gate?.isDangerGate ? "Danger Gate" : "Dungeon Gate"} {gate?.gateRank ? `[${gate.gateRank}]` : ""}
            </DialogTitle>
            <DialogDescription className="font-mono text-[10px] text-[#9aa7cc]">
              {gate?.name ?? "Instanced dungeon entrance"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 p-4 font-mono text-[10px]">
            <div className="grid grid-cols-2 gap-2">
              <div className="border border-[#29334d] bg-[#0a0f1a] p-2">
                <div className="text-[#6b7a9e]">Requirement</div>
                <div className="mt-1 text-[#ffcc00]">
                  Level {gate?.gateRank ? RANK_LEVEL_REQUIREMENTS[gate.gateRank] : "?"}+
                </div>
              </div>
              <div className="border border-[#29334d] bg-[#0a0f1a] p-2">
                <div className="text-[#6b7a9e]">Key</div>
                <div className="mt-1 text-[#54f28b]">
                  {gate?.gateRank ? RANK_KEY_NAMES[gate.gateRank] : "Unknown"}
                </div>
              </div>
            </div>

            <div className="border border-[#29334d] bg-[#0a0f1a] p-3 text-[#d8e1ff]">
              <p>Opening a gate creates a fresh instanced dungeon for your party.</p>
              <p className="mt-2">If you are solo, the client will create a one-player party automatically.</p>
              {gate?.isDangerGate && (
                <p className="mt-2 text-[#ff8f8f]">Danger gates have tougher enemies and better rewards.</p>
              )}
            </div>

            {message && (
              <div
                className="border p-2"
                style={{
                  borderColor: messageTone === "error" ? "#7a2d2d" : "#2d7a47",
                  background: messageTone === "error" ? "#2b1212" : "#102017",
                  color: messageTone === "error" ? "#ffb3b3" : "#c8ffd9",
                }}
              >
                {message}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="border-2 border-[#29334d] bg-[#1a2340] px-3 py-2 text-[10px] font-bold uppercase text-[#9aa7cc]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleOpenGate()}
                disabled={busy || gate?.gateOpened}
                className="border-2 border-black bg-[#1e4d2f] px-3 py-2 text-[10px] font-bold uppercase text-[#d8ffe6] shadow-[2px_2px_0_0_#000] disabled:cursor-wait disabled:opacity-60"
              >
                {busy ? "Opening..." : gate?.gateOpened ? "Opened" : "Enter Dungeon"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
