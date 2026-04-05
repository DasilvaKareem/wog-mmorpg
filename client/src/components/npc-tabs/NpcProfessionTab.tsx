import * as React from "react";

import { API_URL } from "@/config";
import { fetchZone } from "@/ShardClient";
import type { Entity } from "@/types";
import { useWalletContext } from "@/context/WalletContext";
import { getAuthToken } from "@/lib/agentAuth";
import { WalletManager } from "@/lib/walletManager";

const BORDER = "#29334d";
const TEXT = "#f1f5ff";
const DIM = "#6b7a9e";
const ACCENT = "#54f28b";
const DANGER = "#f25454";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface Props {
  entity: Entity;
  onClose: () => void;
}

export function NpcProfessionTab({ entity, onClose }: Props): React.ReactElement {
  const profession = entity.teachesProfession ?? "";
  const { address, professions, refreshProfessions } = useWalletContext();
  const [status, setStatus] = React.useState<"idle" | "sending" | "ok" | "err">("idle");
  const [message, setMessage] = React.useState<string | null>(null);

  const alreadyLearned = professions?.learned?.includes(profession) ?? false;

  const resolveControlledPlayer = React.useCallback(async () => {
    if (!address) {
      throw new Error("Connect your wallet first.");
    }

    const trackedWallet = await WalletManager.getInstance().getTrackedWalletAddress();
    const normalizedOwner = address.toLowerCase();
    const normalizedTracked = trackedWallet?.toLowerCase() ?? null;
    const zoneId = entity.zoneId ?? "village-square";
    const zone = await fetchZone(zoneId);
    if (!zone) {
      throw new Error("Could not load the trainer zone.");
    }

    const candidates = [normalizedTracked, normalizedOwner].filter(Boolean) as string[];
    const player = Object.values(zone.entities).find((candidate) => {
      if (candidate.type !== "player") return false;
      const wallet = candidate.walletAddress?.toLowerCase();
      return !!wallet && candidates.includes(wallet);
    });

    if (!player?.walletAddress) {
      throw new Error("Could not find your champion near this trainer.");
    }

    return { player, zoneId };
  }, [address, entity.zoneId]);

  async function handleLearn() {
    if (!address || status === "sending" || !profession) return;
    setStatus("sending");
    setMessage(null);

    try {
      const token = await getAuthToken(address);
      if (!token) {
        throw new Error("Failed to authenticate. Try reconnecting your wallet.");
      }

      const { player, zoneId } = await resolveControlledPlayer();
      const res = await fetch(`${API_URL}/professions/learn`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          walletAddress: player.walletAddress,
          zoneId,
          entityId: player.id,
          trainerId: entity.id,
          professionId: profession,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? `Failed to learn ${capitalize(profession)}.`);
      }

      await refreshProfessions();
      setStatus("ok");
      setMessage(`Learned ${capitalize(profession)}.`);
      setTimeout(() => {
        onClose();
        setStatus("idle");
      }, 800);
    } catch (error) {
      setStatus("err");
      setMessage(error instanceof Error ? error.message : `Failed to learn ${capitalize(profession)}.`);
      setTimeout(() => setStatus("idle"), 2000);
    }
  }

  const btnLabel = alreadyLearned
    ? `${capitalize(profession)} learned`
    : status === "sending"
      ? "Learning..."
      : status === "ok"
        ? "Learned!"
        : status === "err"
          ? "Error"
          : `Learn ${capitalize(profession)}`;

  return (
    <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
      <div className="px-4 py-2 border-b" style={{ borderColor: BORDER }}>
        <div
          className="inline-block text-[10px] font-bold uppercase px-2 py-0.5 border"
          style={{ borderColor: ACCENT, color: ACCENT, background: "#0d1628" }}
        >
          {capitalize(profession)} Master
        </div>
      </div>

      <div className="px-4 py-3 border-b" style={{ borderColor: BORDER }}>
        <div className="text-[11px] leading-relaxed" style={{ color: DIM }}>
          A skilled {capitalize(profession)} trainer who can teach gathering and crafting skills directly to your champion.
        </div>
        <div className="mt-2 space-y-1">
          {[
            `Teaches ${capitalize(profession)}`,
            "Profession skills level up from 1 to 300",
            "Higher skill unlocks better recipes and nodes",
          ].map((line, i) => (
            <div key={i} className="flex gap-1.5 text-[11px]">
              <span style={{ color: ACCENT }}>{">"}</span>
              <span style={{ color: TEXT }}>{line}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 py-2">
        <button
          onClick={() => void handleLearn()}
          disabled={!address || status === "sending" || alreadyLearned}
          className="w-full py-1.5 text-[10px] uppercase tracking-widest font-bold border-2 transition disabled:opacity-40"
          style={{ borderColor: ACCENT, color: ACCENT, background: "#0a1020", cursor: "pointer", fontFamily: "monospace" }}
        >
          {btnLabel}
        </button>
        {!address && <div className="mt-1 text-[9px] text-center" style={{ color: DIM }}>Connect wallet to learn professions</div>}
        {message && (
          <div
            className="mt-2 border px-2 py-1.5 text-[10px]"
            style={{
              borderColor: status === "ok" ? ACCENT : DANGER,
              color: status === "ok" ? ACCENT : "#ffb3b3",
              background: "#0d1628",
            }}
          >
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
