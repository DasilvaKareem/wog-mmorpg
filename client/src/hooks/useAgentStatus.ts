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
  custodialWallet: string | null;
  entity: {
    name: string;
    level: number;
    hp: number;
    maxHp: number;
  } | null;
}

export function useAgentStatus(
  walletAddress: string | null | undefined,
  token: string | null | undefined
): AgentStatus | null {
  const [status, setStatus] = React.useState<AgentStatus | null>(null);

  React.useEffect(() => {
    if (!walletAddress || !token) return;

    let cancelled = false;

    async function poll() {
      if (cancelled || !walletAddress || !token) return;
      try {
        const res = await fetch(`${API_URL}/agent/status/${walletAddress}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && !cancelled) {
          setStatus(await res.json());
        }
      } catch {}
    }

    poll();
    const id = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [walletAddress, token]);

  return status;
}
