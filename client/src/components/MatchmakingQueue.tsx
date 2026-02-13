/**
 * Matchmaking Queue Component
 * Allows players to join PvP queues and view status
 */

import React, { useState, useEffect } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Select } from "./ui/select";

interface QueueStatus {
  format: string;
  playersInQueue: number;
  playersNeeded: number;
  averageWaitTime: number;
}

export function MatchmakingQueue() {
  const [queues, setQueues] = useState<QueueStatus[]>([]);
  const [selectedFormat, setSelectedFormat] = useState<string>("1v1");
  const [inQueue, setInQueue] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchQueues();
    const interval = setInterval(fetchQueues, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchQueues = async () => {
    try {
      const response = await fetch("/api/pvp/queue/all");
      const data = await response.json();
      setQueues(data.queues);
    } catch (error) {
      console.error("Failed to fetch queues:", error);
    }
  };

  const handleJoinQueue = async () => {
    setLoading(true);

    try {
      // Get player info (in production, from context)
      const agentId = "agent_" + Math.random().toString(36).substr(2, 9);
      const walletAddress = "0x" + "1".repeat(40); // Placeholder
      const characterTokenId = "1";
      const level = 10;

      const response = await fetch("/api/pvp/queue/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          walletAddress,
          characterTokenId,
          level,
          format: selectedFormat,
        }),
      });

      if (response.ok) {
        setInQueue(true);
        alert("Joined queue successfully!");
      } else {
        const error = await response.json();
        alert(`Failed to join queue: ${error.error}`);
      }
    } catch (error) {
      alert(`Error: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLeaveQueue = async () => {
    setLoading(true);

    try {
      const agentId = "agent_placeholder"; // In production, get from context

      const response = await fetch("/api/pvp/queue/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          format: selectedFormat,
        }),
      });

      if (response.ok) {
        setInQueue(false);
        alert("Left queue successfully!");
      }
    } catch (error) {
      console.error("Failed to leave queue:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4 space-y-4">
      <h1 className="text-3xl font-bold text-center">⚔️ PvP Matchmaking</h1>

      {/* Queue Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {queues.map((queue) => (
          <Card key={queue.format} className="p-4 space-y-2">
            <div className="text-center">
              <div className="text-2xl font-bold">{queue.format.toUpperCase()}</div>
              <Badge
                variant={queue.playersNeeded <= 0 ? "default" : "outline"}
              >
                {queue.playersNeeded <= 0 ? "READY" : "WAITING"}
              </Badge>
            </div>

            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>In Queue:</span>
                <span className="font-bold">{queue.playersInQueue}</span>
              </div>
              <div className="flex justify-between">
                <span>Need:</span>
                <span className="font-bold">
                  {queue.playersNeeded > 0 ? queue.playersNeeded : 0} more
                </span>
              </div>
              <div className="flex justify-between">
                <span>Avg Wait:</span>
                <span className="font-bold">
                  {Math.floor(queue.averageWaitTime / 1000)}s
                </span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
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
          </Card>
        ))}
      </div>

      {/* Join Queue Section */}
      <Card className="p-6 space-y-4">
        <h2 className="text-xl font-semibold text-center">Join a Queue</h2>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {["1v1", "2v2", "5v5", "ffa"].map((format) => (
            <Button
              key={format}
              variant={selectedFormat === format ? "default" : "outline"}
              className="h-20"
              onClick={() => setSelectedFormat(format)}
            >
              <div>
                <div className="text-lg font-bold">{format.toUpperCase()}</div>
                <div className="text-xs">
                  {format === "ffa" ? "Free-For-All" : `Team Battle`}
                </div>
              </div>
            </Button>
          ))}
        </div>

        {!inQueue ? (
          <Button
            className="w-full h-14 text-lg font-bold"
            onClick={handleJoinQueue}
            disabled={loading}
          >
            {loading ? "Joining..." : `Join ${selectedFormat.toUpperCase()} Queue`}
          </Button>
        ) : (
          <div className="space-y-2">
            <div className="text-center text-green-600 font-semibold">
              ✓ In Queue - Waiting for match...
            </div>
            <Button
              variant="destructive"
              className="w-full"
              onClick={handleLeaveQueue}
              disabled={loading}
            >
              Leave Queue
            </Button>
          </div>
        )}
      </Card>

      {/* Info */}
      <Card className="p-4 bg-blue-50 dark:bg-blue-900">
        <div className="text-sm space-y-1">
          <div className="font-semibold">How it works:</div>
          <ul className="list-disc list-inside space-y-1">
            <li>Select a format (1v1, 2v2, 5v5, or Free-For-All)</li>
            <li>Join the queue and wait for other players</li>
            <li>When enough players join, a match is created automatically</li>
            <li>Place encrypted bets on the prediction market before battle starts</li>
            <li>Watch the battle live and claim winnings if you bet correctly!</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}
