/**
 * Agent Push Service — bridges agent events to web push notifications.
 *
 * Sends fire-and-forget push notifications to the owner wallet when
 * significant events happen to their deployed AI agent.
 */

import { sendPushToWallet, type PushPayload } from "../social/webPushService.js";
import { getRedis } from "../redis.js";

// ── Event types ──────────────────────────────────────────────────────────

export type AgentPushType =
  | "level_up"
  | "death"
  | "quest_complete"
  | "zone_arrived"
  | "loot_rare"
  | "technique_learned"
  | "session_ended"
  | "agent_message"
  | "champion_question"
  | "agent_stuck";

export interface AgentPushEvent {
  type: AgentPushType;
  agentName: string;
  detail?: string;
}

// ── Rate limiting (1 push per type per 60s) ──────────────────────────────

const RATE_LIMIT_SEC = 60;
const memoryRateCache = new Map<string, number>();

async function isRateLimited(wallet: string, type: AgentPushType): Promise<boolean> {
  const key = `push:rate:${wallet.toLowerCase()}:${type}`;

  const redis = getRedis();
  if (redis) {
    try {
      const result = await redis.set(key, "1", "EX", RATE_LIMIT_SEC, "NX");
      return result === null; // null = key already existed = rate limited
    } catch {
      // Fall through to in-memory
    }
  }

  // In-memory fallback
  const now = Date.now();
  const prev = memoryRateCache.get(key);
  if (prev && now - prev < RATE_LIMIT_SEC * 1000) return true;
  memoryRateCache.set(key, now);
  return false;
}

// ── Payload builders ─────────────────────────────────────────────────────

function formatZone(zoneId: string): string {
  return zoneId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function buildPayload(event: AgentPushEvent): PushPayload {
  const { type, agentName, detail } = event;

  switch (type) {
    case "level_up":
      return {
        title: "Level Up!",
        body: `${agentName} reached level ${detail ?? "?"}!`,
        tag: `wog-agent-levelup`,
      };
    case "death":
      return {
        title: "Agent Slain",
        body: `${agentName} fell in ${detail ? formatZone(detail) : "battle"}.`,
        tag: `wog-agent-death`,
      };
    case "quest_complete":
      return {
        title: "Quest Complete!",
        body: `${agentName} completed ${detail ? `"${detail}"` : "a quest"}!`,
        tag: `wog-agent-quest`,
      };
    case "zone_arrived":
      return {
        title: "New Zone",
        body: `${agentName} arrived in ${detail ? formatZone(detail) : "a new zone"}.`,
        tag: `wog-agent-zone`,
      };
    case "loot_rare":
      return {
        title: "Rare Loot!",
        body: `${agentName} found ${detail ?? "something rare"}!`,
        tag: `wog-agent-loot`,
      };
    case "technique_learned":
      return {
        title: "New Technique",
        body: `${agentName} learned ${detail ?? "a new ability"}!`,
        tag: `wog-agent-technique`,
      };
    case "session_ended":
      return {
        title: "Agent Stopped",
        body: `${agentName}: ${detail ?? "session ended"}.`,
        tag: `wog-agent-session`,
      };
    case "agent_message":
      return {
        title: agentName,
        body: detail ?? "",
        tag: `wog-agent-msg`,
      };
    case "champion_question":
      return {
        title: `${agentName} needs your decision`,
        body: detail ?? "Your champion has a question for you!",
        tag: `wog-agent-question`,
      };
    case "agent_stuck":
      return {
        title: `${agentName} is stuck`,
        body: detail ?? "Agent is stuck and needs direction.",
        tag: `wog-agent-stuck`,
      };
  }
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Send a push notification for an agent event to the owner's device.
 * Fire-and-forget — never throws.
 */
export async function sendAgentPush(
  userWallet: string,
  event: AgentPushEvent,
): Promise<void> {
  try {
    if (await isRateLimited(userWallet, event.type)) return;
    const payload = buildPayload(event);
    await sendPushToWallet(userWallet, payload);
  } catch {
    // Silently ignore — push is best-effort
  }
}
