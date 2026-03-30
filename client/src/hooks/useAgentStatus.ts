/**
 * useAgentStatus — polls GET /agent/status/:wallet every 3s
 */

import * as React from "react";
import { API_URL } from "@/config";

export interface AgentStatus {
  running: boolean;
  config: {
    enabled: boolean;
    focus: string;
    strategy: string;
    targetZone?: string;
    chatHistory: { role: "user" | "agent"; text: string; ts: number }[];
  } | null;
  entityId: string | null;
  zoneId: string | null;
  agentId?: string | null;
  characterTokenId?: string | null;
  custodialWallet: string | null;
  entity: {
    name: string;
    level: number;
    hp: number;
    maxHp: number;
  } | null;
  entitySource?: "live" | "saved" | null;
}

export function useAgentStatus(
  walletAddress: string | null | undefined,
  token: string | null | undefined
): AgentStatus | null {
  const [status, setStatus] = React.useState<AgentStatus | null>(null);
  const failureCountRef = React.useRef(0);

  React.useEffect(() => {
    if (!walletAddress || !token) {
      setStatus(null);
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;

    async function poll() {
      if (cancelled || !walletAddress || !token) return;
      try {
        const res = await fetch(`${API_URL}/agent/status/${walletAddress}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && !cancelled) {
          setStatus(await res.json());
          failureCountRef.current = 0;
        } else if (!cancelled) {
          setStatus(null);
          failureCountRef.current += 1;
        }
      } catch {
        if (!cancelled) {
          setStatus(null);
          failureCountRef.current += 1;
        }
      }

      if (cancelled) return;
      const failureCount = failureCountRef.current;
      const nextDelay =
        failureCount === 0
          ? 3000
          : Math.min(30000, 3000 * 2 ** Math.min(failureCount, 3));

      timeoutId = window.setTimeout(() => {
        void poll();
      }, nextDelay);
    }

    void poll();
    return () => {
      cancelled = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [walletAddress, token]);

  return status;
}
