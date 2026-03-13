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
  | "learning"
  | "idle"
  | "goto";

export type AgentStrategy = "aggressive" | "balanced" | "defensive";

export interface ChatMessage {
  role: "user" | "agent" | "activity" | "question";
  text: string;
  ts: number;
  /** Present only when role === "question" */
  questionId?: string;
  /** Answer choices, e.g. ["Yes", "No"] */
  choices?: string[];
}

/** A pending champion→summoner question awaiting a reply. */
export interface PendingQuestion {
  questionId: string;
  text: string;
  choices: string[];
  /** Extra context the agent stores for itself to act on the reply */
  context?: Record<string, unknown>;
  askedAt: number;
  expiresAt: number;
  reply?: string;
  repliedAt?: number;
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
  characterName?: string;
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

// ── Deploy count (per-owner wallet) ──────────────────────────────────────────

function deployCountKey(k: string) { return `agent:deploys:${k.toLowerCase()}`; }
const memDeployCount = new Map<string, number>();

export async function getDeployCount(userWallet: string): Promise<number> {
  const key = userWallet.toLowerCase();
  const redis = getRedis();
  if (redis) {
    try {
      const val = await redis.get(deployCountKey(key));
      return val ? parseInt(val, 10) : 0;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("getDeployCount");
  }
  return memDeployCount.get(key) ?? 0;
}

export async function incrementDeployCount(userWallet: string): Promise<number> {
  const key = userWallet.toLowerCase();
  const redis = getRedis();
  if (redis) {
    try {
      const newVal = await redis.incr(deployCountKey(key));
      return newVal;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("incrementDeployCount");
  }
  const current = memDeployCount.get(key) ?? 0;
  memDeployCount.set(key, current + 1);
  return current + 1;
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

export async function clearAgentEntityRef(userWallet: string): Promise<void> {
  const key = userWallet.toLowerCase();
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(entityKey(key));
      memEntity.delete(key);
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("clearAgentEntityRef");
  }
  memEntity.delete(key);
}

// ── Champion Questions ──────────────────────────────────────────────────────

function questionKey(k: string) { return `agent:question:${k.toLowerCase()}`; }
const memQuestions = new Map<string, PendingQuestion>();

/** Default question TTL — 2 minutes */
const QUESTION_TTL_MS = 2 * 60_000;

let questionIdCounter = 0;

/**
 * Champion asks the summoner a question. Only one pending question at a time.
 * Returns the questionId.
 */
export async function askSummonerQuestion(
  userWallet: string,
  text: string,
  choices: string[] = ["Yes", "No"],
  context?: Record<string, unknown>,
): Promise<PendingQuestion> {
  const key = userWallet.toLowerCase();
  const now = Date.now();
  const question: PendingQuestion = {
    questionId: `q-${now}-${++questionIdCounter}`,
    text,
    choices,
    context,
    askedAt: now,
    expiresAt: now + QUESTION_TTL_MS,
  };

  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(questionKey(key), JSON.stringify(question), "PX", QUESTION_TTL_MS);
      return question;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("askSummonerQuestion");
  }
  memQuestions.set(key, question);
  return question;
}

/** Get the current pending question (if any). Returns null if expired or none. */
export async function getSummonerQuestion(userWallet: string): Promise<PendingQuestion | null> {
  const key = userWallet.toLowerCase();
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(questionKey(key));
      if (!raw) return null;
      const q = JSON.parse(raw) as PendingQuestion;
      if (Date.now() > q.expiresAt && !q.reply) return null;
      return q;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("getSummonerQuestion");
  }
  const q = memQuestions.get(key);
  if (!q) return null;
  if (Date.now() > q.expiresAt && !q.reply) { memQuestions.delete(key); return null; }
  return q;
}

/** Summoner replies to the pending question. Returns the updated question or null if not found. */
export async function replySummonerQuestion(
  userWallet: string,
  questionId: string,
  reply: string,
): Promise<PendingQuestion | null> {
  const key = userWallet.toLowerCase();
  const existing = await getSummonerQuestion(userWallet);
  if (!existing || existing.questionId !== questionId) return null;
  if (!existing.choices.map(c => c.toLowerCase()).includes(reply.toLowerCase())) return null;

  existing.reply = reply;
  existing.repliedAt = Date.now();

  const redis = getRedis();
  if (redis) {
    try {
      // Keep for 30s after reply so the agent runner picks it up
      await redis.set(questionKey(key), JSON.stringify(existing), "PX", 30_000);
      return existing;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("replySummonerQuestion");
  }
  memQuestions.set(key, existing);
  return existing;
}

/** Clear the pending question after the agent has processed the reply. */
export async function clearSummonerQuestion(userWallet: string): Promise<void> {
  const key = userWallet.toLowerCase();
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(questionKey(key));
      memQuestions.delete(key);
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("clearSummonerQuestion");
  }
  memQuestions.delete(key);
}
