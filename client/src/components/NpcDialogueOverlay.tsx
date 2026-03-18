import * as React from "react";
import { useGameBridge } from "@/hooks/useGameBridge";
import { API_URL } from "@/config";
import { useWalletContext } from "@/context/WalletContext";
import { gameBus } from "@/lib/eventBus";
import { formatCopperString } from "@/lib/currency";
import type { Entity } from "@/types";
import type { AvailableQuestEntry } from "@/hooks/useQuestLog";

/* ── 8-bit retro palette ──────────────────────────────────── */
const BG = "#11182b";
const BG_DARK = "#0a0e18";
const BORDER = "#29334d";
const TEXT = "#f1f5ff";
const DIM = "#6b7a9e";
const ACCENT = "#54f28b";
const GOLD = "#f2c854";
const CHAMPION_COLOR = "#44ddff";

/* ── Typewriter hook ──────────────────────────────────────── */
function useTypewriter(text: string, speed = 25) {
  const [displayed, setDisplayed] = React.useState("");
  const [done, setDone] = React.useState(false);
  const indexRef = React.useRef(0);

  React.useEffect(() => {
    setDisplayed("");
    setDone(false);
    indexRef.current = 0;
    if (!text) { setDone(true); return; }
    const interval = setInterval(() => {
      indexRef.current++;
      if (indexRef.current >= text.length) {
        setDisplayed(text);
        setDone(true);
        clearInterval(interval);
      } else {
        setDisplayed(text.slice(0, indexRef.current));
      }
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);

  const skip = React.useCallback(() => {
    setDisplayed(text);
    setDone(true);
    indexRef.current = text.length;
  }, [text]);

  return { displayed, done, skip };
}

/* ── Objective label ──────────────────────────────────────── */
function objectiveLabel(obj: AvailableQuestEntry["objective"]): string {
  if (obj.type === "kill") return `Slay ${obj.count} ${obj.targetMobName ?? "enemies"}`;
  if (obj.type === "gather") return `Gather ${obj.count} ${obj.targetItemName ?? "items"}`;
  if (obj.type === "craft") return `Craft ${obj.count} ${obj.targetItemName ?? "items"}`;
  if (obj.type === "talk") return `Speak with ${obj.targetNpcName ?? "NPC"}`;
  return `${obj.type} x${obj.count}`;
}

/* ── Dialogue phases ──────────────────────────────────────── */
// Flow: greeting(NPC) → greeting_reply(champion) → quest(NPC) → quest_reply(champion) → rewards(NPC)
type DialoguePhase = "greeting" | "greeting_reply" | "quest" | "quest_reply" | "rewards" | "active" | "idle";

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

const NPC_GREETINGS = [
  "Ah, a brave soul approaches. I have need of your strength.",
  "Well met, champion. I've been waiting for someone capable.",
  "You look like you can handle yourself. Listen closely.",
  "The winds whisper of your deeds. Perhaps you can help me.",
  "Finally, someone who doesn't run at the first sign of danger.",
];

/* ── Origin-based dialogue lines ──────────────────────────── */
// Each origin has a distinct personality tone

const GREETING_REPLIES: Record<string, string[]> = {
  sunforged: [
    "By the light of Aurandel, I stand ready. What threatens this land?",
    "I swore an oath to defend the weak. Tell me what must be done.",
    "The righteous do not hesitate. Speak, and I shall act.",
    "My shield arm is steady. What evil needs purging?",
  ],
  veilborn: [
    "...I'm listening. But know that my help comes at a price.",
    "Interesting. And what's in it for me, exactly?",
    "I've heard whispers about trouble here. Let's see if they're true.",
    "Trust is earned, not given. But you have my attention.",
  ],
  dawnkeeper: [
    "I sense pain in your words. Let me help carry this burden.",
    "Every soul deserves aid. Tell me how I can bring light here.",
    "The Ember Communes taught me that all suffering can be healed. What do you need?",
    "Peace comes through action. I'm here to help, friend.",
  ],
  ironvow: [
    "Skip the pleasantries. What needs killing?",
    "I didn't crawl out of the pits for small talk. Get to the point.",
    "You want something done right? You came to the right person.",
    "Words are cheap. Point me at the problem.",
  ],
};

const QUEST_REPLIES_KILL: Record<string, string[]> = {
  sunforged: [
    "These creatures threaten the innocent. By my oath, they will fall.",
    "Justice demands their end. I'll strike them down with honor.",
    "No beast shall prey upon the defenseless while I draw breath.",
  ],
  veilborn: [
    "I know their patterns. They won't see me coming.",
    "Efficient. Clean. No witnesses. Consider it handled.",
    "I'll study their weaknesses first. Then... silence.",
  ],
  dawnkeeper: [
    "I take no joy in this, but the balance must be restored.",
    "May their spirits find peace in the next life. It must be done.",
    "I'll end their suffering swiftly. Every life has meaning.",
  ],
  ironvow: [
    "Finally, some real work. They're already dead, they just don't know it.",
    "Only ${count}? I was hoping for a challenge.",
    "Blood and steel. The only language worth speaking.",
  ],
};

const QUEST_REPLIES_GATHER: Record<string, string[]> = {
  sunforged: [
    "A noble task. I'll search every corner of this land for what you need.",
    "Resources to aid the cause? I'll gather them with purpose.",
  ],
  veilborn: [
    "I know places others don't. I'll have them before dawn.",
    "Procurement is one of my... specialties. Leave it to me.",
  ],
  dawnkeeper: [
    "The land provides for those who ask gently. I'll find them.",
    "Nature's gifts are meant to be shared. I'm on it.",
  ],
  ironvow: [
    "Errands. Fine. But you owe me one.",
    "Not exactly glory work, but a job's a job. I'll get it done.",
  ],
};

const QUEST_REPLIES_CRAFT: Record<string, string[]> = {
  sunforged: [
    "My hands serve creation as well as destruction. I'll forge what you need.",
    "Aurandel's smiths taught me well. I'll craft them with care.",
  ],
  veilborn: [
    "Precision work? Finally, something that requires finesse.",
    "I've crafted tools in the shadow markets. This should be trivial.",
  ],
  dawnkeeper: [
    "To create is to heal the world. I'll put my heart into it.",
    "The Ember Communes value craftsmanship above all. Watch me work.",
  ],
  ironvow: [
    "Forge work. Good. There's honesty in shaping metal with your hands.",
    "I learned to make weapons before I learned to read. Easy.",
  ],
};

const QUEST_REPLIES_TALK: Record<string, string[]> = {
  sunforged: [
    "I'll seek them out. Knowledge strengthens the righteous.",
    "Words can be as powerful as swords. I'll hear what they say.",
  ],
  veilborn: [
    "Information is currency. I'll extract what we need.",
    "I'll listen... and read between the lines.",
  ],
  dawnkeeper: [
    "Every voice deserves to be heard. I'll find them and listen.",
    "Connection and understanding. That's what I do best.",
  ],
  ironvow: [
    "Talking. Not my strength, but I'll manage.",
    "Fine. But if they waste my time, we're done.",
  ],
};

const FALLBACK_GREETINGS = [
  "I'm listening. What do you need?",
  "You have my attention. Tell me what's going on.",
  "My blade is ready. Speak your mind.",
  "Sounds serious. Go on, I'm here to help.",
];

function getGreetingReply(origin: string | null): string {
  const lines = (origin && GREETING_REPLIES[origin]) || FALLBACK_GREETINGS;
  return pick(lines);
}

function getChampionQuestReply(obj: AvailableQuestEntry["objective"], origin: string | null): string {
  const o = origin ?? "sunforged";
  const target = obj.targetMobName ?? obj.targetItemName ?? obj.targetNpcName ?? "them";

  if (obj.type === "kill") {
    const lines = QUEST_REPLIES_KILL[o] ?? QUEST_REPLIES_KILL.sunforged;
    return pick(lines).replace("${count}", String(obj.count));
  }
  if (obj.type === "gather") {
    const lines = QUEST_REPLIES_GATHER[o] ?? QUEST_REPLIES_GATHER.sunforged;
    return pick(lines);
  }
  if (obj.type === "craft") {
    const lines = QUEST_REPLIES_CRAFT[o] ?? QUEST_REPLIES_CRAFT.sunforged;
    return pick(lines);
  }
  if (obj.type === "talk") {
    const lines = QUEST_REPLIES_TALK[o] ?? QUEST_REPLIES_TALK.sunforged;
    return pick(lines);
  }
  return "Understood. I'll get it done.";
}

/* ── Component ────────────────────────────────────────────── */

// Track quest IDs that have been sent to the agent (persists across re-opens within session)
const sentQuestIds = new Set<string>();

interface ActiveQuestInfo {
  questId: string;
  title: string;
  progress: number;
  required: number;
  complete: boolean;
  objective: { type: string; targetMobName?: string; targetItemName?: string; targetNpcName?: string; count: number };
}

const NPC_FOLLOWUP_LINES = [
  "You're back. Your champion is already working on the tasks I gave. Keep at it.",
  "I see you've returned. Your agent is making progress — check the quest log for details.",
  "Patience, friend. Your champion hasn't finished yet. These things take time.",
  "Still here? Your agent is in the field. Come back when the job is done.",
];

function activeQuestSummary(aq: ActiveQuestInfo): string {
  const pct = aq.required > 0 ? Math.round((aq.progress / aq.required) * 100) : 0;
  if (aq.complete) return `"${aq.title}" is complete! Send your agent to turn it in.`;
  const target = aq.objective.targetMobName ?? aq.objective.targetItemName ?? aq.objective.targetNpcName ?? "targets";
  return `"${aq.title}" — ${aq.progress}/${aq.required} ${target} (${pct}%). Keep going.`;
}

export function NpcDialogueOverlay(): React.ReactElement | null {
  const { address } = useWalletContext();
  const [open, setOpen] = React.useState(false);
  const [npc, setNpc] = React.useState<Entity | null>(null);
  const [quests, setQuests] = React.useState<AvailableQuestEntry[]>([]);
  const [activeQuests, setActiveQuests] = React.useState<ActiveQuestInfo[]>([]);
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [phase, setPhase] = React.useState<DialoguePhase>("greeting");
  const [greetingText, setGreetingText] = React.useState(() => pick(NPC_GREETINGS));
  const [championOrigin, setChampionOrigin] = React.useState<string | null>(null);
  const [greetingReply, setGreetingReply] = React.useState(() => pick(FALLBACK_GREETINGS));
  const [questReply, setQuestReply] = React.useState("");
  const [accepted, setAccepted] = React.useState(false);
  const [championName, setChampionName] = React.useState("Champion");
  const [championEntityId, setChampionEntityId] = React.useState<string | null>(null);
  const [activeIdx, setActiveIdx] = React.useState(0);

  // Is the current speaker the champion?
  const isChampionSpeaking = phase === "greeting_reply" || phase === "quest_reply";

  // Current text to display based on phase
  const currentText = React.useMemo(() => {
    if (phase === "greeting") return greetingText;
    if (phase === "greeting_reply") return greetingReply;
    if (phase === "active") {
      const aq = activeQuests[activeIdx];
      return aq ? activeQuestSummary(aq) : "I have nothing for you right now. Return later.";
    }
    const q = quests[selectedIdx];
    if (!q) return "I have nothing for you right now. Return later.";
    if (phase === "quest") return q.description;
    if (phase === "quest_reply") return questReply;
    if (phase === "rewards") return `Your reward: ${formatCopperString(q.rewards.copper)} gold and ${q.rewards.xp} XP. Shall I send your champion?`;
    return "";
  }, [phase, greetingText, greetingReply, questReply, quests, selectedIdx, activeQuests, activeIdx]);

  const { displayed, done, skip } = useTypewriter(currentText, 20);

  // Fetch quests + player info when NPC is clicked
  useGameBridge("questNpcClick", async (entity: Entity) => {
    setNpc(entity);
    setSelectedIdx(0);
    setActiveIdx(0);
    setAccepted(false);
    setOpen(true);

    let pid: string | null = championEntityId;
    let origin: string | null = championOrigin;
    let npcActiveQuests: ActiveQuestInfo[] = [];

    // Fetch player info for name + entityId + active quests
    if (address) {
      try {
        const logRes = await fetch(`${API_URL}/questlog/${address}`);
        if (logRes.ok) {
          const logData = await logRes.json();
          if (logData.playerName) setChampionName(logData.playerName);
          if (logData.entityId) { pid = logData.entityId; setChampionEntityId(logData.entityId); }
          if (logData.origin) { origin = logData.origin; setChampionOrigin(logData.origin); }

          // Filter active quests that belong to THIS NPC
          npcActiveQuests = (logData.activeQuests ?? []).filter(
            (aq: any) => aq.npcEntityId === entity.id
          );
          setActiveQuests(npcActiveQuests);
        }
      } catch { /* ignore */ }
    }

    // Fetch available quests from this NPC (filtered by player progress)
    let availableQuests: AvailableQuestEntry[] = [];
    try {
      const url = pid
        ? `${API_URL}/quests/npc/${entity.id}?playerId=${pid}`
        : `${API_URL}/quests/npc/${entity.id}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        availableQuests = (data.quests ?? [])
          .map((q: any) => ({
            questId: q.id,
            title: q.title,
            description: q.description,
            npcEntityId: entity.id,
            npcName: entity.name,
            objective: q.objective,
            rewards: q.rewards,
          }))
          // Filter out quests already sent to the agent
          .filter((q: AvailableQuestEntry) => !sentQuestIds.has(q.questId));
      }
    } catch { /* ignore */ }

    setQuests(availableQuests);

    // Decide opening phase based on what's available
    if (availableQuests.length > 0) {
      // New quests to offer
      setGreetingText(pick(NPC_GREETINGS));
      setGreetingReply(getGreetingReply(origin));
      setPhase("greeting");
    } else if (npcActiveQuests.length > 0) {
      // No new quests but has active ones — show progress
      setGreetingText(pick(NPC_FOLLOWUP_LINES));
      setPhase("greeting");
    } else {
      // Nothing at all
      setGreetingText("I have nothing for you right now. Return later, champion.");
      setPhase("greeting");
    }
  });

  const handleNext = React.useCallback(() => {
    if (!done) { skip(); return; }

    if (phase === "greeting") {
      if (quests.length > 0) {
        setPhase("greeting_reply");
      } else if (activeQuests.length > 0) {
        // Skip to active quest progress
        setPhase("active");
      } else {
        setOpen(false);
      }
    } else if (phase === "greeting_reply") {
      if (quests.length > 0) {
        setPhase("quest");
      } else {
        setOpen(false);
      }
    } else if (phase === "quest") {
      const q = quests[selectedIdx];
      if (q) setQuestReply(getChampionQuestReply(q.objective, championOrigin));
      setPhase("quest_reply");
    } else if (phase === "quest_reply") {
      setPhase("rewards");
    } else if (phase === "rewards") {
      if (selectedIdx < quests.length - 1) {
        setSelectedIdx((i) => i + 1);
        setPhase("quest");
        setAccepted(false);
      } else if (activeQuests.length > 0) {
        // After all new quests, show active quest progress
        setPhase("active");
      } else {
        setOpen(false);
      }
    } else if (phase === "active") {
      if (activeIdx < activeQuests.length - 1) {
        setActiveIdx((i) => i + 1);
      } else {
        setOpen(false);
      }
    }
  }, [done, skip, phase, quests, selectedIdx, activeQuests, activeIdx, championOrigin]);

  const handleAccept = React.useCallback(() => {
    const q = quests[selectedIdx];
    if (!q || !npc) return;

    // Track this quest as sent so it won't re-appear
    sentQuestIds.add(q.questId);

    gameBus.emit("agentGoToNpc", {
      entityId: npc.id,
      zoneId: npc.zoneId ?? "",
      name: npc.name,
      type: "quest-giver",
      action: "accept-quest",
      questId: q.questId,
      questTitle: q.title,
    });

    setAccepted(true);
    setQuests((prev) => prev.filter((_, i) => i !== selectedIdx));
  }, [quests, selectedIdx, npc]);

  const handleClose = React.useCallback(() => { setOpen(false); }, []);

  // Keyboard handler
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
      else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (phase === "rewards" && !accepted) handleAccept();
        else handleNext();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, handleClose, handleNext, handleAccept, phase, accepted]);

  if (!open || !npc) return null;

  const q = quests[selectedIdx];
  const speakerName = isChampionSpeaking ? championName : npc.name;
  const speakerColor = isChampionSpeaking ? CHAMPION_COLOR : GOLD;
  const speakerIcon = isChampionSpeaking ? "\u2694" : "!";

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center"
      style={{ pointerEvents: "none" }}
    >
      <div
        className="fixed inset-0"
        style={{ background: "rgba(0,0,0,0.35)", pointerEvents: "auto" }}
        onClick={handleClose}
      />

      <div
        className="relative border-2 shadow-2xl select-none"
        style={{
          background: BG,
          borderColor: isChampionSpeaking ? "#1a3a4a" : BORDER,
          fontFamily: "monospace",
          color: TEXT,
          width: "min(680px, 95vw)",
          marginBottom: 24,
          pointerEvents: "auto",
        }}
      >
        {/* Speaker name plate */}
        <div
          className="flex items-center gap-2 px-4 py-2 border-b"
          style={{ borderColor: BORDER, background: BG_DARK }}
        >
          <div
            className="flex items-center justify-center border-2 text-sm font-bold"
            style={{
              width: 28, height: 28,
              borderColor: speakerColor, color: speakerColor,
              background: isChampionSpeaking ? "#0a1a2a" : "#1a1520",
            }}
          >
            {speakerIcon}
          </div>
          <span className="text-[13px] font-bold" style={{ color: speakerColor }}>
            {speakerName}
          </span>
          {isChampionSpeaking && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 border" style={{ borderColor: "#1a3a4a", color: CHAMPION_COLOR, background: "#0a1520" }}>
              YOUR CHAMPION
            </span>
          )}
          {q && !["greeting", "greeting_reply", "active"].includes(phase) && (
            <span className="ml-auto text-[10px] font-bold px-2 py-0.5 border" style={{ borderColor: "#1e2842", color: DIM }}>
              Quest {selectedIdx + 1}/{quests.length + (accepted ? 1 : 0)}
            </span>
          )}
          {phase === "active" && activeQuests.length > 1 && (
            <span className="ml-auto text-[10px] font-bold px-2 py-0.5 border" style={{ borderColor: "#1e2842", color: "#e0af68" }}>
              Active {activeIdx + 1}/{activeQuests.length}
            </span>
          )}
          <button
            onClick={handleClose}
            className="ml-auto text-[11px] font-bold px-2 py-0.5 border hover:opacity-80"
            style={{ borderColor: BORDER, color: DIM, background: "transparent", cursor: "pointer" }}
          >
            ESC
          </button>
        </div>

        {/* Quest title bar — for new quests */}
        {q && !["greeting", "greeting_reply", "active"].includes(phase) && (
          <div className="px-4 py-1.5 border-b" style={{ borderColor: "#1a2035", background: "#0d1322" }}>
            <span className="text-[12px] font-bold" style={{ color: TEXT }}>
              {q.title}
            </span>
            <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5" style={{
              color: q.objective.type === "kill" ? "#f25454" : q.objective.type === "gather" ? ACCENT : "#5dadec",
              background: "#0a0e18",
              border: `1px solid ${BORDER}`,
            }}>
              {q.objective.type.toUpperCase()}
            </span>
          </div>
        )}

        {/* Active quest title bar — for in-progress quests */}
        {phase === "active" && activeQuests[activeIdx] && (
          <div className="px-4 py-1.5 border-b" style={{ borderColor: "#1a2035", background: "#0d1322" }}>
            <span className="text-[12px] font-bold" style={{ color: TEXT }}>
              {activeQuests[activeIdx].title}
            </span>
            <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5" style={{
              color: activeQuests[activeIdx].complete ? ACCENT : "#e0af68",
              background: "#0a0e18",
              border: `1px solid ${BORDER}`,
            }}>
              {activeQuests[activeIdx].complete ? "READY" : "IN PROGRESS"}
            </span>
          </div>
        )}

        {/* Dialogue text area */}
        <div className="px-4 py-4" style={{ minHeight: 80 }}>
          <p className="text-[12px] leading-[1.6]" style={{ color: isChampionSpeaking ? CHAMPION_COLOR : TEXT, whiteSpace: "pre-wrap" }}>
            {displayed}
            {!done && <span className="animate-pulse" style={{ color: speakerColor }}>|</span>}
          </p>
        </div>

        {/* Objective + Rewards panel */}
        {phase === "rewards" && q && (
          <div className="px-4 pb-3 flex gap-4">
            <div className="flex-1 border p-2" style={{ borderColor: "#1e2842", background: BG_DARK }}>
              <div className="text-[8px] font-bold uppercase tracking-wider mb-1" style={{ color: DIM }}>Objective</div>
              <div className="text-[11px]" style={{ color: TEXT }}>{objectiveLabel(q.objective)}</div>
            </div>
            <div className="flex-1 border p-2" style={{ borderColor: "#1e2842", background: BG_DARK }}>
              <div className="text-[8px] font-bold uppercase tracking-wider mb-1" style={{ color: DIM }}>Rewards</div>
              <div className="text-[11px]" style={{ color: GOLD }}>{formatCopperString(q.rewards.copper)} gold</div>
              <div className="text-[11px]" style={{ color: "#5dadec" }}>{q.rewards.xp} XP</div>
            </div>
          </div>
        )}

        {/* Active quest progress bar */}
        {phase === "active" && activeQuests[activeIdx] && (() => {
          const aq = activeQuests[activeIdx];
          const pct = aq.required > 0 ? Math.min(100, Math.round((aq.progress / aq.required) * 100)) : 0;
          return (
            <div className="px-4 pb-3">
              <div className="border p-2" style={{ borderColor: "#1e2842", background: BG_DARK }}>
                <div className="flex justify-between mb-1">
                  <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: DIM }}>Progress</span>
                  <span className="text-[9px] font-bold" style={{ color: aq.complete ? ACCENT : "#e0af68" }}>
                    {aq.progress}/{aq.required}
                  </span>
                </div>
                <div className="h-[8px] border rounded-sm overflow-hidden" style={{ borderColor: BORDER, background: "#0a0e18" }}>
                  <div
                    className="h-full rounded-sm transition-all"
                    style={{ width: `${pct}%`, background: aq.complete ? ACCENT : "#e0af68" }}
                  />
                </div>
              </div>
            </div>
          );
        })()}

        {/* Action buttons */}
        <div
          className="flex items-center justify-between px-4 py-2 border-t"
          style={{ borderColor: BORDER, background: BG_DARK }}
        >
          <span className="text-[9px]" style={{ color: DIM }}>
            {!done ? "Click to skip" : phase === "rewards" ? "Space to send agent" : "Space to continue"}
          </span>

          <div className="flex gap-2">
            {phase === "rewards" && q && !accepted && (
              <button
                onClick={handleAccept}
                className="text-[11px] font-bold px-4 py-1.5 border-2 hover:brightness-110"
                style={{
                  borderColor: ACCENT, color: "#0a0e18", background: ACCENT,
                  cursor: "pointer",
                }}
              >
                SEND AGENT
              </button>
            )}

            {accepted && (
              <span className="text-[11px] font-bold px-4 py-1.5" style={{ color: ACCENT }}>
                AGENT DISPATCHED
              </span>
            )}

            {phase === "rewards" && !accepted && (
              <button
                onClick={handleNext}
                className="text-[11px] font-bold px-3 py-1.5 border hover:opacity-80"
                style={{ borderColor: BORDER, color: DIM, background: "transparent", cursor: "pointer" }}
              >
                {selectedIdx < quests.length - 1 ? "SKIP" : "DECLINE"}
              </button>
            )}

            {(phase !== "rewards" || accepted) && (
              <button
                onClick={handleNext}
                className="text-[11px] font-bold px-4 py-1.5 border-2 hover:brightness-110"
                style={{
                  borderColor: isChampionSpeaking ? CHAMPION_COLOR : GOLD,
                  color: "#0a0e18",
                  background: isChampionSpeaking ? CHAMPION_COLOR : GOLD,
                  cursor: "pointer",
                }}
              >
                {!done ? "SKIP" : phase === "greeting" && quests.length === 0 ? "CLOSE" : "NEXT"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
