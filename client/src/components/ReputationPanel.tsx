/**
 * Reputation Panel Component
 * Displays ERC-8004 reputation scores for a character
 */

import React, { useState, useEffect } from "react";
import { API_URL, getSkaleExplorerTxUrl } from "../config.js";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";

interface ReputationPanelProps {
  agentId: string | null;
}

interface ReputationData {
  combat: number;
  economic: number;
  social: number;
  crafting: number;
  agent: number;
  overall: number;
  lastUpdated: number;
  rank: string;
}

interface IdentityData {
  ownerWallet: string | null;
  endpoint: string | null;
  characterTokenId: string | null;
  registrationTxHash: string | null;
  chainId?: number | string | null;
  onChainRegistered: boolean;
}

interface FeedbackItem {
  category: string;
  delta: number;
  reason: string;
  timestamp: number;
  validated?: boolean;
}

export function ReputationPanel({ agentId }: ReputationPanelProps) {
  const [reputation, setReputation] = useState<ReputationData | null>(null);
  const [identity, setIdentity] = useState<IdentityData | null>(null);
  const [history, setHistory] = useState<FeedbackItem[]>([]);
  const [validations, setValidations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    fetchReputation();
  }, [agentId]);

  const toDate = (value: number): Date => {
    const timestamp = value < 1_000_000_000_000 ? value * 1000 : value;
    return new Date(timestamp);
  };

  const fetchReputation = async () => {
    setLoading(true);
    setError(null);

    if (!agentId) {
      setError("Identity registration pending");
      setLoading(false);
      return;
    }

    try {
      const [repResponse, historyResponse, identityResponse, validationsResponse] =
        await Promise.all([
          fetch(`${API_URL}/api/agents/${agentId}/reputation`),
          fetch(`${API_URL}/api/agents/${agentId}/reputation/history?limit=10`),
          fetch(`${API_URL}/api/agents/${agentId}/identity`),
          fetch(`${API_URL}/api/agents/${agentId}/validations`),
        ]);

      if (!repResponse.ok) {
        throw new Error("Reputation not found");
      }
      const repData = await repResponse.json();
      setReputation(repData.reputation);

      if (historyResponse.ok) {
        const historyData = await historyResponse.json();
        setHistory(historyData.history);
      } else {
        setHistory([]);
      }

      if (identityResponse.ok) {
        const identityData = await identityResponse.json();
        setIdentity(identityData.identity ?? null);
      } else {
        setIdentity(null);
      }

      if (validationsResponse.ok) {
        const validationData = await validationsResponse.json();
        setValidations(
          Array.isArray(validationData.validations)
            ? validationData.validations
                .map((claim: { claimType?: string }) => claim.claimType ?? "")
                .filter(Boolean)
            : []
        );
      } else {
        setValidations([]);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-4">
        <div className="text-center text-gray-500">Loading reputation...</div>
      </Card>
    );
  }

  if (error || !reputation) {
    return (
      <Card className="p-4">
        <div className="text-center text-red-500">
          {error || "No reputation data"}
        </div>
      </Card>
    );
  }

  const getRankColor = (score: number): string => {
    if (score >= 900) return "text-yellow-500";
    if (score >= 800) return "text-purple-500";
    if (score >= 700) return "text-blue-500";
    if (score >= 600) return "text-green-500";
    if (score >= 500) return "text-gray-500";
    if (score >= 400) return "text-yellow-600";
    if (score >= 300) return "text-orange-500";
    return "text-red-500";
  };

  const getRankBadgeVariant = (
    score: number
  ): "default" | "secondary" | "danger" => {
    if (score >= 700) return "default";
    if (score >= 400) return "secondary";
    return "danger";
  };

  const registrationTxUrl = getSkaleExplorerTxUrl(identity?.registrationTxHash, identity?.chainId);

  return (
    <Card className="p-6 space-y-4">
      {/* Header */}
      <div className="text-center">
        <div className="text-sm text-gray-500 uppercase tracking-wide mb-2">
          ERC-8004 Reputation
        </div>
        <div className={`text-4xl font-bold ${getRankColor(reputation.overall)}`}>
          {reputation.overall}
        </div>
        <Badge
          variant={getRankBadgeVariant(reputation.overall)}
          className="mt-2"
        >
          {reputation.rank}
        </Badge>
      </div>

      {(identity || validations.length > 0) && (
        <div className="space-y-2 rounded border border-gray-200 p-3 dark:border-gray-700">
          {identity && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
              <span>
                {identity.onChainRegistered ? "On-chain identity active" : "Identity registration pending"}
              </span>
              {identity.characterTokenId && <span>Character #{identity.characterTokenId}</span>}
              {identity.registrationTxHash && (
                registrationTxUrl ? (
                  <a href={registrationTxUrl} target="_blank" rel="noreferrer" className="text-blue-500 underline underline-offset-2">
                    {registrationTxUrl}
                  </a>
                ) : (
                  <span>Registration TX recorded</span>
                )
              )}
            </div>
          )}
          {validations.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {validations.map((claimType) => (
                <Badge key={claimType} variant="secondary">
                  {claimType}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Overall Progress Bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-gray-500">
          <span>Overall Score</span>
          <span>{reputation.overall} / 1000</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all ${
              reputation.overall >= 700
                ? "bg-gradient-to-r from-green-400 to-blue-500"
                : reputation.overall >= 400
                ? "bg-gradient-to-r from-yellow-400 to-orange-500"
                : "bg-gradient-to-r from-red-500 to-red-700"
            }`}
            style={{ width: `${(reputation.overall / 1000) * 100}%` }}
          />
        </div>
      </div>

      {/* Category Breakdown */}
      <div className="space-y-3">
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Category Breakdown
        </div>

        {/* Combat */}
        <CategoryBar
          label="⚔️ Combat"
          score={reputation.combat}
          color="red"
        />

        {/* Economic */}
        <CategoryBar
          label="💰 Economic"
          score={reputation.economic}
          color="green"
        />

        {/* Social */}
        <CategoryBar
          label="🤝 Social"
          score={reputation.social}
          color="blue"
        />

        {/* Crafting */}
        <CategoryBar
          label="🔨 Crafting"
          score={reputation.crafting}
          color="purple"
        />

        {/* Agent (if applicable) */}
        {reputation.agent > 0 && (
          <CategoryBar
            label="🤖 Agent"
            score={reputation.agent}
            color="cyan"
          />
        )}
      </div>

      {/* Recent Activity */}
      <div className="pt-4 border-t">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="text-sm text-blue-500 hover:text-blue-700 font-medium"
        >
          {showHistory ? "Hide" : "View"} Recent Activity ({history.length})
        </button>

        {showHistory && (
          <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
            {history.length === 0 ? (
              <div className="text-xs text-gray-500 text-center py-4">
                No activity yet
              </div>
            ) : (
              history.map((item, index) => (
                <div
                  key={index}
                  className="flex items-start gap-2 text-xs p-2 bg-gray-50 dark:bg-gray-800 rounded"
                >
                  <div
                    className={`font-semibold ${
                      item.delta > 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {item.delta > 0 ? "+" : ""}
                    {item.delta}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">{item.category}</div>
                    <div className="text-gray-600 dark:text-gray-400">
                      {item.reason}
                    </div>
                    <div className="text-gray-400 text-xs mt-1">
                      {toDate(item.timestamp).toLocaleDateString()}
                    </div>
                  </div>
                  {item.validated && (
                    <div className="text-green-500 text-lg">✓</div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="text-xs text-gray-500 text-center pt-2 border-t">
        Last updated:{" "}
        {toDate(reputation.lastUpdated).toLocaleString()}
      </div>
    </Card>
  );
}

function CategoryBar({
  label,
  score,
  color,
}: {
  label: string;
  score: number;
  color: string;
}) {
  const getColorClass = (c: string): string => {
    const colors: Record<string, string> = {
      red: "bg-red-500",
      green: "bg-green-500",
      blue: "bg-blue-500",
      purple: "bg-purple-500",
      cyan: "bg-cyan-500",
    };
    return colors[c] || "bg-gray-500";
  };

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-600 dark:text-gray-400">{label}</span>
        <span className="font-semibold">{score}</span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${getColorClass(color)}`}
          style={{ width: `${(score / 1000) * 100}%` }}
        />
      </div>
    </div>
  );
}
