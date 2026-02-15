import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useWallet } from "@/hooks/useWallet";
import { API_URL } from "../config.js";

interface QueueStatus {
  format: string;
  playersInQueue: number;
  playersNeeded: number;
  averageWaitTime: number;
}

export function MatchmakingQueue(): React.ReactElement {
  const [queues, setQueues] = React.useState<QueueStatus[]>([]);
  const [selectedFormat, setSelectedFormat] = React.useState<string>("1v1");
  const [inQueue, setInQueue] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const { address, isConnected } = useWallet();
  const { notify } = useToast();

  React.useEffect(() => {
    fetchQueues();
    const interval = setInterval(fetchQueues, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchQueues = async () => {
    try {
      const response = await fetch(`${API_URL}/api/pvp/queue/all`);
      const data = await response.json();
      setQueues(data.queues);
    } catch (error) {
      console.error("Failed to fetch queues:", error);
    }
  };

  const handleJoinQueue = async () => {
    if (!address) {
      notify("Connect wallet first", "error");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/pvp/queue/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: `agent_${address.slice(2, 10)}`,
          walletAddress: address,
          characterTokenId: "1",
          level: 10,
          format: selectedFormat,
        }),
      });

      if (response.ok) {
        setInQueue(true);
        notify(`Joined ${selectedFormat} queue`, "success");
      } else {
        const error = await response.json();
        notify(`Queue error: ${error.error}`, "error");
      }
    } catch (error) {
      notify(`Error: ${(error as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleLeaveQueue = async () => {
    if (!address) return;

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/pvp/queue/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: `agent_${address.slice(2, 10)}`,
          format: selectedFormat,
        }),
      });

      if (response.ok) {
        setInQueue(false);
        notify("Left queue", "info");
      }
    } catch (error) {
      console.error("Failed to leave queue:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <h3
        className="text-[11px] font-bold uppercase tracking-wide text-[#ffcc00]"
        style={{ textShadow: "2px 2px 0 #000" }}
      >
        Matchmaking
      </h3>

      {/* Queue Status Cards */}
      <div className="space-y-2">
        {queues.map((queue) => (
          <div
            key={queue.format}
            className="border-2 border-[#29334d] bg-[#0a0f1a] p-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-[#f1f5ff]">
                {queue.format.toUpperCase()}
              </span>
              <Badge variant={queue.playersNeeded <= 0 ? "success" : "secondary"}>
                {queue.playersNeeded <= 0 ? "READY" : "WAITING"}
              </Badge>
            </div>

            <div className="mt-1 flex justify-between text-[8px] text-[#9aa7cc]">
              <span>In Queue: {queue.playersInQueue}</span>
              <span>Need: {queue.playersNeeded > 0 ? queue.playersNeeded : 0}</span>
            </div>

            {/* Progress Bar */}
            <div className="mt-1 h-2 border-2 border-black bg-[#0f1528]">
              <div
                className="h-full bg-[#ffcc00]"
                style={{
                  width: `${Math.min(
                    100,
                    (queue.playersInQueue /
                      (queue.playersInQueue + queue.playersNeeded)) *
                      100
                  )}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Format Selection */}
      <div className="grid grid-cols-2 gap-1">
        {["1v1", "2v2", "5v5", "ffa"].map((format) => (
          <button
            key={format}
            className={`border-2 border-black p-1.5 text-[9px] font-bold uppercase shadow-[2px_2px_0_0_#000] transition ${
              selectedFormat === format
                ? "bg-[#ffcc00] text-black"
                : "bg-[#2b3656] text-[#9aa7cc] hover:bg-[#3a4870]"
            }`}
            onClick={() => setSelectedFormat(format)}
          >
            {format.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Join/Leave Queue */}
      {!inQueue ? (
        <Button
          className="h-8 w-full text-[9px] font-bold uppercase"
          onClick={handleJoinQueue}
          disabled={loading || !isConnected}
        >
          {!isConnected
            ? "Connect Wallet"
            : loading
              ? "Joining..."
              : `Join ${selectedFormat.toUpperCase()}`}
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="text-center text-[9px] font-semibold text-[#54f28b]">
            In Queue - Waiting...
          </div>
          <Button
            variant="danger"
            className="h-7 w-full text-[8px]"
            onClick={handleLeaveQueue}
            disabled={loading}
          >
            Leave Queue
          </Button>
        </div>
      )}
    </div>
  );
}
