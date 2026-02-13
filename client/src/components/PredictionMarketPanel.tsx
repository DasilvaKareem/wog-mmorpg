/**
 * Prediction Market Panel Component
 * Displays betting interface and pool statistics
 */

import React, { useState, useEffect } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";

interface PredictionMarketPanelProps {
  poolId: string;
  battleStatus: string;
  winner?: "red" | "blue";
}

interface PoolStats {
  poolId: string;
  battleId: string;
  status: "open" | "locked" | "executing" | "settled" | "cancelled";
  totalStaked: string;
  participantCount: number;
  lockTimestamp: number;
  timeUntilLock?: number;
  participants: Array<{
    wallet: string;
    amount: string;
    timestamp: number;
  }>;
}

export function PredictionMarketPanel({
  poolId,
  battleStatus,
  winner,
}: PredictionMarketPanelProps) {
  const [pool, setPool] = useState<PoolStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTeam, setSelectedTeam] = useState<"RED" | "BLUE" | null>(null);
  const [betAmount, setBetAmount] = useState("");
  const [placingBet, setPlacingBet] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPool();
    const interval = setInterval(fetchPool, 3000);
    return () => clearInterval(interval);
  }, [poolId]);

  const fetchPool = async () => {
    try {
      const response = await fetch(`/api/prediction/pool/${poolId}`);
      if (!response.ok) {
        throw new Error("Pool not found");
      }
      const data = await response.json();
      setPool(data.pool);
      setLoading(false);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  const handlePlaceBet = async () => {
    if (!selectedTeam || !betAmount || !pool) return;

    setPlacingBet(true);
    setError(null);

    try {
      // Get wallet address (in production, from wallet context)
      const walletAddress = "0x" + "1".repeat(40); // Placeholder

      const response = await fetch("/api/prediction/bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poolId: pool.poolId,
          choice: selectedTeam,
          amount: parseFloat(betAmount),
          walletAddress,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to place bet");
      }

      const data = await response.json();
      alert(
        `Bet placed successfully!\nAmount: ${betAmount} GOLD\nTeam: ${selectedTeam}\nTransaction: ${data.position.txHash.substring(0, 10)}...`
      );

      // Reset form
      setSelectedTeam(null);
      setBetAmount("");
      fetchPool();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPlacingBet(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-4">
        <div className="text-center">Loading prediction market...</div>
      </Card>
    );
  }

  if (error || !pool) {
    return (
      <Card className="p-4">
        <div className="text-red-500">{error || "Pool not found"}</div>
      </Card>
    );
  }

  const isOpen = pool.status === "open" && battleStatus === "betting";
  const isLocked = pool.status === "locked" || battleStatus === "in_progress";
  const isSettled = pool.status === "settled" || battleStatus === "completed";

  return (
    <Card className="p-4 space-y-4">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-2xl font-bold">🎲 Prediction Market</h2>
        <Badge
          variant={
            isOpen ? "default" : isLocked ? "outline" : "destructive"
          }
          className="mt-2"
        >
          {pool.status.toUpperCase()}
        </Badge>
      </div>

      {/* Pool Stats */}
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">Total Pool:</span>
          <span className="font-bold">{parseFloat(pool.totalStaked).toFixed(2)} GOLD</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Participants:</span>
          <span className="font-bold">{pool.participantCount}</span>
        </div>
        {pool.timeUntilLock && pool.timeUntilLock > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-600">Locks in:</span>
            <span className="font-bold text-orange-500">
              {Math.floor(pool.timeUntilLock / 60)}m {Math.floor(pool.timeUntilLock % 60)}s
            </span>
          </div>
        )}
      </div>

      {/* Betting Interface */}
      {isOpen ? (
        <div className="space-y-3">
          <div className="text-sm font-semibold text-center">Place Your Bet</div>

          {/* Team Selection */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={selectedTeam === "RED" ? "default" : "outline"}
              className={`h-16 ${
                selectedTeam === "RED" ? "bg-red-600 hover:bg-red-700" : ""
              }`}
              onClick={() => setSelectedTeam("RED")}
            >
              <div>
                <div className="font-bold">RED</div>
                <div className="text-xs">Bet on Red Team</div>
              </div>
            </Button>

            <Button
              variant={selectedTeam === "BLUE" ? "default" : "outline"}
              className={`h-16 ${
                selectedTeam === "BLUE" ? "bg-blue-600 hover:bg-blue-700" : ""
              }`}
              onClick={() => setSelectedTeam("BLUE")}
            >
              <div>
                <div className="font-bold">BLUE</div>
                <div className="text-xs">Bet on Blue Team</div>
              </div>
            </Button>
          </div>

          {/* Amount Input */}
          <div className="space-y-2">
            <label className="text-sm text-gray-600">Amount (GOLD)</label>
            <Input
              type="number"
              placeholder="Enter amount..."
              value={betAmount}
              onChange={(e) => setBetAmount(e.target.value)}
              min="0.001"
              step="0.1"
            />
            <div className="flex gap-2">
              {[10, 50, 100, 500].map((amount) => (
                <Button
                  key={amount}
                  variant="outline"
                  size="sm"
                  onClick={() => setBetAmount(amount.toString())}
                >
                  {amount}
                </Button>
              ))}
            </div>
          </div>

          {/* Submit Button */}
          <Button
            className="w-full h-12 text-lg font-bold"
            onClick={handlePlaceBet}
            disabled={!selectedTeam || !betAmount || placingBet}
          >
            {placingBet ? "Placing Bet..." : "🔒 Place Encrypted Bet"}
          </Button>

          {error && (
            <div className="text-sm text-red-500 text-center">{error}</div>
          )}

          {/* Info */}
          <div className="text-xs text-gray-500 text-center">
            Your choice is encrypted and hidden until the battle ends!
          </div>
        </div>
      ) : isLocked ? (
        <div className="text-center py-4">
          <div className="text-lg font-semibold text-orange-600">
            ⏱️ Betting Closed
          </div>
          <div className="text-sm text-gray-600 mt-2">
            Battle in progress...
          </div>
        </div>
      ) : isSettled && winner ? (
        <div className="text-center py-4">
          <div className="text-lg font-semibold text-green-600">
            ✅ Pool Settled
          </div>
          <div className="text-xl font-bold mt-2">
            Winner: {winner.toUpperCase()} Team
          </div>
          <Button className="mt-4 w-full" variant="outline">
            Claim Winnings
          </Button>
        </div>
      ) : (
        <div className="text-center py-4 text-gray-500">
          Waiting for settlement...
        </div>
      )}

      {/* Participants List */}
      <div className="space-y-2">
        <div className="text-sm font-semibold">Recent Bets</div>
        <div className="max-h-40 overflow-y-auto space-y-1 text-xs">
          {pool.participants.slice(-10).reverse().map((p, i) => (
            <div key={i} className="flex justify-between p-1 bg-gray-50 dark:bg-gray-800 rounded">
              <span className="font-mono">
                {p.wallet.substring(0, 6)}...{p.wallet.substring(38)}
              </span>
              <span className="font-bold">{parseFloat(p.amount).toFixed(2)} GOLD 🔒</span>
            </div>
          ))}
        </div>
      </div>

      {/* FOMO Message */}
      <div className="text-center text-xs text-gray-500 italic">
        You can see who bet and how much, but not which team they chose!
      </div>
    </Card>
  );
}
