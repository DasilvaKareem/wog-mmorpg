import * as React from "react";
import { API_URL } from "@/config";
import type { Entity } from "@/types";
import { useWalletContext } from "@/context/WalletContext";
import { getAuthToken } from "@/lib/agentAuth";

const BORDER = "#29334d";
const TEXT = "#f1f5ff";
const DIM = "#6b7a9e";
const ACCENT = "#54f28b";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface Props {
  entity: Entity;
  onClose: () => void;
}

export function NpcProfessionTab({ entity, onClose }: Props): React.ReactElement {
  const profession = entity.teachesProfession ?? "";
  const { address } = useWalletContext();
  const [status, setStatus] = React.useState<"idle" | "sending" | "ok" | "err">("idle");

  async function handleLearn() {
    if (!address || status === "sending") return;
    setStatus("sending");
    try {
      const token = await getAuthToken(address);
      if (!token) { setStatus("err"); return; }
      const res = await fetch(`${API_URL}/agent/goto-npc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          entityId: entity.id,
          zoneId: (entity.zoneId as string) ?? "",
          name: entity.name,
          action: "learn-profession",
          profession,
        }),
      });
      if (res.ok) {
        setStatus("ok");
        setTimeout(() => { onClose(); setStatus("idle"); }, 800);
      } else {
        setStatus("err");
        setTimeout(() => setStatus("idle"), 2000);
      }
    } catch {
      setStatus("err");
      setTimeout(() => setStatus("idle"), 2000);
    }
  }

  const btnLabel = status === "sending" ? "..." : status === "ok" ? "Sent!" : status === "err" ? "Error" : `Learn ${capitalize(profession)}`;

  return (
    <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
      {/* Specialization badge */}
      <div className="px-4 py-2 border-b" style={{ borderColor: BORDER }}>
        <div
          className="inline-block text-[10px] font-bold uppercase px-2 py-0.5 border"
          style={{ borderColor: ACCENT, color: ACCENT, background: "#0d1628" }}
        >
          {capitalize(profession)} Master
        </div>
      </div>

      {/* Description */}
      <div className="px-4 py-3 border-b" style={{ borderColor: BORDER }}>
        <div className="text-[11px] leading-relaxed" style={{ color: DIM }}>
          A skilled {capitalize(profession)} trainer who can teach gathering and crafting skills.
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

      {/* Learn action */}
      <div className="px-4 py-2">
        <button
          onClick={() => void handleLearn()}
          disabled={!address || status === "sending"}
          className="w-full py-1.5 text-[10px] uppercase tracking-widest font-bold border-2 transition disabled:opacity-40"
          style={{ borderColor: ACCENT, color: ACCENT, background: "#0a1020", cursor: "pointer", fontFamily: "monospace" }}
        >
          {btnLabel}
        </button>
        {!address && <div className="mt-1 text-[9px] text-center" style={{ color: DIM }}>Connect wallet to send your agent</div>}
      </div>
    </div>
  );
}
