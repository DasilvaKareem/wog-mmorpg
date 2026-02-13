import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useWallet } from "@/hooks/useWallet";

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
}: PredictionMarketPanelProps): React.ReactElement {
  const [pool, setPool] = React.useState<PoolStats | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [selectedTeam, setSelectedTeam] = React.useState<"RED" | "BLUE" | null>(null);
  const [betAmount, setBetAmount] = React.useState("");
  const [placingBet, setPlacingBet] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { address, isConnected } = useWallet();
  const { notify } = useToast();

  React.useEffect(() => {
    fetchPool();
    const interval = setInterval(fetchPool, 3000);
    return () => clearInterval(interval);
  }, [poolId]);

  const fetchPool = async () => {
    try {
      const response = await fetch(`/api/prediction/pool/${poolId}`);
      if (!response.ok) throw new Error("Pool not found");
      const data = await response.json();
      setPool(data.pool);
      setLoading(false);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  const handlePlaceBet = async () => {
    if (!selectedTeam || !betAmount || !pool || !address) return;

    setPlacingBet(true);
    setError(null);

    try {
      const response = await fetch("/api/prediction/bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poolId: pool.poolId,
          choice: selectedTeam,
          amount: parseFloat(betAmount),
          walletAddress: address,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to place bet");
      }

      notify(`Bet placed: ${betAmount} GOLD on ${selectedTeam}`, "success");
      setSelectedTeam(null);
      setBetAmount("");
      fetchPool();
    } catch (err) {
      setError((err as Error).message);
      notify((err as Error).message, "error");
    } finally {
      setPlacingBet(false);
    }
  };

  if (loading) {
    return (
      <div className="border-2 border-[#29334d] bg-[#11182b] p-3">
        <div className="text-center text-[9px] text-[#9aa7cc]">Loading prediction market...</div>
      </div>
    );
  }

  if (error && !pool) {
    return (
      <div className="border-2 border-[#29334d] bg-[#11182b] p-3">
        <div className="text-[9px] text-[#ff4d6d]">{error}</div>
      </div>
    );
  }

  if (!pool) return <></>;

  const isOpen = pool.status === "open" && battleStatus === "betting";
  const isLocked = pool.status === "locked" || battleStatus === "in_progress";
  const isSettled = pool.status === "settled" || battleStatus === "completed";

  return (
    <div className="space-y-3 border-2 border-[#29334d] bg-[#11182b] p-3">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-[#ffcc00]">
          Prediction Market
        </h2>
        <Badge
          variant={isOpen ? "default" : isLocked ? "secondary" : "danger"}
          className="mt-1"
        >
          {pool.status.toUpperCase()}
        </Badge>
      </div>

      {/* Pool Stats */}
      <div className="space-y-1 text-[9px]">
        <div className="flex justify-between">
          <span className="text-[#9aa7cc]">Total Pool:</span>
          <span className="font-bold text-[#ffcc00]">{parseFloat(pool.totalStaked).toFixed(2)} GOLD</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#9aa7cc]">Participants:</span>
          <span className="font-bold text-[#f1f5ff]">{pool.participantCount}</span>
        </div>
        {pool.timeUntilLock && pool.timeUntilLock > 0 && (
          <div className="flex justify-between">
            <span className="text-[#9aa7cc]">Locks in:</span>
            <span className="font-bold text-[#ff4d6d]">
              {Math.floor(pool.timeUntilLock / 60)}m {Math.floor(pool.timeUntilLock % 60)}s
            </span>
          </div>
        )}
      </div>

      {/* Betting Interface */}
      {isOpen ? (
        <div className="space-y-2">
          <div className="text-center text-[9px] font-semibold text-[#f1f5ff]">Place Your Bet</div>

          {/* Team Selection */}
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`border-2 border-black p-2 text-[9px] font-bold uppercase shadow-[2px_2px_0_0_#000] transition ${
                selectedTeam === "RED"
                  ? "bg-[#cc3333] text-white"
                  : "bg-[#2b3656] text-[#9aa7cc] hover:bg-[#3a4870]"
              }`}
              onClick={() => setSelectedTeam("RED")}
            >
              RED
            </button>
            <button
              className={`border-2 border-black p-2 text-[9px] font-bold uppercase shadow-[2px_2px_0_0_#000] transition ${
                selectedTeam === "BLUE"
                  ? "bg-[#3355cc] text-white"
                  : "bg-[#2b3656] text-[#9aa7cc] hover:bg-[#3a4870]"
              }`}
              onClick={() => setSelectedTeam("BLUE")}
            >
              BLUE
            </button>
          </div>

          {/* Amount Input */}
          <div className="space-y-1">
            <label className="text-[8px] text-[#9aa7cc]">Amount (GOLD)</label>
            <Input
              type="number"
              placeholder="Enter amount..."
              value={betAmount}
              onChange={(e) => setBetAmount(e.target.value)}
              min="0.001"
              step="0.1"
              className="h-7 border-2 border-[#29334d] bg-[#0a0f1a] text-[9px] text-[#f1f5ff]"
            />
            <div className="flex gap-1">
              {[10, 50, 100, 500].map((amount) => (
                <button
                  key={amount}
                  className="flex-1 border-2 border-black bg-[#2b3656] px-1 py-1 text-[8px] text-[#9aa7cc] shadow-[2px_2px_0_0_#000] hover:bg-[#3a4870]"
                  onClick={() => setBetAmount(amount.toString())}
                >
                  {amount}
                </button>
              ))}
            </div>
          </div>

          {/* Submit Button */}
          <Button
            className="h-8 w-full text-[9px] font-bold uppercase"
            onClick={handlePlaceBet}
            disabled={!selectedTeam || !betAmount || placingBet || !isConnected}
          >
            {!isConnected
              ? "Connect Wallet"
              : placingBet
                ? "Placing..."
                : "Place Encrypted Bet"}
          </Button>

          {error && (
            <div className="text-center text-[8px] text-[#ff4d6d]">{error}</div>
          )}

          <div className="text-center text-[8px] text-[#565f89]">
            Your choice is encrypted until the battle ends
          </div>
        </div>
      ) : isLocked ? (
        <div className="py-3 text-center">
          <div className="text-[10px] font-semibold text-[#ffcc00]">Betting Closed</div>
          <div className="mt-1 text-[8px] text-[#9aa7cc]">Battle in progress...</div>
        </div>
      ) : isSettled && winner ? (
        <div className="py-3 text-center">
          <div className="text-[10px] font-semibold text-[#54f28b]">Pool Settled</div>
          <div className="mt-1 text-[11px] font-bold text-[#f1f5ff]">
            Winner: {winner.toUpperCase()} Team
          </div>
          <Button className="mt-2 h-7 w-full text-[9px]" variant="ghost">
            Claim Winnings
          </Button>
        </div>
      ) : (
        <div className="py-3 text-center text-[9px] text-[#9aa7cc]">
          Waiting for settlement...
        </div>
      )}

      {/* Participants List */}
      <div className="space-y-1">
        <div className="text-[9px] font-semibold text-[#9aa7cc]">Recent Bets</div>
        <div className="max-h-28 space-y-1 overflow-y-auto">
          {pool.participants.slice(-10).reverse().map((p, i) => (
            <div
              key={i}
              className="flex justify-between border border-[#29334d] bg-[#0a0f1a] p-1 text-[8px]"
            >
              <span className="font-mono text-[#9aa7cc]">
                {p.wallet.substring(0, 6)}...{p.wallet.substring(38)}
              </span>
              <span className="font-bold text-[#ffcc00]">
                {parseFloat(p.amount).toFixed(2)} GOLD
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="text-center text-[7px] italic text-[#565f89]">
        Bets are visible, but team choices are encrypted
      </div>
    </div>
  );
}
