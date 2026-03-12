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
  type: "direct" | "trade-request" | "party-invite" | "broadcast";
  body: string;
  ts: number;
}

const TYPE_LABELS: Record<string, string> = {
  direct: "MSG",
  "trade-request": "TRADE",
  "party-invite": "PARTY",
  broadcast: "ZONE",
};

const TYPE_COLORS: Record<string, string> = {
  direct: "#54f28b",
  "trade-request": "#ffcc00",
  "party-invite": "#6ea8fe",
  broadcast: "#c084fc",
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
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
              <div
                key={msg.id}
                className="border border-[#29334d] bg-[#11182b] p-2 space-y-1"
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
                  <span className="text-[7px] text-[#9aa7cc]">{timeAgo(msg.ts)}</span>
                </div>
                <p className="text-[9px] text-[#cdd6f4] leading-snug whitespace-pre-wrap break-words">
                  {msg.body}
                </p>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
