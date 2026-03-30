/**
 * AgentChatPanel — Chat-first agent control panel.
 * No button grid. Chat IS the control surface.
 * Activity log streams inline so users see what the agent is doing and WHY.
 */

import * as React from "react";
import { API_URL } from "@/config";
import { getAuthToken, clearCachedToken } from "@/lib/agentAuth";
import { PaymentGate } from "@/components/PaymentGate";
import { gameBus } from "@/lib/eventBus";
import { WalletManager } from "@/lib/walletManager";
import { useWalletContext } from "@/context/WalletContext";
import { ChatLog } from "@/components/ChatLog";
import { trackGiveInstruction, trackAgentTaskStarted, trackAgentTaskCompleted, trackAgentProgressTick } from "@/lib/analytics";

interface InboxMessage {
  id: string;
  from: string;
  fromName: string;
  to: string;
  type: "direct" | "trade-request" | "party-invite" | "broadcast" | "quest-approval" | "system";
  body: string;
  data?: Record<string, unknown>;
  ts: number;
}

interface ChatMessage {
  key: string;
  role: "user" | "agent" | "activity" | "system";
  text: string;
  ts: number;
}

interface InboxConsoleMessage {
  key: string;
  role: "inbox" | "inbox-out";
  text: string;
  ts: number;
  inbox: InboxMessage | null;
  replyTo?: { wallet: string; name: string };
}

type ConsoleMessage = ChatMessage | InboxConsoleMessage;

interface InboxReplyTarget {
  wallet: string;
  name: string;
}

interface InboxReadMarker {
  ts: number;
  idsAtTs: string[];
}

interface AgentStatusData {
  running: boolean;
  config: {
    enabled: boolean;
    focus: string;
    strategy: string;
    targetZone?: string;
    chatHistory: { role: "user" | "agent" | "activity" | "system" | "question"; text: string; ts: number }[];
  } | null;
  entityId: string | null;
  zoneId: string | null;
  agentId?: string | null;
  characterTokenId?: string | null;
  custodialWallet: string | null;
  entity: {
    name: string;
    level: number;
    hp: number;
    maxHp: number;
  } | null;
  currentActivity: string | null;
  currentScript: { type: string; reason?: string } | null;
  telemetry: {
    loop: { count: number; avgMs: number; maxMs: number; lastMs: number };
    walletBalance: { count: number; avgMs: number; maxMs: number; lastMs: number };
    supervisor: { count: number; avgMs: number; maxMs: number; lastMs: number; errors: number };
    commands: { total: number; move: number; attack: number; travel: number; failed: number; lastAt: number | null };
    triggers: Record<string, number>;
    lastLoopAt: number | null;
  } | null;
}

type AgentHistoryEntry = NonNullable<AgentStatusData["config"]>["chatHistory"][number];

const FOCUS_COLORS: Record<string, string> = {
  questing: "#5dadec",
  combat: "#f25454",
  gathering: "#54f28b",
  traveling: "#e0af68",
  shopping: "#ffcc00",
  crafting: "#b48efa",
  alchemy: "#54dbb8",
  cooking: "#f2a854",
  enchanting: "#c792ea",
  idle: "#8b9abc",
};

const QUICK_SUGGESTIONS = [
  "fight stronger mobs",
  "go gather herbs",
  "play it safe",
  "head to the next zone",
  "buy better gear",
  "do some quests",
];

// ── Slash command registry (for autocomplete + highlighting) ──────────────
const SLASH_COMMANDS = [
  { cmd: "/help",     desc: "List all commands" },
  { cmd: "/status",   desc: "Your stats, HP, gear" },
  { cmd: "/who",      desc: "Online players" },
  { cmd: "/look",     desc: "Scan nearby entities" },
  { cmd: "/find",     desc: "Search by name" },
  { cmd: "/bag",      desc: "Inventory & gold" },
  { cmd: "/quests",   desc: "Active & available quests" },
  { cmd: "/map",      desc: "World map & zones" },
  { cmd: "/focus",    desc: "Change agent activity" },
  { cmd: "/strategy", desc: "Combat strategy" },
  { cmd: "/party",    desc: "Party members" },
  { cmd: "/travel",   desc: "Travel to a zone" },
  { cmd: "/where",    desc: "Current position" },
  { cmd: "/speak",    desc: "Speak publicly as your champion" },
];

const CMD_COLOR = "#c792ea";
const INBOX_TYPE_LABELS: Record<InboxMessage["type"], string> = {
  direct: "MSG",
  "trade-request": "TRADE",
  "party-invite": "PARTY",
  broadcast: "ZONE",
  "quest-approval": "QUEST",
  system: "EVENT",
};
const INBOX_TYPE_COLORS: Record<InboxMessage["type"], string> = {
  direct: "#54f28b",
  "trade-request": "#ffcc00",
  "party-invite": "#6ea8fe",
  broadcast: "#c084fc",
  "quest-approval": "#e0af68",
  system: "#ff9f43",
};

/** Highlight /commands in message text */
function renderWithCommands(text: string): React.ReactNode {
  const parts = text.split(/(\/[a-z]+)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    /^\/[a-z]+$/.test(part) ? (
      <span key={i} style={{ color: CMD_COLOR, fontWeight: 600 }}>{part}</span>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function activityLooksLikeInbox(text: string): boolean {
  return /^\[(MSG|BROADCAST)\]\s/i.test(text);
}

function toChatMessage(
  role: ChatMessage["role"],
  text: string,
  ts: number,
): ChatMessage {
  return {
    key: `chat:${role}:${ts}:${text}`,
    role,
    text,
    ts,
  };
}

function toInboxMessage(msg: InboxMessage): InboxConsoleMessage {
  return {
    key: `inbox:${msg.id}`,
    role: "inbox",
    text: msg.body,
    ts: msg.ts,
    inbox: msg,
  };
}

function toInboxOutMessage(
  text: string,
  ts: number,
  replyTo: { wallet: string; name: string },
): InboxConsoleMessage {
  return {
    key: `inbox-out:${replyTo.wallet}:${ts}:${text}`,
    role: "inbox-out",
    text,
    ts,
    inbox: null,
    replyTo,
  };
}

function inboxReadKey(walletAddress: string): string {
  return `wog:inbox-read:${walletAddress.toLowerCase()}`;
}

function loadInboxReadMarker(walletAddress: string): InboxReadMarker | null {
  try {
    const raw = localStorage.getItem(inboxReadKey(walletAddress));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<InboxReadMarker>;
    if (!Number.isFinite(parsed.ts)) return null;
    return {
      ts: Number(parsed.ts),
      idsAtTs: Array.isArray(parsed.idsAtTs) ? parsed.idsAtTs.map(String) : [],
    };
  } catch {
    return null;
  }
}

function saveInboxReadMarker(walletAddress: string, marker: InboxReadMarker): void {
  try {
    localStorage.setItem(inboxReadKey(walletAddress), JSON.stringify(marker));
  } catch {
    // Ignore persistence failures; session-level dedupe still applies.
  }
}

function buildInboxReadMarker(messages: InboxMessage[]): InboxReadMarker | null {
  if (messages.length === 0) return null;
  let latestTs = -1;
  for (const message of messages) latestTs = Math.max(latestTs, message.ts);
  return {
    ts: latestTs,
    idsAtTs: messages.filter((message) => message.ts === latestTs).map((message) => message.id),
  };
}

function isInboxMessageAfterMarker(message: InboxMessage, marker: InboxReadMarker | null): boolean {
  if (!marker) return false;
  if (message.ts > marker.ts) return true;
  if (message.ts < marker.ts) return false;
  return !marker.idsAtTs.includes(message.id);
}

function mergeConsoleMessages(prev: ConsoleMessage[], next: ConsoleMessage[]): ConsoleMessage[] {
  if (next.length === 0) return prev;
  const merged = new Map<string, ConsoleMessage>();
  for (const message of prev) merged.set(message.key, message);
  for (const message of next) merged.set(message.key, message);
  return Array.from(merged.values()).sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    return a.key.localeCompare(b.key);
  });
}

function mapServerHistoryEntry(
  entry: AgentHistoryEntry,
): ChatMessage | null {
  if (!["user", "agent", "activity", "system"].includes(entry.role)) return null;
  if (entry.role === "activity" && activityLooksLikeInbox(entry.text)) return null;
  return toChatMessage(entry.role as ChatMessage["role"], entry.text, entry.ts);
}

// ── Component ─────────────────────────────────────────────────────────────

interface AgentChatPanelProps {
  walletAddress: string;
  currentZone?: string | null;
  className?: string;
}

export function AgentChatPanel({ walletAddress, currentZone, className = "" }: AgentChatPanelProps): React.ReactElement {
  const { characters, selectedCharacterTokenId } = useWalletContext();
  const [messages, setMessages] = React.useState<ConsoleMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [deploying, setDeploying] = React.useState(false);
  const [showDeployPayment, setShowDeployPayment] = React.useState(false);
  const [deployCount, setDeployCount] = React.useState<number | null>(null);
  const [status, setStatus] = React.useState<AgentStatusData | null>(null);
  const [token, setToken] = React.useState<string | null>(null);
  const [authLoading, setAuthLoading] = React.useState(true);
  const [collapsed, setCollapsed] = React.useState(false);
  const [showStopConfirm, setShowStopConfirm] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<"chat" | "zonelog">("chat");
  const [pendingGoto, setPendingGoto] = React.useState<{ entityId: string; zoneId: string; name: string; teachesProfession?: string; action?: string; questId?: string; questTitle?: string } | null>(null);
  const [cmdSuggestions, setCmdSuggestions] = React.useState<typeof SLASH_COMMANDS>([]);
  const [selectedSuggestion, setSelectedSuggestion] = React.useState(0);
  const [replyTarget, setReplyTarget] = React.useState<InboxReplyTarget | null>(null);
  const [questResponses, setQuestResponses] = React.useState<Record<string, "accepted" | "denied">>({});
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const inboxMessageIds = React.useRef<Set<string>>(new Set());
  const inboxReadMarker = React.useRef<InboxReadMarker | null>(null);
  const seededServerHistory = React.useRef(false);
  const lastProgressTickRef = React.useRef(0);

  // Auto-scroll on new messages
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  React.useEffect(() => {
    setMessages([]);
    setInput("");
    setReplyTarget(null);
    setQuestResponses({});
    inboxMessageIds.current = new Set();
    inboxReadMarker.current = loadInboxReadMarker(walletAddress);
    seededServerHistory.current = false;
  }, [walletAddress]);

  React.useEffect(() => {
    if (replyTarget) inputRef.current?.focus();
  }, [replyTarget]);

  // Get auth token once
  React.useEffect(() => {
    let cancelled = false;
    async function fetchToken() {
      setAuthLoading(true);
      const t = await getAuthToken(walletAddress);
      if (!cancelled) { setToken(t); setAuthLoading(false); }
      // Fetch deploy count once we have a token
      if (t && !cancelled) {
        try {
          const res = await fetch(`${API_URL}/agent/deploy-info`, {
            headers: { Authorization: `Bearer ${t}` },
          });
          if (res.ok) {
            const info = await res.json();
            if (!cancelled) setDeployCount(info.deployCount ?? 0);
          }
        } catch { /* non-critical */ }
      }
    }
    fetchToken();
    return () => { cancelled = true; };
  }, [walletAddress]);

  // Poll agent status every 3s
  React.useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function pollStatus() {
      if (cancelled || !token) return;
      try {
        const res = await fetch(`${API_URL}/agent/status/${walletAddress}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && !cancelled) {
          const data: AgentStatusData = await res.json();
          setStatus(data);

          // Track agent progress at most once per 60s
          if (data.running && data.entity) {
            const now = Date.now();
            if (now - lastProgressTickRef.current >= 60_000) {
              lastProgressTickRef.current = now;
              trackAgentProgressTick({
                walletAddress,
                focus: data.config?.focus ?? undefined,
                level: data.entity.level,
                zoneId: data.zoneId ?? undefined,
              });
            }
          }

          // Sync custodial wallet so balance queries hit the right address
          if (data.custodialWallet) {
            WalletManager.getInstance().setCustodialAddress(data.custodialWallet);
          }

          const serverHistory = data.config?.chatHistory ?? [];
          const mappedHistory = serverHistory
            .map((entry) => mapServerHistoryEntry(entry))
            .filter((entry): entry is ChatMessage => entry != null);
          if (mappedHistory.length > 0) {
            setMessages((prev) => {
              const hasConsoleChat = prev.some((message) => message.role !== "inbox" && message.role !== "inbox-out");
              if (!seededServerHistory.current && !hasConsoleChat) {
                seededServerHistory.current = true;
                return mergeConsoleMessages(prev, mappedHistory);
              }
              seededServerHistory.current = true;
              return mergeConsoleMessages(
                prev,
                mappedHistory.filter((message) => message.role === "activity" || message.role === "system"),
              );
            });
          }
        } else if (res.status === 401) {
          clearCachedToken();
        }
      } catch {}
    }

    pollStatus();
    const id = setInterval(pollStatus, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token, walletAddress]);

  // Poll inbox history so direct messages surface in the console even when the agent loop is idle.
  React.useEffect(() => {
    if (!walletAddress) return;
    let cancelled = false;

    async function pollInbox() {
      try {
        const res = await fetch(`${API_URL}/inbox/${walletAddress}/history?limit=50`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const history = Array.isArray(data.messages) ? data.messages as InboxMessage[] : [];
        const latestMarker = buildInboxReadMarker(history);

        // First load establishes the read baseline for this wallet so historical
        // inbox items do not replay into the console every time the user logs in.
        if (!inboxReadMarker.current) {
          if (latestMarker) {
            inboxReadMarker.current = latestMarker;
            saveInboxReadMarker(walletAddress, latestMarker);
          }
          return;
        }

        const newConsoleMessages: InboxConsoleMessage[] = [];

        for (const msg of history) {
          if (!isInboxMessageAfterMarker(msg, inboxReadMarker.current)) continue;
          if (inboxMessageIds.current.has(msg.id)) continue;
          inboxMessageIds.current.add(msg.id);
          newConsoleMessages.push(toInboxMessage(msg));
        }

        if (latestMarker) {
          inboxReadMarker.current = latestMarker;
          saveInboxReadMarker(walletAddress, latestMarker);
        }

        if (!cancelled && newConsoleMessages.length > 0) {
          setMessages((prev) => mergeConsoleMessages(prev, newConsoleMessages));
        }
      } catch {
        // silent
      }
    }

    void pollInbox();
    const id = setInterval(() => {
      void pollInbox();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [walletAddress]);

  // ── Actions ─────────────────────────────────────────────────────────────

  async function executeDeploy() {
    if (!token || deploying) return;
    setDeploying(true);
    addSystemMsg("Deploying agent...");
    try {
      // Send character info — use selected character if set, otherwise first
      const primary = (selectedCharacterTokenId
        ? characters.find((c) => c.tokenId === selectedCharacterTokenId)
        : null) ?? characters[0];
      const deployBody: Record<string, string | undefined> = { walletAddress };
      if (primary) {
        deployBody.characterName = primary.name;
        deployBody.raceId = primary.properties.race;
        deployBody.classId = primary.properties.class;
      }
      trackAgentTaskStarted({ walletAddress, characterName: primary?.name });
      const res = await fetch(`${API_URL}/agent/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(deployBody),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.custodialWallet) {
          WalletManager.getInstance().setCustodialAddress(data.custodialWallet);
        }
        trackAgentTaskCompleted({ walletAddress, entityId: data.entityId, zoneId: data.zoneId });
        addSystemMsg(`Agent deployed! Entity: ${data.entityId} in ${data.zoneId}`);
        if (data.zoneId) {
          gameBus.emit("switchZone", { zoneId: data.zoneId });
        }
        if (walletAddress) {
          gameBus.emit("lockToPlayer", { walletAddress });
        }
      } else {
        addSystemMsg(`[ERR] ${data.error ?? "Deploy failed"}`);
      }
    } catch (err: any) {
      addSystemMsg(`[ERR] ${err.message}`);
    } finally {
      setDeploying(false);
    }
  }

  async function handleStop() {
    if (!token) return;
    setShowStopConfirm(false);
    try {
      await fetch(`${API_URL}/agent/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ walletAddress }),
      });
      addSystemMsg("Agent stopped.");
    } catch {}
  }

  async function handleSend(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || !token || sending) return;

    setInput("");
    setSending(true);
    const ts = Date.now();

    const speakMatch = !replyTarget ? msg.match(/^\/(?:speak|say)\s+(.+)$/is) : null;
    if (speakMatch) {
      const spokenText = speakMatch[1]?.trim().slice(0, 200) ?? "";
      setMessages((prev) => mergeConsoleMessages(prev, [toChatMessage("user", msg, ts)]));

      if (!spokenText) {
        addSystemMsg("[ERR] Usage: /speak <message>");
        setSending(false);
        return;
      }

      if (!status?.entityId) {
        addSystemMsg("[ERR] Deploy your champion before using /speak.");
        setSending(false);
        return;
      }

      try {
        const res = await fetch(`${API_URL}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ entityId: status.entityId, message: spokenText }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setMessages((prev) => mergeConsoleMessages(prev, [
            toChatMessage("activity", `✓ Spoke publicly: "${spokenText}"`, Date.now()),
          ]));
        } else {
          addSystemMsg(`[ERR] ${data.error ?? "Speak failed"}`);
        }
      } catch (err: any) {
        addSystemMsg(`[ERR] ${err.message}`);
      } finally {
        setSending(false);
      }
      return;
    }

    if (replyTarget) {
      try {
        const res = await fetch(`${API_URL}/inbox/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ to: replyTarget.wallet, type: "direct", body: msg }),
        });
        const data = await res.json();
        if (res.ok) {
          setMessages((prev) => mergeConsoleMessages(prev, [
            toInboxOutMessage(msg, ts, { wallet: replyTarget.wallet, name: replyTarget.name }),
          ]));
          setReplyTarget(null);
        } else {
          addSystemMsg(`[ERR] ${data.error ?? "Reply failed"}`);
        }
      } catch (err: any) {
        addSystemMsg(`[ERR] ${err.message}`);
      } finally {
        setSending(false);
      }
      return;
    }

    setMessages((prev) => mergeConsoleMessages(prev, [toChatMessage("user", msg, ts)]));
    trackGiveInstruction({ walletAddress, message: msg });

    try {
      const res = await fetch(`${API_URL}/agent/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: msg }),
      });

      if (res.status === 401) {
        clearCachedToken();
        addSystemMsg("[ERR] Session expired. Please refresh the page.");
        return;
      }

      const data = await res.json();
      if (res.ok) {
        setMessages((prev) => mergeConsoleMessages(prev, [
          toChatMessage("agent", data.response, Date.now()),
        ]));
      } else {
        addSystemMsg(`[ERR] ${data.error ?? "Chat failed"}`);
      }
    } catch (err: any) {
      addSystemMsg(`[ERR] ${err.message}`);
    } finally {
      setSending(false);
    }
  }

  function addSystemMsg(text: string) {
    setMessages((prev) => mergeConsoleMessages(prev, [toChatMessage("system", text, Date.now())]));
  }

  async function handleQuestApproval(msg: InboxMessage, approved: boolean) {
    if (!token || sending) return;
    const questId = msg.data?.questId as string | undefined;
    if (!questId) return;

    setSending(true);
    try {
      const res = await fetch(`${API_URL}/inbox/quest-approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ questId, approved }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setQuestResponses((prev) => ({ ...prev, [msg.id]: approved ? "accepted" : "denied" }));
        addSystemMsg(approved ? "Quest approved." : "Quest denied.");
      } else {
        addSystemMsg(`[ERR] ${data.error ?? "Quest response failed"}`);
      }
    } catch (err: any) {
      addSystemMsg(`[ERR] ${err.message}`);
    } finally {
      setSending(false);
    }
  }

  function startReply(msg: InboxMessage) {
    setReplyTarget({
      wallet: msg.from,
      name: msg.fromName || msg.from.slice(0, 8),
    });
  }

  // Listen for NPC clicks — show a confirmation prompt, don't auto-redirect
  React.useEffect(() => {
    return gameBus.on("agentGoToNpc", ({ entityId, zoneId, name, teachesProfession, action, questId, questTitle }) => {
      setPendingGoto({ entityId, zoneId, name, teachesProfession, action, questId, questTitle });
    });
  }, []);

  async function confirmGoto(actionOverride?: string) {
    if (!pendingGoto || !token) return;
    const { entityId, zoneId, name, teachesProfession, action: pendingAction, questId, questTitle } = pendingGoto;
    setPendingGoto(null);
    const action = actionOverride ?? pendingAction;

    const label = action === "learn-profession" && teachesProfession
      ? `Learning ${teachesProfession} from ${name}...`
      : action === "accept-quest" && questTitle
      ? `Sending agent to accept "${questTitle}" from ${name}...`
      : action === "complete-quest" && questTitle
      ? `Sending agent to turn in "${questTitle}"...`
      : `Sending agent to ${name}...`;
    addSystemMsg(label);
    try {
      const body: Record<string, string> = { entityId, zoneId, name };
      if (action === "learn-profession" && teachesProfession) {
        body.action = "learn-profession";
        body.profession = teachesProfession;
      } else if (action === "accept-quest" && questId) {
        body.action = "accept-quest";
        body.questId = questId;
      } else if (action === "complete-quest" && questId) {
        body.action = "complete-quest";
        body.questId = questId;
      }
      const res = await fetch(`${API_URL}/agent/goto-npc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) addSystemMsg(`[ERR] ${data.error ?? "Could not send agent"}`);
    } catch (err: any) {
      addSystemMsg(`[ERR] ${err.message}`);
    }
  }

  // ── Derived state ───────────────────────────────────────────────────────

  const isRunning = status?.running ?? false;
  const isDeployed = isRunning || (status?.config?.enabled === true && status?.entityId != null);
  const entityName = status?.entity?.name ?? "Agent";
  const focus = status?.config?.focus ?? "idle";
  const focusColor = FOCUS_COLORS[focus] ?? "#8b9abc";
  const hp = status?.entity?.hp;
  const maxHp = status?.entity?.maxHp;
  const zoneId = status?.zoneId ?? "—";
  const activity = status?.currentActivity;

  const hpPct = hp != null && maxHp ? Math.round((hp / Math.max(maxHp, 1)) * 100) : null;
  const hpColor = hpPct == null ? "#8b9abc" : hpPct > 60 ? "#54f28b" : hpPct > 30 ? "#e0af68" : "#f25454";

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      data-tutorial-id="agent-chat-panel"
      className={`flex min-h-0 w-full max-w-none flex-col overflow-hidden border-2 border-[#54f28b] bg-[#060d12] font-mono shadow-[4px_4px_0_0_#000] ${collapsed ? "" : "h-full"} ${className}`}
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b-2 border-[#54f28b] bg-[#0a1a0e] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-[12px] text-[#54f28b] hover:text-[#ffcc00] transition-colors"
            type="button"
          >
            {collapsed ? "+" : "−"}
          </button>
          <span className="text-[11px] text-[#54f28b] uppercase tracking-widest">
            {">> "}
            <span className="text-[#ffcc00]">Console</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isDeployed && (
            <button
              onClick={() => gameBus.emit("questLogOpen", undefined as never)}
              className="text-[11px] text-[#7a8b9e] hover:text-[#5dadec] transition-colors uppercase tracking-widest"
              title="Open quest log"
            >
              [quests]
            </button>
          )}
          {isDeployed && (
            <button
              onClick={() => setViewMode(viewMode === "chat" ? "zonelog" : "chat")}
              className="text-[11px] text-[#7a8b9e] hover:text-[#7dcfff] transition-colors uppercase tracking-widest"
              title={viewMode === "chat" ? "Show zone log" : "Show chat"}
            >
              {viewMode === "chat" ? "[log]" : "[chat]"}
            </button>
          )}
          {isDeployed && (
            <button
              onClick={() => setShowStopConfirm(true)}
              className="text-[11px] text-[#7a8b9e] hover:text-[#ff4d6d] transition-colors uppercase tracking-widest"
              title="Stop agent"
            >
              [stop]
            </button>
          )}
          {isRunning && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#54f28b] opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#54f28b]" />
            </span>
          )}
        </div>
      </div>

      {!collapsed && <>
      {/* ── Status strip ───────────────────────────────────────────── */}
      {isDeployed && status && (
        <div className="border-b border-[#1a2a18] bg-[#080f0a] px-3 py-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Focus pill */}
            <span
              className="text-[11px] font-bold uppercase tracking-widest px-1.5 py-0.5 border rounded-sm"
              style={{ color: focusColor, borderColor: `${focusColor}66`, background: `${focusColor}12` }}
            >
              {focus}
            </span>
            {/* Zone */}
            <span className="text-[11px] text-[#8b9abc]">{zoneId}</span>
            {/* HP bar */}
            {hpPct != null && (
              <div className="flex items-center gap-1 ml-auto">
                <div className="w-12 h-1 bg-[#1a2a18] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${hpPct}%`, background: hpColor }}
                  />
                </div>
                <span className="text-[11px]" style={{ color: hpColor }}>
                  {hp}/{maxHp}
                </span>
              </div>
            )}
          </div>
          {/* Current activity ticker */}
          {activity && (
            <div className="text-[11px] mt-1 truncate" style={{ color: activity.startsWith("⚠") ? "#e0af68" : "#7ab893" }}>
              {activity.startsWith("⚠") ? activity : `▸ ${activity}`}
            </div>
          )}
          {status.telemetry && (
            <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-[#5f6b8f]">
              <span>loop {Math.round(status.telemetry.loop.avgMs)}ms</span>
              <span>balance {Math.round(status.telemetry.walletBalance.avgMs)}ms</span>
              <span>supervisor {Math.round(status.telemetry.supervisor.avgMs)}ms</span>
              <span>cmd {status.telemetry.commands.total}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Zone log view ────────────────────────────────────────── */}
      {viewMode === "zonelog" && isDeployed && (
        <ChatLog zoneId={status?.zoneId ?? null} embedded />
      )}

      {/* ── Message stream ─────────────────────────────────────────── */}
      {viewMode === "chat" && (
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#1a3a22 transparent" }}
      >
        {/* Not deployed state */}
        {!isDeployed && !authLoading && (
          <div className="flex flex-col items-center gap-3 py-6">
            <p className="text-[11px] text-[#8b9abc] text-center leading-relaxed">
              Deploy your AI agent to start.<br />
              <span className="text-[#7a8b9e]">Talk to it in chat to control what it does.</span>
            </p>
            <button
              onClick={() => {
                void executeDeploy();
              }}
              disabled={deploying || authLoading || !token}
              className="border border-[#54f28b] bg-[#0a1a0e] px-4 py-1.5 text-[12px] uppercase tracking-widest text-[#54f28b] transition hover:bg-[#112a1b] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deploying ? "Deploying..." : "[▶] Deploy Agent"}
            </button>
            <p className="text-[9px] text-[#565f89] text-center mt-1">
              Free to deploy
            </p>
          </div>
        )}

        {authLoading && (
          <p className="text-[12px] text-[#6b7394] animate-pulse py-4 text-center">Authenticating...</p>
        )}

        {/* Empty state hint */}
        {isDeployed && messages.length === 0 && !authLoading && (
          <p className="text-[12px] text-[#6b7394] italic text-center py-2">
            Your agent is active. Try telling it what to do...
          </p>
        )}

        {/* Messages */}
        {messages.map((m) => (
          <div key={m.key} className="text-[12px] leading-relaxed">
            {m.role === "user" && (
              <div className="flex gap-1">
                <span className="text-[#ffcc00] shrink-0">[You]</span>
                <span className="text-[#d6deff]">{renderWithCommands(m.text)}</span>
              </div>
            )}
            {m.role === "agent" && (
              <div className="flex gap-1">
                <span className="text-[#54f28b] shrink-0">[{entityName}]</span>
                <span className="text-[#9aa7cc]">{renderWithCommands(m.text)}</span>
              </div>
            )}
            {m.role === "activity" && (
              <div className="flex gap-1" style={{ color: m.text.startsWith("⚠") ? "#e0af68" : m.text.startsWith("✓") ? "#54f28b" : "#8bb8a4" }}>
                <span className="shrink-0">{m.text.startsWith("⚠") ? "⚠" : m.text.startsWith("✓") ? "✓" : "▸"}</span>
                <span>
                  {m.text.startsWith("⚠") || m.text.startsWith("✓") ? renderWithCommands(m.text.slice(2)) : renderWithCommands(m.text)}
                </span>
              </div>
            )}
            {m.role === "system" && (
              <span className="text-[#7a84ad] italic">{renderWithCommands(m.text)}</span>
            )}
            {m.role === "inbox" && m.inbox && (
              <div
                className="border px-2 py-1.5 space-y-1"
                style={{
                  borderColor: `${INBOX_TYPE_COLORS[m.inbox.type]}44`,
                  backgroundColor: "#0b1120",
                }}
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className="text-[9px] font-bold uppercase px-1 py-[1px] border"
                    style={{
                      color: INBOX_TYPE_COLORS[m.inbox.type],
                      borderColor: `${INBOX_TYPE_COLORS[m.inbox.type]}55`,
                    }}
                  >
                    {INBOX_TYPE_LABELS[m.inbox.type]}
                  </span>
                  <span className="text-[#7dcfff]">[{m.inbox.fromName || m.inbox.from.slice(0, 8)}]</span>
                  <span className="text-[10px] text-[#5f6b8f]">{timeAgo(m.inbox.ts)}</span>
                  {m.inbox.type !== "broadcast" && m.inbox.type !== "system" && m.inbox.type !== "quest-approval" && (
                    <button
                      type="button"
                      onClick={() => startReply(m.inbox!)}
                      className="ml-auto text-[10px] uppercase tracking-widest text-[#6ea8fe] hover:text-[#9ec5fe]"
                    >
                      [reply]
                    </button>
                  )}
                </div>
                <div className="text-[#d6deff] whitespace-pre-wrap break-words">
                  {renderWithCommands(m.inbox.body)}
                </div>
                {m.inbox.type === "quest-approval" && (
                  <div className="flex items-center gap-2 pt-1">
                    {questResponses[m.inbox.id] ? (
                      <span
                        className="text-[10px] uppercase tracking-widest"
                        style={{ color: questResponses[m.inbox.id] === "accepted" ? "#54f28b" : "#f25454" }}
                      >
                        [{questResponses[m.inbox.id]}]
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleQuestApproval(m.inbox!, true)}
                          disabled={sending}
                          className="border border-[#54f28b] px-2 py-0.5 text-[10px] uppercase tracking-widest text-[#54f28b] hover:bg-[#0f2115] disabled:opacity-40"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleQuestApproval(m.inbox!, false)}
                          disabled={sending}
                          className="border border-[#f25454] px-2 py-0.5 text-[10px] uppercase tracking-widest text-[#f25454] hover:bg-[#220d12] disabled:opacity-40"
                        >
                          Deny
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            {m.role === "inbox-out" && m.replyTo && (
              <div className="flex gap-1">
                <span className="text-[#6ea8fe] shrink-0">[To {m.replyTo.name}]</span>
                <span className="text-[#d6deff]">{renderWithCommands(m.text)}</span>
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="text-[12px] text-[#6b7394] animate-pulse">Working...</div>
        )}
      </div>
      )}

      {/* ── Quick suggestions ──────────────────────────────────────── */}
      {viewMode === "chat" && isDeployed && !sending && !replyTarget && messages.length < 3 && (
        <div className="flex gap-1 px-3 py-1.5 overflow-x-auto border-t border-[#1a2a18]" style={{ scrollbarWidth: "none" }}>
          {QUICK_SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => void handleSend(s)}
              disabled={!token || sending}
              className="shrink-0 border border-[#1a2a18] bg-[#080f0a] px-2 py-0.5 text-[11px] text-[#7ab893] rounded-sm transition hover:border-[#2d5a3d] hover:text-[#54f28b] hover:bg-[#0a1a0e] disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* ── Chat input ─────────────────────────────────────────────── */}
      {isDeployed && viewMode === "chat" && (
        <div className="border-t-2 border-[#1a2a18] bg-[#080f0a] p-2">
          {replyTarget && (
            <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-[#9ec5fe]">
              <span className="truncate">
                Replying to <span className="text-[#6ea8fe]">{replyTarget.name}</span>
              </span>
              <button
                type="button"
                onClick={() => setReplyTarget(null)}
                className="text-[#6b7394] hover:text-[#9aa7cc] uppercase tracking-widest"
              >
                [cancel]
              </button>
            </div>
          )}
          <div className="flex gap-1 relative">
            {/* Autocomplete dropdown */}
            {cmdSuggestions.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-1 border border-[#2a3450] bg-[#0b1020] z-50 max-h-[160px] overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "#1a3a22 transparent" }}>
                {cmdSuggestions.map((s, i) => (
                  <button
                    key={s.cmd}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setInput(s.cmd + " ");
                      setCmdSuggestions([]);
                      setSelectedSuggestion(0);
                    }}
                    className={`w-full text-left px-2 py-1 text-[12px] flex items-center gap-2 transition-colors ${
                      i === selectedSuggestion ? "bg-[#1a2a3a]" : "hover:bg-[#111a28]"
                    }`}
                  >
                    <span style={{ color: CMD_COLOR, fontWeight: 600 }}>{s.cmd}</span>
                    <span className="text-[#5f6b8f] text-[11px]">{s.desc}</span>
                  </button>
                ))}
              </div>
            )}
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => {
                const val = e.target.value;
                setInput(val);
                // Update autocomplete suggestions
                if (!replyTarget && val.startsWith("/") && !val.includes(" ")) {
                  const q = val.toLowerCase();
                  const matches = SLASH_COMMANDS.filter((c) => c.cmd.startsWith(q));
                  setCmdSuggestions(matches);
                  setSelectedSuggestion(0);
                } else {
                  setCmdSuggestions([]);
                }
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (!replyTarget && cmdSuggestions.length > 0) {
                  if (e.key === "Tab" || e.key === "ArrowRight") {
                    e.preventDefault();
                    const pick = cmdSuggestions[selectedSuggestion];
                    if (pick) { setInput(pick.cmd + " "); setCmdSuggestions([]); setSelectedSuggestion(0); }
                    return;
                  }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSelectedSuggestion((prev) => Math.min(prev + 1, cmdSuggestions.length - 1));
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSelectedSuggestion((prev) => Math.max(prev - 1, 0));
                    return;
                  }
                  if (e.key === "Escape") {
                    setCmdSuggestions([]);
                    setSelectedSuggestion(0);
                    return;
                  }
                  if (e.key === "Enter") {
                    // If they have a suggestion highlighted and typed partial, complete it first
                    const pick = cmdSuggestions[selectedSuggestion];
                    if (pick && input !== pick.cmd && input !== pick.cmd + " ") {
                      e.preventDefault();
                      setInput(pick.cmd + " ");
                      setCmdSuggestions([]);
                      setSelectedSuggestion(0);
                      return;
                    }
                  }
                }
                if (e.key === "Enter") void handleSend();
              }}
              onBlur={() => { setTimeout(() => setCmdSuggestions([]), 150); }}
              placeholder={replyTarget ? `Reply to ${replyTarget.name}...` : "Tell your agent what to do... (/ for commands)"}
              disabled={!token || sending || authLoading}
              className="flex-1 border border-[#2a3450] bg-[#0b1020] px-2 py-1 text-[12px] text-[#d6deff] placeholder-[#6b7394] outline-none focus:border-[#54f28b] disabled:opacity-40"
            />
            <button
              onClick={() => void handleSend()}
              disabled={!input.trim() || !token || sending || authLoading}
              className="border border-[#54f28b] bg-[#0a1a0e] px-2 py-1 text-[12px] text-[#54f28b] transition hover:bg-[#112a1b] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {replyTarget ? "[DM]" : "[→]"}
            </button>
          </div>
        </div>
      )}

      {/* ── Stop confirmation ──────────────────────────────────────── */}
      {/* ── Send-agent-here confirmation ─────────────────────────── */}
      {pendingGoto && (
        <div className="absolute bottom-[56px] left-2 right-2 z-40 rounded border border-[#e0af68] bg-[#0d0c07] px-3 py-2 font-mono shadow-[4px_4px_0_0_#000]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0 break-words text-[10px] leading-relaxed text-[#e0af68] sm:text-[11px]">
            {pendingGoto.action === "accept-quest" && pendingGoto.questTitle
              ? <>Accept <span className="text-[#ffcc00]">"{pendingGoto.questTitle}"</span> from {pendingGoto.name}?</>
              : pendingGoto.action === "complete-quest" && pendingGoto.questTitle
              ? <>Turn in <span className="text-[#ffcc00]">"{pendingGoto.questTitle}"</span>?</>
              : pendingGoto.teachesProfession
              ? <>Learn <span className="text-[#ffcc00]">{pendingGoto.teachesProfession}</span> from {pendingGoto.name}?</>
              : <>→ Send agent to <span className="text-[#ffcc00]">{pendingGoto.name}</span>?</>
            }
            </span>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {pendingGoto.action === "accept-quest" && (
                <button
                  onClick={() => void confirmGoto("accept-quest")}
                  disabled={!token || !isRunning}
                  className="border border-[#54f28b] px-2 py-0.5 text-[10px] text-[#54f28b] uppercase tracking-widest hover:bg-[#001a0d] disabled:opacity-40"
                >
                  Accept
                </button>
              )}
              {pendingGoto.action === "complete-quest" && (
                <button
                  onClick={() => void confirmGoto("complete-quest")}
                  disabled={!token || !isRunning}
                  className="border border-[#f2c854] px-2 py-0.5 text-[10px] text-[#f2c854] uppercase tracking-widest hover:bg-[#1a1600] disabled:opacity-40"
                >
                  Turn In
                </button>
              )}
              {pendingGoto.teachesProfession && (
                <button
                  onClick={() => void confirmGoto("learn-profession")}
                  disabled={!token || !isRunning}
                  className="border border-[#00ff9d] px-2 py-0.5 text-[10px] text-[#00ff9d] uppercase tracking-widest hover:bg-[#001a0d] disabled:opacity-40"
                >
                  Learn
                </button>
              )}
              {!pendingGoto.action && (
                <button
                  onClick={() => void confirmGoto()}
                  disabled={!token || !isRunning}
                  className="border border-[#e0af68] px-2 py-0.5 text-[10px] text-[#e0af68] uppercase tracking-widest hover:bg-[#1a1600] disabled:opacity-40"
                >
                  Go
                </button>
              )}
              <button
                onClick={() => setPendingGoto(null)}
                className="border border-[#6b7394] px-2 py-0.5 text-[10px] text-[#8b9abc] uppercase tracking-widest hover:bg-[#0a0e14]"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {showStopConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="border border-[#ff4d6d] bg-[#0a0508] p-4 font-mono text-center">
            <p className="text-[12px] text-[#9aa7cc] mb-3">Stop your agent?</p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => void handleStop()}
                className="border border-[#ff4d6d] px-3 py-1 text-[11px] text-[#ff4d6d] uppercase tracking-widest hover:bg-[#1a0a0e]"
              >
                Stop
              </button>
              <button
                onClick={() => setShowStopConfirm(false)}
                className="border border-[#6b7394] px-3 py-1 text-[11px] text-[#8b9abc] uppercase tracking-widest hover:bg-[#0a0e14]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deploy payment overlay */}
      {showDeployPayment && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 px-4">
          <div className="w-full max-w-sm border-4 border-[#54f28b] bg-[#060d12] font-mono shadow-[8px_8px_0_0_#000]">
            <div className="flex items-center justify-between border-b-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-2">
              <span className="text-[11px] uppercase tracking-widest text-[#54f28b]">
                {">> ADDITIONAL AGENT FEE"}
              </span>
              <button
                onClick={() => setShowDeployPayment(false)}
                className="text-[12px] text-[#54f28b] hover:text-[#ffcc00] transition-colors"
              >
                [X]
              </button>
            </div>
            <div className="p-5">
              <PaymentGate
                label="Additional Agent — $2 USDC per champion"
                amount="2"
                onSuccess={() => {
                  setShowDeployPayment(false);
                  void executeDeploy();
                }}
                onCancel={() => setShowDeployPayment(false)}
              />
            </div>
          </div>
        </div>
      )}
      </>}
    </div>
  );
}
