/**
 * Agent Config Store — Redis CRUD for AI agent configurations
 * Keys:
 *   agent:config:{userWallet}  → JSON AgentConfig
 *   agent:wallet:{userWallet}  → custodialWalletAddress
 *   agent:entity:{userWallet}  → JSON { entityId, zoneId }
 */

import { assertRedisAvailable, getRedis, isMemoryFallbackAllowed } from "../redis.js";
import type { AgentTier } from "./agentTiers.js";

export type AgentFocus =
  | "questing"
  | "combat"
  | "enchanting"
  | "crafting"
  | "gathering"
  | "alchemy"
  | "cooking"
  | "trading"
  | "shopping"
  | "traveling"
  | "idle"
  | "goto";

export type AgentStrategy = "aggressive" | "balanced" | "defensive";

export interface ChatMessage {
  role: "user" | "agent" | "activity";
  text: string;
  ts: number;
}

export interface AgentConfig {
  enabled: boolean;
  focus: AgentFocus;
  strategy: AgentStrategy;
  targetZone?: string;
  /** Set when user clicks "send agent here" on an NPC. Cleared once agent arrives. */
  gotoTarget?: { entityId: string; zoneId: string; name?: string; action?: string; profession?: string; techniqueId?: string; techniqueName?: string };
  lastUpdated: number;
  /** Pricing tier — defaults to "free" for backward compat */
  tier?: AgentTier;
  /** Epoch ms when the current session started (for session limit enforcement) */
  sessionStartedAt?: number;
}

export interface AgentEntityRef {
  entityId: string;
  zoneId: string;
}

// In-memory fallback
const memConfig = new Map<string, AgentConfig>();
const memWallet = new Map<string, string>();
const memEntity = new Map<string, AgentEntityRef>();

function walletKey(k: string) { return `agent:config:${k.toLowerCase()}`; }
function custWalletKey(k: string) { return `agent:wallet:${k.toLowerCase()}`; }
function entityKey(k: string) { return `agent:entity:${k.toLowerCase()}`; }

export function defaultConfig(): AgentConfig {
  return {
    enabled: false,
    focus: "questing",
    strategy: "balanced",
    lastUpdated: Date.now(),
  };
}

// ── Config ──────────────────────────────────────────────────────────────────

export async function getAgentConfig(userWallet: string): Promise<AgentConfig | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(walletKey(userWallet));
      if (raw) return JSON.parse(raw) as AgentConfig;
      return null;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("getAgentConfig");
  }
  return memConfig.get(userWallet.toLowerCase()) ?? null;
}

export async function setAgentConfig(userWallet: string, config: AgentConfig): Promise<void> {
  const key = userWallet.toLowerCase();
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(walletKey(key), JSON.stringify(config));
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("setAgentConfig");
  }
  memConfig.set(key, config);
}

export async function patchAgentConfig(
  userWallet: string,
  patch: Partial<AgentConfig>
): Promise<AgentConfig> {
  const existing = (await getAgentConfig(userWallet)) ?? defaultConfig();
  const updated: AgentConfig = { ...existing, ...patch, lastUpdated: Date.now() };
  await setAgentConfig(userWallet, updated);
  return updated;
}

function chatKey(k: string) { return `agent:chat:${k.toLowerCase()}`; }

// In-memory fallback for chat when Redis is unavailable
const memChat = new Map<string, ChatMessage[]>();

export async function appendChatMessage(
  userWallet: string,
  msg: ChatMessage,
  maxHistory = 50
): Promise<void> {
  const key = userWallet.toLowerCase();
  const redis = getRedis();
  if (redis) {
    try {
      await redis.rpush(chatKey(key), JSON.stringify(msg));
      await redis.ltrim(chatKey(key), -maxHistory, -1);
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("appendChatMessage");
  }

  const list = memChat.get(key) ?? [];
  list.push(msg);
  if (list.length > maxHistory) list.splice(0, list.length - maxHistory);
  memChat.set(key, list);
}

export async function getChatHistory(
  userWallet: string,
  limit = 50
): Promise<ChatMessage[]> {
  const key = userWallet.toLowerCase();
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.lrange(chatKey(key), -limit, -1);
      return raw.map((s: string) => JSON.parse(s) as ChatMessage);
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("getChatHistory");
  }
  return (memChat.get(key) ?? []).slice(-limit);
}

// ── Custodial wallet mapping ─────────────────────────────────────────────────

export async function getAgentCustodialWallet(userWallet: string): Promise<string | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const addr = await redis.get(custWalletKey(userWallet));
      if (addr) return addr;
      return null;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("getAgentCustodialWallet");
  }
  return memWallet.get(userWallet.toLowerCase()) ?? null;
}

export async function setAgentCustodialWallet(userWallet: string, custodialAddress: string): Promise<void> {
  const key = userWallet.toLowerCase();
  const normalized = custodialAddress.toLowerCase();
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(custWalletKey(key), normalized);
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("setAgentCustodialWallet");
  }
  memWallet.set(key, normalized);
}

// ── Entity ref ───────────────────────────────────────────────────────────────

export async function getAgentEntityRef(userWallet: string): Promise<AgentEntityRef | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(entityKey(userWallet));
      if (raw) return JSON.parse(raw) as AgentEntityRef;
      return null;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("getAgentEntityRef");
  }
  return memEntity.get(userWallet.toLowerCase()) ?? null;
}

export async function setAgentEntityRef(userWallet: string, ref: AgentEntityRef): Promise<void> {
  const key = userWallet.toLowerCase();
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(entityKey(key), JSON.stringify(ref));
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("setAgentEntityRef");
  }
  memEntity.set(key, ref);
}
