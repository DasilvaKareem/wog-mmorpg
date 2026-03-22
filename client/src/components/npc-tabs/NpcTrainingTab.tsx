import * as React from "react";
import { API_URL } from "@/config";
import type { Entity } from "@/types";
import type { TechniqueInfo } from "@/hooks/useTechniques";
import { formatCopperString } from "@/lib/currency";
import { colorToCss, getTechniqueVisual } from "@/lib/techniqueVisuals";
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

export function NpcTrainingTab({ entity, onClose }: Props): React.ReactElement {
  const trainerClass = (entity.teachesClass ?? "").toLowerCase();
  const [techniques, setTechniques] = React.useState<TechniqueInfo[]>([]);
  const [loading, setLoading] = React.useState(true);
  const { address } = useWalletContext();
  const [agentStatus, setAgentStatus] = React.useState<"idle" | "sending" | "ok" | "err">("idle");

  React.useEffect(() => {
    if (!trainerClass) return;
    setLoading(true);
    fetch(`${API_URL}/techniques/class/${trainerClass}`)
      .then((r) => (r.ok ? r.json() : { techniques: [] }))
      .then((data) => setTechniques(data.techniques ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [trainerClass]);

  async function handleSendAgent() {
    if (!address || agentStatus === "sending") return;
    setAgentStatus("sending");
    try {
      const token = await getAuthToken(address);
      if (!token) { setAgentStatus("err"); return; }
      const res = await fetch(`${API_URL}/agent/goto-npc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ entityId: entity.id, zoneId: (entity.zoneId as string) ?? "", name: entity.name }),
      });
      if (res.ok) {
        setAgentStatus("ok");
        setTimeout(() => { onClose(); setAgentStatus("idle"); }, 800);
      } else {
        setAgentStatus("err");
        setTimeout(() => setAgentStatus("idle"), 2000);
      }
    } catch {
      setAgentStatus("err");
      setTimeout(() => setAgentStatus("idle"), 2000);
    }
  }

  const btnLabel = agentStatus === "sending" ? "..." : agentStatus === "ok" ? "Sent!" : agentStatus === "err" ? "Error" : "Send Agent to Trainer";

  return (
    <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
      {/* Header */}
      <div className="px-4 py-2 border-b" style={{ borderColor: BORDER }}>
        <div
          className="inline-block text-[10px] font-bold uppercase px-2 py-0.5 border"
          style={{ borderColor: "#f25454", color: "#f25454", background: "#0d1628" }}
        >
          {capitalize(trainerClass)} Specialist
        </div>
      </div>

      {/* Technique list */}
      <div className="px-4 py-2 border-b" style={{ borderColor: BORDER }}>
        <div className="text-[10px] font-bold uppercase mb-1.5" style={{ color: "#f25454" }}>
          {capitalize(trainerClass)} Techniques
        </div>
        {loading && <div className="text-[10px]" style={{ color: DIM }}>Loading techniques...</div>}
        {!loading && techniques.length === 0 && <div className="text-[10px]" style={{ color: DIM }}>No techniques found</div>}
        {!loading && techniques.length > 0 && (
          <div className="space-y-1.5">
            {techniques.map((tech) => {
              const visual = getTechniqueVisual(tech.id, tech.type);
              const primary = colorToCss(visual.primary);
              const secondary = colorToCss(visual.secondary);
              const accent = colorToCss(visual.accent);
              return (
                <div key={tech.id} className="border p-1.5" style={{ borderColor: primary, background: "#0d1628" }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-5 w-5 items-center justify-center border text-[9px] font-bold"
                        style={{ borderColor: primary, color: accent, background: "#10192d" }}
                      >
                        {visual.uiGlyph}
                      </span>
                      <span className="text-[11px] font-bold" style={{ color: primary }}>{tech.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[8px] uppercase font-bold px-1 border" style={{ borderColor: "#1e2842", color: DIM }}>
                        Lv{tech.levelRequired}
                      </span>
                      <span className="text-[9px] uppercase font-bold" style={{ color: secondary }}>{tech.type}</span>
                    </div>
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: DIM }}>{tech.description}</div>
                  <div className="flex gap-3 mt-0.5 text-[9px]" style={{ color: accent }}>
                    <span>CD: {tech.cooldown}s</span>
                    <span>ES: {tech.essenceCost}</span>
                    <span>Cost: {formatCopperString(tech.copperCost ?? 0)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Agent action */}
      <div className="px-4 py-2">
        <button
          onClick={() => void handleSendAgent()}
          disabled={!address || agentStatus === "sending"}
          className="w-full py-1.5 text-[10px] uppercase tracking-widest font-bold border-2 transition disabled:opacity-40"
          style={{ borderColor: "#f25454", color: "#f25454", background: "#0a1020", cursor: "pointer", fontFamily: "monospace" }}
        >
          {btnLabel}
        </button>
        {!address && <div className="mt-1 text-[9px] text-center" style={{ color: DIM }}>Connect wallet to send your agent</div>}
      </div>
    </div>
  );
}
