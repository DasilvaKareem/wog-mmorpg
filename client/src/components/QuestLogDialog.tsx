import * as React from "react";
import { useQuestLog, type ActiveQuestEntry, type AvailableQuestEntry, type CompletedQuestEntry, type ActivityEntry } from "@/hooks/useQuestLog";
import { getAuthToken } from "@/lib/agentAuth";
import { API_URL } from "@/config";
import { gameBus } from "@/lib/eventBus";
import { formatCopperString } from "@/lib/currency";

/* ── 8-bit retro palette (matches InspectDialog) ──────────── */
const BG = "#11182b";
const BORDER = "#29334d";
const TEXT = "#f1f5ff";
const DIM = "#6b7a9e";
const ACCENT = "#54f28b";

/* ── Tab types ────────────────────────────────────────────── */
type TabId = "available" | "active" | "completed" | "activity";

const TABS: { id: TabId; label: string }[] = [
  { id: "available", label: "Available" },
  { id: "active", label: "Active" },
  { id: "completed", label: "Done" },
  { id: "activity", label: "Activity" },
];

/* ── Event type colors ────────────────────────────────────── */
const EVENT_COLORS: Record<string, string> = {
  combat: "#f2a854",
  death: "#f25454",
  kill: "#54f28b",
  levelup: "#f2c854",
  loot: "#b48efa",
  quest: "#5dadec",
  trade: "#ffcc00",
  shop: "#ffcc00",
};

/* ── Progress bar ─────────────────────────────────────────── */
function ProgressBar({ value, max }: { value: number; max: number }): React.ReactElement {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const color = pct >= 100 ? ACCENT : "#5dadec";
  return (
    <div className="flex items-center gap-1">
      <div className="flex-1 h-[6px] border" style={{ borderColor: BORDER, background: "#0a0e18" }}>
        <div className="h-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[9px]" style={{ color: pct >= 100 ? ACCENT : DIM, fontFamily: "monospace" }}>
        {value}/{max}
      </span>
    </div>
  );
}

/* ── Time formatting ──────────────────────────────────────── */
function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/* ── Small action button ──────────────────────────────────── */
function ActionBtn({
  label, color, disabled, loading, onClick,
}: {
  label: string; color: string; disabled?: boolean; loading?: boolean; onClick: () => void;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="text-[9px] font-bold px-2 py-0.5 border"
      style={{
        borderColor: disabled ? BORDER : color,
        color: disabled ? DIM : color,
        background: "transparent",
        cursor: disabled || loading ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {loading ? "..." : label}
    </button>
  );
}

/* ── Available Quests Tab ─────────────────────────────────── */
function AvailableTab({
  quests, onAccept, loadingId,
}: {
  quests: AvailableQuestEntry[];
  onAccept: (q: AvailableQuestEntry) => void;
  loadingId: string | null;
}): React.ReactElement {
  if (quests.length === 0) {
    return <div className="text-[11px]" style={{ color: DIM }}>No quests available in this zone</div>;
  }

  return (
    <div className="space-y-2">
      {quests.map((q) => (
        <div key={q.questId} className="border p-2" style={{ borderColor: "#1e2842" }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold" style={{ color: TEXT }}>{q.title}</span>
            <ActionBtn
              label="Send Agent"
              color={ACCENT}
              loading={loadingId === q.questId}
              onClick={() => onAccept(q)}
            />
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: DIM }}>{q.description}</div>
          <div className="text-[9px] mt-1" style={{ color: "#8899bb" }}>
            {q.objective.type === "kill"
              ? `Kill ${q.objective.count}× ${q.objective.targetMobName ?? "enemies"}`
              : q.objective.type === "gather"
              ? `Gather ${q.objective.count}× ${q.objective.targetItemName ?? "items"}`
              : `Talk to ${q.objective.targetNpcName ?? "NPC"}`}
            {" · "}from {q.npcName}
          </div>
          <div className="flex gap-2 mt-1 text-[9px]" style={{ color: "#f2c854" }}>
            <span>{q.rewards.xp} XP</span>
            <span>{formatCopperString(q.rewards.copper)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Active Quests Tab ────────────────────────────────────── */
function ActiveTab({
  quests, onTurnIn, loadingId,
}: {
  quests: ActiveQuestEntry[];
  onTurnIn: (q: ActiveQuestEntry) => void;
  loadingId: string | null;
}): React.ReactElement {
  if (quests.length === 0) {
    return <div className="text-[11px]" style={{ color: DIM }}>No active quests</div>;
  }

  return (
    <div className="space-y-2">
      {quests.map((q) => (
        <div key={q.questId} className="border p-2" style={{ borderColor: q.complete ? ACCENT : "#1e2842" }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold" style={{ color: q.complete ? ACCENT : TEXT }}>
              {q.title}
            </span>
            {q.complete && q.npcEntityId && (
              <ActionBtn
                label="Send to Turn In"
                color="#f2c854"
                loading={loadingId === q.questId}
                onClick={() => onTurnIn(q)}
              />
            )}
            {q.complete && !q.npcEntityId && (
              <span className="text-[9px] font-bold" style={{ color: ACCENT }}>COMPLETE</span>
            )}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: DIM }}>{q.description}</div>
          <div className="mt-1">
            <div className="text-[9px] mb-0.5" style={{ color: DIM }}>
              {q.objective.type === "kill"
                ? `Kill ${q.objective.targetMobName ?? "enemies"}`
                : q.objective.type === "gather"
                ? `Gather ${(q.objective as any).targetItemName ?? "items"}`
                : `Talk to ${q.objective.targetNpcName ?? "NPC"}`}
            </div>
            <ProgressBar value={q.progress} max={q.required} />
          </div>
          <div className="flex gap-2 mt-1 text-[9px]" style={{ color: "#f2c854" }}>
            <span>{q.rewards.xp} XP</span>
            <span>{formatCopperString(q.rewards.copper)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Completed Quests Tab ─────────────────────────────────── */
function CompletedTab({ quests }: { quests: CompletedQuestEntry[] }): React.ReactElement {
  if (quests.length === 0) {
    return <div className="text-[11px]" style={{ color: DIM }}>No completed quests</div>;
  }

  return (
    <div className="space-y-1">
      {quests.map((q) => (
        <div key={q.questId} className="flex items-start gap-1.5 text-[11px]">
          <span style={{ color: ACCENT }}>+</span>
          <div className="flex-1">
            <span style={{ color: TEXT }}>{q.title}</span>
            <div className="text-[9px]" style={{ color: DIM }}>
              {q.rewards.xp} XP | {formatCopperString(q.rewards.copper)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Activity Tab ─────────────────────────────────────────── */
function ActivityTab({ events }: { events: ActivityEntry[] }): React.ReactElement {
  if (events.length === 0) {
    return <div className="text-[11px]" style={{ color: DIM }}>No recent activity</div>;
  }

  return (
    <div className="space-y-0.5">
      {events.map((e, i) => (
        <div key={i} className="flex items-start gap-1 text-[10px]" style={{ fontFamily: "monospace" }}>
          <span className="shrink-0" style={{ color: EVENT_COLORS[e.type] ?? DIM, width: 48 }}>
            [{e.type.toUpperCase().slice(0, 5)}]
          </span>
          <span className="flex-1" style={{ color: TEXT }}>{e.message}</span>
          <span className="shrink-0" style={{ color: DIM }}>{timeAgo(e.timestamp)}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Main Component ───────────────────────────────────────── */
interface QuestLogDialogProps {
  open: boolean;
  onClose: () => void;
  walletAddress: string | null;
}

export function QuestLogDialog({ open, onClose, walletAddress }: QuestLogDialogProps): React.ReactElement | null {
  const [tab, setTab] = React.useState<TabId>("available");
  const { data, loading, error, refresh } = useQuestLog(open ? walletAddress : null);

  // Available quests (zone-wide)
  const [available, setAvailable] = React.useState<AvailableQuestEntry[]>([]);
  const [availLoading, setAvailLoading] = React.useState(false);

  // Action feedback
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<{ msg: string; ok: boolean } | null>(null);

  // Fetch available quests when we have entityId + zoneId
  React.useEffect(() => {
    if (!data?.entityId || !data?.zoneId) return;
    let cancelled = false;

    async function fetchAvail() {
      setAvailLoading(true);
      try {
        const res = await fetch(`${API_URL}/quests/zone/${data!.zoneId}/${data!.entityId}`);
        if (res.ok && !cancelled) {
          const json = await res.json() as { quests: AvailableQuestEntry[] };
          setAvailable(json.quests ?? []);
        }
      } catch {}
      if (!cancelled) setAvailLoading(false);
    }

    void fetchAvail();
    const id = setInterval(fetchAvail, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, [data?.entityId, data?.zoneId]);

  function showFeedback(msg: string, ok: boolean) {
    setFeedback({ msg, ok });
    setTimeout(() => setFeedback(null), 3500);
  }

  function handleAccept(q: AvailableQuestEntry) {
    if (!data?.zoneId) return;

    // Send through agent confirmation flow instead of direct accept
    gameBus.emit("agentGoToNpc", {
      entityId: q.npcEntityId,
      zoneId: data.zoneId,
      name: q.npcName,
      type: "quest-giver",
      action: "accept-quest",
      questId: q.questId,
      questTitle: q.title,
    });

    showFeedback(`Sending agent to accept "${q.title}"`, true);
  }

  function handleTurnIn(q: ActiveQuestEntry) {
    if (!data?.zoneId || !q.npcEntityId) return;

    // Find NPC name from quest title (the NPC entity name comes from quest catalog)
    const npcName = q.title; // fallback — the confirmation shows the quest title

    // Send agent to NPC for turn-in through confirmation flow
    gameBus.emit("agentGoToNpc", {
      entityId: q.npcEntityId,
      zoneId: data.zoneId,
      name: npcName,
      type: "quest-giver",
      action: "complete-quest",
      questId: q.questId,
      questTitle: q.title,
    });

    showFeedback(`Sending agent to turn in "${q.title}"`, true);
  }

  if (!open) return null;

  return (
    <div
      className="fixed z-50 border-2 shadow-2xl select-none"
      style={{
        background: BG,
        borderColor: BORDER,
        fontFamily: "monospace",
        color: TEXT,
        width: "min(400px, 92vw)",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        maxHeight: "80dvh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: BORDER }}>
        <div>
          <div className="text-sm font-bold" style={{ color: TEXT }}>Quest Log</div>
          {data && (
            <div className="text-[10px]" style={{ color: DIM }}>
              {data.playerName} | {data.zoneId} | {data.completedQuests.length} done
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-xs font-bold px-2 py-0.5 border"
          style={{ borderColor: BORDER, color: DIM, background: "transparent", cursor: "pointer" }}
        >
          X
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b" style={{ borderColor: BORDER }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex-1 py-1.5 text-[10px] font-bold uppercase border-r last:border-r-0"
            style={{
              borderColor: BORDER,
              background: tab === t.id ? "#1a2240" : "transparent",
              color: tab === t.id ? ACCENT : DIM,
              cursor: "pointer",
            }}
          >
            {t.label}
            {t.id === "available" ? ` (${available.length})` : ""}
            {t.id === "active" && data ? ` (${data.activeQuests.length})` : ""}
            {t.id === "completed" && data ? ` (${data.completedQuests.length})` : ""}
          </button>
        ))}
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div
          className="px-3 py-1 text-[10px] font-bold border-b"
          style={{
            borderColor: BORDER,
            background: feedback.ok ? "#0d2b1a" : "#2b0d0d",
            color: feedback.ok ? ACCENT : "#f25454",
          }}
        >
          {feedback.msg}
        </div>
      )}

      {/* Content */}
      <div className="px-3 py-2 overflow-y-auto" style={{ minHeight: 120, maxHeight: "60dvh" }}>
        {(loading || availLoading) && !data && (
          <div className="text-[11px]" style={{ color: DIM }}>Loading...</div>
        )}
        {error && !data && (
          <div className="text-[11px]" style={{ color: "#f25454" }}>{error}</div>
        )}
        {tab === "available" && (
          <AvailableTab quests={available} onAccept={handleAccept} loadingId={actionLoading} />
        )}
        {data && tab === "active" && (
          <ActiveTab quests={data.activeQuests} onTurnIn={handleTurnIn} loadingId={actionLoading} />
        )}
        {data && tab === "completed" && <CompletedTab quests={data.completedQuests} />}
        {data && tab === "activity" && <ActivityTab events={data.activity} />}
      </div>

      {/* Footer hint */}
      <div className="border-t px-3 py-1 text-[9px]" style={{ borderColor: BORDER, color: DIM }}>
        Press Q to close
      </div>
    </div>
  );
}
