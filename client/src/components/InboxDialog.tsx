import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useGameBridge } from "@/hooks/useGameBridge";
import { useWallet } from "@/hooks/useWallet";
import { API_URL } from "@/config";
import { getAuthToken } from "@/lib/agentAuth";

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

const TYPE_LABELS: Record<string, string> = {
  direct: "MSG",
  "trade-request": "TRADE",
  "party-invite": "PARTY",
  broadcast: "ZONE",
  "quest-approval": "QUEST",
  system: "EVENT",
};

const TYPE_COLORS: Record<string, string> = {
  direct: "#54f28b",
  "trade-request": "#ffcc00",
  "party-invite": "#6ea8fe",
  broadcast: "#c084fc",
  "quest-approval": "#e0af68",
  system: "#ff9f43",
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function MessageRow({
  msg,
  address,
  onQuestResponded,
}: {
  msg: InboxMessage;
  address: string | null;
  onQuestResponded?: () => void;
}): React.ReactElement {
  const [replyOpen, setReplyOpen] = React.useState(false);
  const [replyText, setReplyText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [questDecision, setQuestDecision] = React.useState<"accepted" | "denied" | null>(null);

  async function handleReply() {
    if (!replyText.trim() || !address || sending) return;
    setSending(true);
    try {
      const token = await getAuthToken(address);
      if (!token) return;
      const res = await fetch(`${API_URL}/inbox/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: msg.from, type: "direct", body: replyText.trim() }),
      });
      if (res.ok) {
        setSent(true);
        setReplyText("");
        setTimeout(() => { setSent(false); setReplyOpen(false); }, 1500);
      }
    } catch {
      // silent
    } finally {
      setSending(false);
    }
  }

  async function handleQuestApproval(approved: boolean) {
    if (!address || sending) return;
    const questId = msg.data?.questId as string;
    if (!questId) return;
    setSending(true);
    try {
      const token = await getAuthToken(address);
      if (!token) return;
      const res = await fetch(`${API_URL}/inbox/quest-approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ questId, approved }),
      });
      if (res.ok) {
        setQuestDecision(approved ? "accepted" : "denied");
        onQuestResponded?.();
      }
    } catch {
      // silent
    } finally {
      setSending(false);
    }
  }

  const isSelf = address && msg.from.toLowerCase() === address.toLowerCase();
  const isQuestApproval = msg.type === "quest-approval" && !!msg.data?.questId;
  const questRewards = (msg.data?.rewards ?? {}) as { copper?: number; xp?: number };
  const questObjective = (msg.data?.objective ?? {}) as { type?: string; count?: number; targetMobName?: string };

  return (
    <div
      className="border p-2 space-y-1"
      style={{
        borderColor: isQuestApproval ? "#e0af6844" : "#29334d",
        backgroundColor: isQuestApproval ? "#1a160b" : "#11182b",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span
            className="text-[7px] font-bold uppercase px-1 py-[1px] border"
            style={{
              color: TYPE_COLORS[msg.type] ?? "#9aa7cc",
              borderColor: (TYPE_COLORS[msg.type] ?? "#9aa7cc") + "44",
            }}
          >
            {TYPE_LABELS[msg.type] ?? msg.type}
          </span>
          <span className="text-[9px] font-bold text-[#54f28b]">
            {msg.fromName || msg.from.slice(0, 8) + "..."}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[7px] text-[#9aa7cc]">{timeAgo(msg.ts)}</span>
          {!isSelf && msg.type !== "broadcast" && !isQuestApproval && (
            <button
              type="button"
              onClick={() => setReplyOpen(!replyOpen)}
              className="text-[7px] uppercase tracking-wide text-[#6ea8fe] hover:text-[#9ec5fe] transition-colors"
            >
              {replyOpen ? "cancel" : "reply"}
            </button>
          )}
        </div>
      </div>
      <p className="text-[9px] text-[#cdd6f4] leading-snug whitespace-pre-wrap break-words">
        {msg.body}
      </p>

      {/* Quest approval details + action buttons */}
      {isQuestApproval && (
        <div className="space-y-1.5 pt-1">
          {/* Quest info */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[8px] text-[#9aa7cc]">
            {questObjective?.type && (
              <span>
                Objective: <span className="text-[#e0af68]">{questObjective.type}</span>
                {questObjective.targetMobName && <> — {questObjective.targetMobName}</>}
                {questObjective.count && <> x{questObjective.count}</>}
              </span>
            )}
            {questRewards?.xp && <span>XP: <span className="text-[#5dadec]">{questRewards.xp}</span></span>}
            {questRewards?.copper && (
              <span>Gold: <span className="text-[#ffcc00]">
                {questRewards.copper >= 10000
                  ? `${(questRewards.copper / 10000).toFixed(1)}`
                  : `${questRewards.copper}c`}
              </span></span>
            )}
          </div>

          {/* Accept / Deny buttons */}
          {questDecision ? (
            <div
              className="text-[9px] font-bold uppercase tracking-widest text-center py-1"
              style={{ color: questDecision === "accepted" ? "#54f28b" : "#f25454" }}
            >
              {questDecision === "accepted" ? "Approved" : "Denied"}
            </div>
          ) : (
            <div className="flex gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => void handleQuestApproval(true)}
                disabled={sending}
                className="flex-1 border border-[#54f28b] bg-[#0a1a0e] px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-[#54f28b] transition hover:bg-[#112a1b] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sending ? "..." : "Accept"}
              </button>
              <button
                type="button"
                onClick={() => void handleQuestApproval(false)}
                disabled={sending}
                className="flex-1 border border-[#f25454] bg-[#1a0a0a] px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-[#f25454] transition hover:bg-[#2a1010] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sending ? "..." : "Deny"}
              </button>
            </div>
          )}
        </div>
      )}

      {replyOpen && (
        <div className="flex gap-1 pt-1">
          <input
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") void handleReply(); }}
            placeholder="Type a reply..."
            disabled={sending}
            className="flex-1 border border-[#29334d] bg-[#0a0f1e] px-2 py-1 text-[9px] text-[#f1f5ff] placeholder-[#596a8a] outline-none focus:border-[#6ea8fe] disabled:opacity-40"
            autoFocus
          />
          <button
            type="button"
            onClick={() => void handleReply()}
            disabled={!replyText.trim() || sending}
            className="border border-[#6ea8fe] bg-[#101a2e] px-2 py-1 text-[8px] uppercase text-[#6ea8fe] transition hover:bg-[#1a2840] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sent ? "Sent!" : sending ? "..." : "Send"}
          </button>
        </div>
      )}
    </div>
  );
}

export function InboxDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.ReactElement {
  const { address } = useWallet();
  const [messages, setMessages] = React.useState<InboxMessage[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [total, setTotal] = React.useState(0);

  const fetchMessages = React.useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/inbox/${address}/history?limit=50`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages((data.messages ?? []).reverse());
      setTotal(data.total ?? 0);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [address]);

  React.useEffect(() => {
    if (open && address) {
      fetchMessages();
    }
  }, [open, address, fetchMessages]);

  // Listen for gameBus inboxOpen events (unused here since parent controls open, but keeps pattern)
  useGameBridge("inboxOpen", () => {});

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-md max-h-[70vh] flex flex-col bg-[#0a0f1e] border-2 border-[#29334d] text-[#f1f5ff]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            Inbox
            {total > 0 && (
              <Badge variant="secondary" className="text-[8px]">
                {total}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
          {loading && messages.length === 0 ? (
            <p className="text-[9px] text-[#9aa7cc] text-center py-4">Loading messages...</p>
          ) : messages.length === 0 ? (
            <p className="text-[9px] text-[#9aa7cc] text-center py-4">
              No messages yet. Your agent will receive messages from other agents as they interact in the world.
            </p>
          ) : (
            messages.map((msg) => (
              <MessageRow key={msg.id} msg={msg} address={address} onQuestResponded={fetchMessages} />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
