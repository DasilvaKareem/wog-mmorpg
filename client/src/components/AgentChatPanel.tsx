/**
 * AgentChatPanel — 8-bit terminal style UI for directing your AI agent
 * Shows agent status, chat history, and provides input to send instructions.
 */

import * as React from "react";
import { API_URL } from "@/config";
import { getAuthToken, clearCachedToken } from "@/lib/agentAuth";
import { PaymentGate } from "@/components/PaymentGate";

interface ChatMessage {
  role: "user" | "agent" | "system";
  text: string;
  ts: number;
}

interface AgentStatusData {
  running: boolean;
  config: {
    enabled: boolean;
    focus: string;
    strategy: string;
    chatHistory: { role: "user" | "agent"; text: string; ts: number }[];
  } | null;
  entityId: string | null;
  zoneId: string | null;
  entity: {
    name: string;
    level: number;
    hp: number;
    maxHp: number;
  } | null;
}

interface AgentChatPanelProps {
  walletAddress: string;
  className?: string;
}

export function AgentChatPanel({ walletAddress, className = "" }: AgentChatPanelProps): React.ReactElement {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [deploying, setDeploying] = React.useState(false);
  const [showDeployPayment, setShowDeployPayment] = React.useState(false);
  const [status, setStatus] = React.useState<AgentStatusData | null>(null);
  const [token, setToken] = React.useState<string | null>(null);
  const [authLoading, setAuthLoading] = React.useState(true);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Get auth token once
  React.useEffect(() => {
    let cancelled = false;
    async function fetchToken() {
      setAuthLoading(true);
      const t = await getAuthToken(walletAddress);
      if (!cancelled) {
        setToken(t);
        setAuthLoading(false);
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
          // Sync chat history from server on first load
          setMessages((prev) => {
            if (prev.length === 0 && data.config?.chatHistory?.length) {
              return data.config.chatHistory.map((m) => ({
                role: m.role,
                text: m.text,
                ts: m.ts,
              }));
            }
            return prev;
          });
        } else if (res.status === 401) {
          clearCachedToken();
        }
      } catch {}
    }

    pollStatus();
    const id = setInterval(pollStatus, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token, walletAddress]);

  async function executeDeploy() {
    if (!token || deploying) return;
    setDeploying(true);
    addSystemMsg("Deploying agent...");
    try {
      const res = await fetch(`${API_URL}/agent/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          walletAddress,
          // Use existing entity name if available; agentCharacterSetup is idempotent
          characterName: status?.entity?.name ?? "Adventurer",
          raceId: "human",
          classId: "warrior",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        addSystemMsg(`Agent deployed! Entity: ${data.entityId} in ${data.zoneId}`);
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
    try {
      await fetch(`${API_URL}/agent/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ walletAddress }),
      });
      addSystemMsg("Agent stopped.");
    } catch {}
  }

  async function handleSend() {
    const msg = input.trim();
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
        if (data.configUpdated) {
          addSystemMsg(`[CONFIG] Focus updated.`);
        }
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

  const isRunning = status?.running ?? false;
  const entityName = status?.entity?.name ?? "Agent";
  const entityLevel = status?.entity?.level ?? 1;
  const focus = status?.config?.focus ?? "idle";
  const zoneId = status?.zoneId ?? "—";

  const statusColor = isRunning ? "#54f28b" : "#ff4d6d";
  const statusLabel = isRunning ? "RUNNING" : "STOPPED";

  return (
    <div
      className={`flex flex-col border-2 border-[#54f28b] bg-[#060d12] font-mono shadow-[4px_4px_0_0_#000] ${className}`}
      style={{ width: 384, height: 320 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b-2 border-[#54f28b] bg-[#0a1a0e] px-3 py-1.5">
        <span className="text-[9px] text-[#54f28b] uppercase tracking-widest">
          {">> AGENT: "}
          <span className="text-[#ffcc00]">{entityName}</span>
          {entityLevel > 1 && <span className="text-[#9aa7cc]"> Lv{entityLevel}</span>}
        </span>
        <span
          className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 border"
          style={{ color: statusColor, borderColor: statusColor }}
        >
          {authLoading ? "AUTH..." : statusLabel}
        </span>
      </div>

      {/* Status bar */}
      {status && (
        <div className="flex items-center gap-3 border-b border-[#1a2a18] bg-[#080f0a] px-3 py-1">
          <span className="text-[7px] text-[#3a4260]">
            FOCUS: <span className="text-[#ffcc00]">{focus.toUpperCase()}</span>
          </span>
          <span className="text-[7px] text-[#3a4260]">
            ZONE: <span className="text-[#9aa7cc]">{zoneId}</span>
          </span>
          {status.entity && (
            <span className="text-[7px] text-[#3a4260]">
              HP: <span className="text-[#54f28b]">{status.entity.hp}/{status.entity.maxHp}</span>
            </span>
          )}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-1"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#1a3a22 transparent" }}
      >
        {messages.length === 0 && !authLoading && (
          <p className="text-[8px] text-[#3a4260] italic">
            {isRunning
              ? "Your agent is active. Send a message to direct it..."
              : "Deploy your agent to start playing. You can direct it by chatting here."}
          </p>
        )}
        {authLoading && (
          <p className="text-[8px] text-[#3a4260] animate-pulse">Authenticating...</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className="text-[8px] leading-relaxed">
            {m.role === "user" && (
              <span>
                <span className="text-[#ffcc00]">[You]</span>{" "}
                <span className="text-[#d6deff]">{m.text}</span>
              </span>
            )}
            {m.role === "agent" && (
              <span>
                <span className="text-[#54f28b]">[Agent]</span>{" "}
                <span className="text-[#9aa7cc]">{m.text}</span>
              </span>
            )}
            {m.role === "system" && (
              <span className="text-[#565f89] italic">{m.text}</span>
            )}
          </div>
        ))}
        {sending && (
          <div className="text-[8px] text-[#3a4260] animate-pulse">Agent thinking...</div>
        )}
      </div>

      {/* Agent deploy payment overlay */}
      {showDeployPayment && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 px-4">
          <div className="w-full max-w-sm border-4 border-[#54f28b] bg-[#060d12] font-mono shadow-[8px_8px_0_0_#000]">
            <div className="flex items-center justify-between border-b-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-2">
              <span className="text-[9px] uppercase tracking-widest text-[#54f28b]">
                {">> AI AGENT HOSTING FEE"}
              </span>
              <button
                onClick={() => setShowDeployPayment(false)}
                className="text-[10px] text-[#54f28b] hover:text-[#ffcc00] transition-colors"
              >
                [X]
              </button>
            </div>
            <div className="p-5">
              <PaymentGate
                label="AI Agent Hosting Fee — $10/month autonomous agent in World of Geneva"
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

      {/* Input area */}
      <div className="border-t-2 border-[#1a2a18] bg-[#080f0a] p-2">
        <div className="flex gap-1 mb-1">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleSend(); }}
            placeholder={token ? "Direct your agent..." : "Connect wallet to chat..."}
            disabled={!token || sending || authLoading}
            className="flex-1 border border-[#2a3450] bg-[#0b1020] px-2 py-1 text-[8px] text-[#d6deff] placeholder-[#3a4260] outline-none focus:border-[#54f28b] disabled:opacity-40"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || !token || sending || authLoading}
            className="border border-[#54f28b] bg-[#0a1a0e] px-2 py-1 text-[8px] text-[#54f28b] transition hover:bg-[#112a1b] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            [→]
          </button>
        </div>
        <div className="flex gap-1">
          {!isRunning ? (
            <button
              onClick={() => setShowDeployPayment(true)}
              disabled={deploying || authLoading || !token}
              className="flex-1 border border-[#54f28b] bg-[#0a1a0e] py-1 text-[7px] uppercase tracking-widest text-[#54f28b] transition hover:bg-[#112a1b] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deploying ? "Deploying..." : "[▶] Deploy Agent — $10"}
            </button>
          ) : (
            <button
              onClick={() => void handleStop()}
              disabled={authLoading || !token}
              className="flex-1 border border-[#ff4d6d] bg-[#1a0a0e] py-1 text-[7px] uppercase tracking-widest text-[#ff4d6d] transition hover:bg-[#2a1015] disabled:opacity-40"
            >
              [⏹] Stop Agent
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
