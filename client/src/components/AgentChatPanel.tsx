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

interface ChatMessage {
  role: "user" | "agent" | "activity" | "system";
  text: string;
  ts: number;
}

interface AgentStatusData {
  running: boolean;
  config: {
    enabled: boolean;
    focus: string;
    strategy: string;
    targetZone?: string;
    chatHistory: { role: "user" | "agent" | "activity"; text: string; ts: number }[];
  } | null;
  entityId: string | null;
  zoneId: string | null;
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
];

const CMD_COLOR = "#c792ea";

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

// ── Component ─────────────────────────────────────────────────────────────

interface AgentChatPanelProps {
  walletAddress: string;
  currentZone?: string | null;
  className?: string;
}

export function AgentChatPanel({ walletAddress, currentZone, className = "" }: AgentChatPanelProps): React.ReactElement {
  const { characters, selectedCharacterTokenId } = useWalletContext();
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
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
  const [pendingGoto, setPendingGoto] = React.useState<{ entityId: string; zoneId: string; name: string; teachesProfession?: string } | null>(null);
  const [cmdSuggestions, setCmdSuggestions] = React.useState<typeof SLASH_COMMANDS>([]);
  const [selectedSuggestion, setSelectedSuggestion] = React.useState(0);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const lastSyncTs = React.useRef(0);

  // Auto-scroll on new messages
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

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

          // Sync custodial wallet so balance queries hit the right address
          if (data.custodialWallet) {
            WalletManager.getInstance().setCustodialAddress(data.custodialWallet);
          }

          const serverHistory = data.config?.chatHistory ?? [];
          if (serverHistory.length > 0) {
            setMessages((prev) => {
              if (prev.length === 0) {
                lastSyncTs.current = serverHistory[serverHistory.length - 1].ts;
                return serverHistory.map((m) => ({ role: m.role, text: m.text, ts: m.ts }));
              }
              const newActivities = serverHistory.filter(
                (m) => m.role === "activity" && m.ts > lastSyncTs.current
              );
              if (newActivities.length > 0) {
                lastSyncTs.current = newActivities[newActivities.length - 1].ts;
                return [
                  ...prev,
                  ...newActivities.map((m) => ({ role: m.role as ChatMessage["role"], text: m.text, ts: m.ts })),
                ];
              }
              return prev;
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
    setMessages((prev) => [...prev, { role: "user", text: msg, ts: Date.now() }]);

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
        setMessages((prev) => [
          ...prev,
          { role: "agent", text: data.response, ts: Date.now() },
        ]);
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
    setMessages((prev) => [...prev, { role: "system", text, ts: Date.now() }]);
  }

  // Listen for NPC clicks — show a confirmation prompt, don't auto-redirect
  React.useEffect(() => {
    return gameBus.on("agentGoToNpc", ({ entityId, zoneId, name, teachesProfession }) => {
      setPendingGoto({ entityId, zoneId, name, teachesProfession });
    });
  }, []);

  async function confirmGoto(action?: "learn-profession") {
    if (!pendingGoto || !token) return;
    const { entityId, zoneId, name, teachesProfession } = pendingGoto;
    setPendingGoto(null);
    const label = action === "learn-profession" && teachesProfession
      ? `Learning ${teachesProfession} from ${name}…`
      : `Sending agent to ${name}…`;
    addSystemMsg(label);
    try {
      const body: Record<string, string> = { entityId, zoneId, name };
      if (action === "learn-profession" && teachesProfession) {
        body.action = "learn-profession";
        body.profession = teachesProfession;
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
  const entityLevel = status?.entity?.level ?? 1;
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
      className={`flex flex-col border-2 border-[#54f28b] bg-[#060d12] font-mono shadow-[4px_4px_0_0_#000] w-96 lg:w-[28rem] max-w-[50vw] ${collapsed ? "" : "h-[45vh] max-h-[400px]"} ${className}`}
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
            <span className="text-[#ffcc00]">{entityName}</span>
            {entityLevel > 1 && <span className="text-[#9aa7cc]"> Lv{entityLevel}</span>}
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
        {messages.map((m, i) => (
          <div key={i} className="text-[12px] leading-relaxed">
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
          </div>
        ))}
        {sending && (
          <div className="text-[12px] text-[#6b7394] animate-pulse">Agent thinking...</div>
        )}
      </div>
      )}

      {/* ── Quick suggestions ──────────────────────────────────────── */}
      {viewMode === "chat" && isDeployed && !sending && messages.length < 3 && (
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
              type="text"
              value={input}
              onChange={(e) => {
                const val = e.target.value;
                setInput(val);
                // Update autocomplete suggestions
                if (val.startsWith("/") && !val.includes(" ")) {
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
                if (cmdSuggestions.length > 0) {
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
              placeholder="Tell your agent what to do... (/ for commands)"
              disabled={!token || sending || authLoading}
              className="flex-1 border border-[#2a3450] bg-[#0b1020] px-2 py-1 text-[12px] text-[#d6deff] placeholder-[#6b7394] outline-none focus:border-[#54f28b] disabled:opacity-40"
            />
            <button
              onClick={() => void handleSend()}
              disabled={!input.trim() || !token || sending || authLoading}
              className="border border-[#54f28b] bg-[#0a1a0e] px-2 py-1 text-[12px] text-[#54f28b] transition hover:bg-[#112a1b] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              [→]
            </button>
          </div>
        </div>
      )}

      {/* ── Stop confirmation ──────────────────────────────────────── */}
      {/* ── Send-agent-here confirmation ─────────────────────────── */}
      {pendingGoto && (
        <div className="absolute bottom-[56px] left-0 right-0 z-40 border-t border-[#e0af68] bg-[#0d0c07] px-3 py-2 font-mono flex items-center justify-between gap-2">
          <span className="text-[11px] text-[#e0af68] truncate">
            {pendingGoto.teachesProfession
              ? <>Learn <span className="text-[#ffcc00]">{pendingGoto.teachesProfession}</span> from {pendingGoto.name}?</>
              : <>→ Send agent to <span className="text-[#ffcc00]">{pendingGoto.name}</span>?</>
            }
          </span>
          <div className="flex gap-2 shrink-0">
            {pendingGoto.teachesProfession && (
              <button
                onClick={() => void confirmGoto("learn-profession")}
                disabled={!token || !isRunning}
                className="border border-[#00ff9d] px-2 py-0.5 text-[10px] text-[#00ff9d] uppercase tracking-widest hover:bg-[#001a0d] disabled:opacity-40"
              >
                Learn
              </button>
            )}
            <button
              onClick={() => void confirmGoto()}
              disabled={!token || !isRunning}
              className="border border-[#e0af68] px-2 py-0.5 text-[10px] text-[#e0af68] uppercase tracking-widest hover:bg-[#1a1600] disabled:opacity-40"
            >
              Go
            </button>
            <button
              onClick={() => setPendingGoto(null)}
              className="border border-[#6b7394] px-2 py-0.5 text-[10px] text-[#8b9abc] uppercase tracking-widest hover:bg-[#0a0e14]"
            >
              ✕
            </button>
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
