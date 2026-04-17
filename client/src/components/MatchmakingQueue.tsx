import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useWallet } from "@/hooks/useWallet";
import { getAuthToken } from "@/lib/agentAuth";
import { gameBus } from "@/lib/eventBus";
import { WalletManager } from "@/lib/walletManager";
import { API_URL } from "../config.js";

interface QueueStatus {
  format: string;
  playersInQueue: number;
  playersNeeded: number;
  averageWaitTime: number;
}

interface QueueIdentity {
  agentId: string;
  characterTokenId: string;
  level: number;
}

interface StatePlayerEntity {
  id?: string;
  type?: string;
  walletAddress?: string;
  name?: string;
  level?: number;
  agentId?: string;
  characterTokenId?: string | number;
}

interface StateSnapshot {
  zones?: Record<string, { entities?: Record<string, StatePlayerEntity> }>;
}

export function MatchmakingQueue(): React.ReactElement {
  const [queues, setQueues] = React.useState<QueueStatus[]>([]);
  const [selectedFormat, setSelectedFormat] = React.useState<string>("1v1");
  const [inQueue, setInQueue] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [queuedAgentId, setQueuedAgentId] = React.useState<string | null>(null);
  const { address, isConnected, characterProgress } = useWallet();
  const { notify } = useToast();

  // Resolve identity once and reuse it for queue checks
  const agentIdRef = React.useRef<string | null>(null);

  // On mount, resolve identity and check if already queued server-side
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const identity = await resolveQueueIdentity();
        if (cancelled || !identity) return;
        agentIdRef.current = identity.agentId;
        // Check server for existing queue membership
        const res = await fetch(`${API_URL}/api/pvp/queue/all?agentId=${encodeURIComponent(identity.agentId)}`);
        if (cancelled || !res.ok) return;
        const data = await res.json();
        setQueues(data.queues);
        if (data.queuedFormats?.length > 0) {
          setInQueue(true);
          setQueuedAgentId(identity.agentId);
          setSelectedFormat(data.queuedFormats[0]);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [address]);

  React.useEffect(() => {
    fetchQueues();
    const interval = setInterval(fetchQueues, 3000);
    return () => clearInterval(interval);
  }, []);

  // Poll for match when in queue
  React.useEffect(() => {
    if (!inQueue || !queuedAgentId) return;

    const pollForMatch = async () => {
      try {
        const response = await fetch(
          `${API_URL}/api/pvp/player/${encodeURIComponent(queuedAgentId)}/current-battle`,
        );
        if (!response.ok) return;
        const data = await response.json();

        if (data.inBattle && data.battleId) {
          // Match found! The server teleports the player entity to the arena zone.
          // The WorldScene camera will naturally follow.
          setInQueue(false);
          setQueuedAgentId(null);
          notify("Match found! Entering arena...", "success");

          gameBus.emit("matchFound", { battleId: data.battleId, status: data.status });
        }
      } catch (error) {
        console.error("Failed to poll for match:", error);
      }
    };

    const interval = setInterval(pollForMatch, 2000);
    // Also poll immediately
    void pollForMatch();

    return () => clearInterval(interval);
  }, [inQueue, queuedAgentId, notify]);

  const fetchQueues = async () => {
    try {
      const agentId = agentIdRef.current;
      const url = agentId
        ? `${API_URL}/api/pvp/queue/all?agentId=${encodeURIComponent(agentId)}`
        : `${API_URL}/api/pvp/queue/all`;
      const response = await fetch(url);
      const data = await response.json();
      setQueues(data.queues);
      // Sync local queue state with server truth
      if (agentId && data.queuedFormats) {
        const serverQueued = data.queuedFormats.length > 0;
        if (serverQueued && !inQueue) {
          setInQueue(true);
          setQueuedAgentId(agentId);
          setSelectedFormat(data.queuedFormats[0]);
        } else if (!serverQueued && inQueue) {
          setInQueue(false);
          setQueuedAgentId(null);
        }
      }
    } catch (error) {
      console.error("Failed to fetch queues:", error);
    }
  };

  const resolveQueueIdentity = React.useCallback(async (): Promise<QueueIdentity | null> => {
    if (!address) return null;

    const walletManager = WalletManager.getInstance();
    const trackedWallet = await walletManager.getTrackedWalletAddress();
    const custodialWallet = walletManager.custodialAddress;
    const walletsToMatch = new Set(
      [address, trackedWallet, custodialWallet]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase()),
    );

    const response = await fetch(`${API_URL}/state`);
    if (!response.ok) {
      throw new Error("Unable to load live world state");
    }

    const snapshot = (await response.json()) as StateSnapshot;
    const allPlayers = Object.values(snapshot.zones ?? {}).flatMap((zone) =>
      Object.entries(zone.entities ?? {}).flatMap(([entityId, entity]) => {
        if (entity.type !== "player") return [];
        const entityWallet = entity.walletAddress?.toLowerCase();
        if (!entityWallet || !walletsToMatch.has(entityWallet)) return [];
        return [{ ...entity, id: entity.id ?? entityId }];
      }),
    );

    if (allPlayers.length === 0) {
      return null;
    }

    const withIdentity = allPlayers.filter((entity) => entity.agentId && entity.characterTokenId);
    if (withIdentity.length > 0) {
      const activeToken = characterProgress?.characterTokenId
        ? String(characterProgress.characterTokenId)
        : null;
      const selected = activeToken
        ? (withIdentity.find((entity) => String(entity.characterTokenId) === activeToken) ?? null)
        : (withIdentity.length === 1 ? withIdentity[0] : null);
      if (!selected) {
        return null;
      }

      return {
        agentId: String(selected.agentId),
        characterTokenId: String(selected.characterTokenId),
        level: selected.level ?? characterProgress?.level ?? 1,
      };
    }

    // Fallback: resolve canonical active identity for this wallet.
    try {
      const walletRes = await fetch(`${API_URL}/agent/wallet/${encodeURIComponent(address)}`);
      if (walletRes.ok) {
        const walletData = await walletRes.json();
        if (walletData.agentId && walletData.characterTokenId) {
          return {
            agentId: String(walletData.agentId),
            characterTokenId: String(walletData.characterTokenId),
            level: characterProgress?.level ?? 1,
          };
        }
      }
    } catch {
      // fall through
    }

    return null;
  }, [address, characterProgress]);

  const handleJoinQueue = async () => {
    if (!address) {
      notify("Connect wallet first", "error");
      return;
    }

    setLoading(true);
    try {
      const token = await getAuthToken(address);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const queueIdentity = await resolveQueueIdentity();

      if (!queueIdentity) {
        notify("Spawn a character with an on-chain identity before joining queue", "error");
        return;
      }

      const response = await fetch(`${API_URL}/api/pvp/queue/join`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          agentId: queueIdentity.agentId,
          walletAddress: address,
          characterTokenId: queueIdentity.characterTokenId,
          level: queueIdentity.level,
          format: selectedFormat,
        }),
      });

      if (response.ok) {
        agentIdRef.current = queueIdentity.agentId;
        setInQueue(true);
        setQueuedAgentId(queueIdentity.agentId);
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
      const token = await getAuthToken(address);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const queueIdentity = await resolveQueueIdentity();

      if (!queueIdentity) {
        notify("No active on-chain character found in queue context", "error");
        return;
      }

      const response = await fetch(`${API_URL}/api/pvp/queue/leave`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          agentId: queueIdentity.agentId,
          format: selectedFormat,
        }),
      });

      if (response.ok) {
        setInQueue(false);
        setQueuedAgentId(null);
        notify("Left queue", "info");
      }
    } catch (error) {
      console.error("Failed to leave queue:", error);
      notify(`Error: ${(error as Error).message}`, "error");
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
          <div className="flex items-center justify-center gap-2 text-[9px] font-semibold text-[#54f28b]">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#54f28b]" />
            Searching for match...
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
