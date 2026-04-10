/**
 * Agent Config Store — Redis CRUD for AI agent configurations
 * Keys:
 *   agent:config:{userWallet}  → JSON AgentConfig
 *   agent:wallet:{userWallet}  → custodialWalletAddress
 *   agent:entity:{userWallet}  → JSON { entityId, zoneId, characterName?, agentId?, characterTokenId? }
 */

import { assertRedisAvailable, getRedis, isMemoryFallbackAllowed } from "../redis.js";
import { clearWalletEntityLink, upsertWalletLink } from "../character/characterProjectionStore.js";
import { enqueueOutboxEvent } from "../db/outbox.js";
import { getWalletRuntimeState, listWalletRuntimeStatesByPrefix, putWalletRuntimeState } from "../db/walletInfraStore.js";
import { isPostgresConfigured } from "../db/postgres.js";
import type { AgentTier } from "./agentTiers.js";
import type { BotScript, TriggerEvent } from "../types/botScriptTypes.js";
import type { Edict } from "../combat/edicts.js";

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
  | "goto"
  | "dungeon"
  | "leatherworking"
  | "jewelcrafting"
  | "farming";

export type AgentStrategy = "aggressive" | "balanced" | "defensive";
export type GatherPreference = NonNullable<BotScript["nodeType"]>;

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

/** A single user-defined objective for the agent to work toward. */
export interface AgentObjective {
  id: string;
  /** What the agent should accomplish */
  type: "reach_level" | "travel_to" | "gather" | "craft" | "earn_gold" | "complete_quest" | "learn_profession" | "learn_technique" | "buy_item" | "custom";
  /** Human-readable label shown in UI */
  label: string;
  /** Type-specific parameters */
  params: Record<string, unknown>;
  /** Current status */
  status: "pending" | "active" | "completed" | "failed";
  /** Optional completion condition check context */
  progress?: number;
  target?: number;
  createdAt: number;
  completedAt?: number;
}

export interface AgentConfig {
  enabled: boolean;
  focus: AgentFocus;
  strategy: AgentStrategy;
  gatherNodeType?: GatherPreference;
  targetZone?: string;
  /** Set when user clicks "send agent here" on an NPC. Cleared once agent arrives. */
  gotoTarget?: { entityId: string; zoneId: string; name?: string; action?: string; profession?: string; techniqueId?: string; techniqueName?: string; questId?: string };
  /** Set when user clicks empty ground to move agent to a position. Cleared on arrival. */
  gotoPosition?: { x: number; y: number; zoneId: string };
  lastUpdated: number;
  /** Pricing tier — defaults to "free" for backward compat */
  tier?: AgentTier;
  /** Epoch ms when the current session started (for session limit enforcement) */
  sessionStartedAt?: number;
  /** Ordered list of objectives — agent works through them in order */
  objectives?: AgentObjective[];
  /** Ordered combat edicts (gambit rules) — evaluated top-to-bottom each tick */
  edicts?: Edict[];
}

export interface AgentEntityRef {
  entityId: string;
  zoneId: string;
  characterName?: string;
  agentId?: string;
  characterTokenId?: string;
}

export interface AgentRuntimeState {
  currentScript: BotScript | null;
  currentActivity: string;
  recentActivities: string[];
  currentRegion: string;
  entityId: string | null;
  custodialWallet: string | null;
  pendingQuestionId: string | null;
  lastTrigger: TriggerEvent | null;
  updatedAt: number;
}

// In-memory fallback
const memConfig = new Map<string, AgentConfig>();
const memWallet = new Map<string, string>();
const memEntity = new Map<string, AgentEntityRef>();

function walletKey(k: string) { return `agent:config:${k.toLowerCase()}`; }
function custWalletKey(k: string) { return `agent:wallet:${k.toLowerCase()}`; }
function entityKey(k: string) { return `agent:entity:${k.toLowerCase()}`; }
function runtimeKey(k: string) { return `agent:runtime:${k.toLowerCase()}`; }

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
  if (isPostgresConfigured()) {
    const stored = await getWalletRuntimeState<AgentConfig>(walletKey(userWallet));
    if (stored) return stored;
  }
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
    if (!isPostgresConfigured()) assertRedisAvailable("getAgentConfig");
  }
  return memConfig.get(userWallet.toLowerCase()) ?? null;
}

export async function setAgentConfig(userWallet: string, config: AgentConfig): Promise<void> {
  const key = userWallet.toLowerCase();
  if (isPostgresConfigured()) {
    await putWalletRuntimeState(walletKey(key), config);
  }
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(walletKey(key), JSON.stringify(config));
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) assertRedisAvailable("setAgentConfig");
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

// ── Action Queue (per-agent, Redis-backed) ─────────────────────────────────

const MAX_QUEUE_SIZE = 10;
function queueKey(k: string) { return `agent:queue:${k.toLowerCase()}`; }
const memQueue = new Map<string, BotScript[]>();

export async function getActionQueue(userWallet: string): Promise<BotScript[]> {
  const key = userWallet.toLowerCase();
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(queueKey(key));
      if (raw) return JSON.parse(raw) as BotScript[];
      return [];
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("getActionQueue");
  }
  return memQueue.get(key) ?? [];
}

export async function setActionQueue(userWallet: string, items: BotScript[]): Promise<void> {
  const key = userWallet.toLowerCase();
  const clamped = items.slice(0, MAX_QUEUE_SIZE);
  const redis = getRedis();
  if (redis) {
    try {
      if (clamped.length === 0) {
        await redis.del(queueKey(key));
      } else {
        await redis.set(queueKey(key), JSON.stringify(clamped));
      }
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("setActionQueue");
  }
  if (clamped.length === 0) memQueue.delete(key);
  else memQueue.set(key, clamped);
}

export async function clearActionQueue(userWallet: string): Promise<void> {
  await setActionQueue(userWallet, []);
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
  const existingHistory = isPostgresConfigured()
    ? ((await getWalletRuntimeState<ChatMessage[]>(chatKey(key))) ?? memChat.get(key) ?? [])
    : [];
  if (isPostgresConfigured()) {
    const nextHistory = [...existingHistory, msg];
    if (nextHistory.length > maxHistory) nextHistory.splice(0, nextHistory.length - maxHistory);
    await putWalletRuntimeState(chatKey(key), nextHistory);
  }
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
    if (!isPostgresConfigured()) assertRedisAvailable("appendChatMessage");
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
  if (isPostgresConfigured()) {
    const history = await getWalletRuntimeState<ChatMessage[]>(chatKey(key));
    if (history && history.length > 0) return history.slice(-limit);
  }
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.lrange(chatKey(key), -limit, -1);
      return raw.map((s: string) => JSON.parse(s) as ChatMessage);
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) assertRedisAvailable("getChatHistory");
  }
  return (memChat.get(key) ?? []).slice(-limit);
}

// ── Error log (per-agent, queryable) ────────────────────────────────────────

export interface AgentErrorEntry {
  ts: number;
  category: "loop" | "supervisor" | "action" | "mcp" | "deploy" | "chat" | "other";
  message: string;
  /** Which script/focus was active when the error occurred */
  scriptType?: string;
  /** Which zone the agent was in */
  zoneId?: string;
  /** Extra context (endpoint, target, etc.) */
  context?: Record<string, string>;
}

function errorKey(k: string) { return `agent:errors:${k.toLowerCase()}`; }
/** Global error stream — all agents combined */
const GLOBAL_ERROR_KEY = "agent:errors:__global__";
const memErrors = new Map<string, AgentErrorEntry[]>();
const MAX_ERRORS_PER_AGENT = 200;
const MAX_GLOBAL_ERRORS = 500;

export async function appendAgentError(
  userWallet: string,
  entry: AgentErrorEntry,
): Promise<void> {
  const key = userWallet.toLowerCase();
  const serialized = JSON.stringify(entry);
  if (isPostgresConfigured()) {
    const perAgent = (await getWalletRuntimeState<AgentErrorEntry[]>(errorKey(key))) ?? memErrors.get(key) ?? [];
    const nextPerAgent = [...perAgent, entry];
    if (nextPerAgent.length > MAX_ERRORS_PER_AGENT) nextPerAgent.splice(0, nextPerAgent.length - MAX_ERRORS_PER_AGENT);
    await putWalletRuntimeState(errorKey(key), nextPerAgent);

    const globalEntries = (await getWalletRuntimeState<Array<AgentErrorEntry & { wallet?: string }>>(GLOBAL_ERROR_KEY)) ?? [];
    const nextGlobal = [...globalEntries, { ...entry, wallet: key }];
    if (nextGlobal.length > MAX_GLOBAL_ERRORS) nextGlobal.splice(0, nextGlobal.length - MAX_GLOBAL_ERRORS);
    await putWalletRuntimeState(GLOBAL_ERROR_KEY, nextGlobal);
  }
  const redis = getRedis();
  if (redis) {
    try {
      // Per-agent log
      await redis.rpush(errorKey(key), serialized);
      await redis.ltrim(errorKey(key), -MAX_ERRORS_PER_AGENT, -1);
      // Global log
      const globalEntry = JSON.stringify({ ...entry, wallet: key });
      await redis.rpush(GLOBAL_ERROR_KEY, globalEntry);
      await redis.ltrim(GLOBAL_ERROR_KEY, -MAX_GLOBAL_ERRORS, -1);
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) assertRedisAvailable("appendAgentError");
  }

  const list = memErrors.get(key) ?? [];
  list.push(entry);
  if (list.length > MAX_ERRORS_PER_AGENT) list.splice(0, list.length - MAX_ERRORS_PER_AGENT);
  memErrors.set(key, list);
}

export async function getAgentErrors(
  userWallet: string,
  limit = 100,
): Promise<AgentErrorEntry[]> {
  const key = userWallet.toLowerCase();
  if (isPostgresConfigured()) {
    const entries = await getWalletRuntimeState<AgentErrorEntry[]>(errorKey(key));
    if (entries && entries.length > 0) return entries.slice(-limit);
  }
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.lrange(errorKey(key), -limit, -1);
      return raw.map((s: string) => JSON.parse(s) as AgentErrorEntry);
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) assertRedisAvailable("getAgentErrors");
  }
  return (memErrors.get(key) ?? []).slice(-limit);
}

export async function getGlobalAgentErrors(
  limit = 200,
): Promise<(AgentErrorEntry & { wallet?: string })[]> {
  if (isPostgresConfigured()) {
    const entries = await getWalletRuntimeState<Array<AgentErrorEntry & { wallet?: string }>>(GLOBAL_ERROR_KEY);
    if (entries && entries.length > 0) return entries.slice(-limit);
  }
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.lrange(GLOBAL_ERROR_KEY, -limit, -1);
      return raw.map((s: string) => JSON.parse(s));
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) assertRedisAvailable("getGlobalAgentErrors");
  }
  // Fallback: merge all in-memory
  const all: (AgentErrorEntry & { wallet?: string })[] = [];
  for (const [wallet, entries] of memErrors) {
    for (const e of entries) all.push({ ...e, wallet });
  }
  all.sort((a, b) => a.ts - b.ts);
  return all.slice(-limit);
}

// ── Deploy count (per-owner wallet) ──────────────────────────────────────────

function deployCountKey(k: string) { return `agent:deploys:${k.toLowerCase()}`; }
const memDeployCount = new Map<string, number>();

export async function getDeployCount(userWallet: string): Promise<number> {
  const key = userWallet.toLowerCase();
  if (isPostgresConfigured()) {
    const stored = await getWalletRuntimeState<number>(deployCountKey(key));
    if (typeof stored === "number") return stored;
  }
  const redis = getRedis();
  if (redis) {
    try {
      const val = await redis.get(deployCountKey(key));
      return val ? parseInt(val, 10) : 0;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) assertRedisAvailable("getDeployCount");
  }
  return memDeployCount.get(key) ?? 0;
}

export async function incrementDeployCount(userWallet: string): Promise<number> {
  const key = userWallet.toLowerCase();
  if (isPostgresConfigured()) {
    const next = ((await getWalletRuntimeState<number>(deployCountKey(key))) ?? memDeployCount.get(key) ?? 0) + 1;
    await putWalletRuntimeState(deployCountKey(key), next);
    memDeployCount.set(key, next);
    const redis = getRedis();
    if (redis) {
      try {
        await redis.incr(deployCountKey(key));
      } catch (err) {
        if (!isMemoryFallbackAllowed()) throw err;
      }
    }
    return next;
  }
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
  if (isPostgresConfigured()) {
    const addr = await getWalletRuntimeState<string>(custWalletKey(userWallet));
    if (addr) return addr;
  }
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
    if (!isPostgresConfigured()) assertRedisAvailable("getAgentCustodialWallet");
  }
  return memWallet.get(userWallet.toLowerCase()) ?? null;
}

export async function setAgentCustodialWallet(userWallet: string, custodialAddress: string): Promise<void> {
  const key = userWallet.toLowerCase();
  const normalized = custodialAddress.toLowerCase();
  if (isPostgresConfigured()) {
    await putWalletRuntimeState(custWalletKey(key), normalized);
  }
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(custWalletKey(key), normalized);
      await upsertWalletLink({
        ownerWallet: key,
        custodialWallet: normalized,
      }).catch((err) => {
        console.warn(`[walletLinks] Failed to sync custodial mapping for ${key}: ${err.message?.slice(0, 140) ?? err}`);
      });
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) assertRedisAvailable("setAgentCustodialWallet");
  }
  memWallet.set(key, normalized);
  await upsertWalletLink({
    ownerWallet: key,
    custodialWallet: normalized,
  }).catch((err) => {
    console.warn(`[walletLinks] Failed to sync custodial mapping for ${key}: ${err.message?.slice(0, 140) ?? err}`);
  });
  await enqueueOutboxEvent({
    topic: "wallet_link.updated",
    aggregateType: "wallet_link",
    aggregateKey: key,
    payload: {
      ownerWallet: key,
      custodialWallet: normalized,
    },
  }).catch((err) => {
    console.warn(`[outbox] Failed to enqueue wallet_link.updated for ${key}: ${err.message?.slice(0, 140) ?? err}`);
  });
}

export async function clearAgentCustodialWallet(userWallet: string): Promise<void> {
  const key = userWallet.toLowerCase();
  if (isPostgresConfigured()) {
    await putWalletRuntimeState(custWalletKey(key), null);
  }
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(custWalletKey(key));
      if (isMemoryFallbackAllowed()) {
        memWallet.delete(key);
      }
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) assertRedisAvailable("clearAgentCustodialWallet");
  }
  memWallet.delete(key);
}

// ── Entity ref ───────────────────────────────────────────────────────────────

export async function getAgentEntityRef(userWallet: string): Promise<AgentEntityRef | null> {
  if (isPostgresConfigured()) {
    const stored = await getWalletRuntimeState<AgentEntityRef>(entityKey(userWallet));
    if (stored?.entityId && stored?.zoneId) return stored;
  }
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(entityKey(userWallet));
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AgentEntityRef> | null;
        if (parsed && typeof parsed.entityId === "string" && typeof parsed.zoneId === "string") {
          return {
            entityId: parsed.entityId,
            zoneId: parsed.zoneId,
            ...(typeof parsed.characterName === "string" ? { characterName: parsed.characterName } : {}),
            ...(typeof parsed.agentId === "string" ? { agentId: parsed.agentId } : {}),
            ...(typeof parsed.characterTokenId === "string" ? { characterTokenId: parsed.characterTokenId } : {}),
          };
        }
      }
      return null;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) assertRedisAvailable("getAgentEntityRef");
  }
  return memEntity.get(userWallet.toLowerCase()) ?? null;
}

export async function setAgentEntityRef(userWallet: string, ref: AgentEntityRef): Promise<void> {
  const key = userWallet.toLowerCase();
  if (isPostgresConfigured()) {
    await putWalletRuntimeState(entityKey(key), ref);
  }
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(entityKey(key), JSON.stringify(ref));
      await upsertWalletLink({
        ownerWallet: key,
        entityId: ref.entityId,
        lastZoneId: ref.zoneId,
        characterName: ref.characterName ?? null,
        agentId: ref.agentId ?? null,
        characterTokenId: ref.characterTokenId ?? null,
      }).catch((err) => {
        console.warn(`[walletLinks] Failed to sync entity ref for ${key}: ${err.message?.slice(0, 140) ?? err}`);
      });
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) assertRedisAvailable("setAgentEntityRef");
  }
  memEntity.set(key, ref);
  await upsertWalletLink({
    ownerWallet: key,
    entityId: ref.entityId,
    lastZoneId: ref.zoneId,
    characterName: ref.characterName ?? null,
    agentId: ref.agentId ?? null,
    characterTokenId: ref.characterTokenId ?? null,
  }).catch((err) => {
    console.warn(`[walletLinks] Failed to sync entity ref for ${key}: ${err.message?.slice(0, 140) ?? err}`);
  });
  await enqueueOutboxEvent({
    topic: "wallet_runtime.updated",
    aggregateType: "wallet_link",
    aggregateKey: key,
    payload: {
      ownerWallet: key,
      entityId: ref.entityId,
      zoneId: ref.zoneId,
      characterName: ref.characterName ?? null,
      agentId: ref.agentId ?? null,
      characterTokenId: ref.characterTokenId ?? null,
    },
  }).catch((err) => {
    console.warn(`[outbox] Failed to enqueue wallet_runtime.updated for ${key}: ${err.message?.slice(0, 140) ?? err}`);
  });
}

export async function clearAgentEntityRef(userWallet: string): Promise<void> {
  const key = userWallet.toLowerCase();
  if (isPostgresConfigured()) {
    await putWalletRuntimeState(entityKey(key), null);
  }
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(entityKey(key));
      await clearWalletEntityLink(key).catch((err) => {
        console.warn(`[walletLinks] Failed to clear entity ref for ${key}: ${err.message?.slice(0, 140) ?? err}`);
      });
      memEntity.delete(key);
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) assertRedisAvailable("clearAgentEntityRef");
  }
  memEntity.delete(key);
  await clearWalletEntityLink(key).catch((err) => {
    console.warn(`[walletLinks] Failed to clear entity ref for ${key}: ${err.message?.slice(0, 140) ?? err}`);
  });
}

// ── Runtime snapshot ────────────────────────────────────────────────────────

const memRuntime = new Map<string, AgentRuntimeState>();

export async function getAgentRuntimeState(userWallet: string): Promise<AgentRuntimeState | null> {
  const key = userWallet.toLowerCase();
  if (isPostgresConfigured()) {
    const stored = await getWalletRuntimeState<AgentRuntimeState>(runtimeKey(key));
    if (stored) return stored;
  }
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(runtimeKey(key));
      if (raw) return JSON.parse(raw) as AgentRuntimeState;
      return null;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) assertRedisAvailable("getAgentRuntimeState");
  }
  return memRuntime.get(key) ?? null;
}

export async function setAgentRuntimeState(userWallet: string, runtime: AgentRuntimeState): Promise<void> {
  const key = userWallet.toLowerCase();
  const payload = { ...runtime, updatedAt: Date.now() };
  if (isPostgresConfigured()) {
    await putWalletRuntimeState(runtimeKey(key), payload);
  }
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(runtimeKey(key), JSON.stringify(payload));
      memRuntime.set(key, payload);
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) assertRedisAvailable("setAgentRuntimeState");
  }
  memRuntime.set(key, payload);
}

export async function clearAgentRuntimeState(userWallet: string): Promise<void> {
  const key = userWallet.toLowerCase();
  if (isPostgresConfigured()) {
    await putWalletRuntimeState(runtimeKey(key), null);
  }
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(runtimeKey(key));
      memRuntime.delete(key);
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) assertRedisAvailable("clearAgentRuntimeState");
  }
  memRuntime.delete(key);
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

  if (isPostgresConfigured()) {
    await putWalletRuntimeState(questionKey(key), question);
  }
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(questionKey(key), JSON.stringify(question), "PX", QUESTION_TTL_MS);
      return question;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) assertRedisAvailable("askSummonerQuestion");
  }
  memQuestions.set(key, question);
  return question;
}

/** Get the current pending question (if any). Returns null if expired or none. */
export async function getSummonerQuestion(userWallet: string): Promise<PendingQuestion | null> {
  const key = userWallet.toLowerCase();
  if (isPostgresConfigured()) {
    const q = await getWalletRuntimeState<PendingQuestion>(questionKey(key));
    if (q) {
      if (Date.now() > q.expiresAt && !q.reply) return null;
      return q;
    }
  }
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
    if (!isPostgresConfigured()) assertRedisAvailable("getSummonerQuestion");
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
  if (isPostgresConfigured()) {
    await putWalletRuntimeState(questionKey(key), existing);
  }

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
    if (!isPostgresConfigured()) assertRedisAvailable("replySummonerQuestion");
  }
  memQuestions.set(key, existing);
  return existing;
}

/** Clear the pending question after the agent has processed the reply. */
export async function clearSummonerQuestion(userWallet: string): Promise<void> {
  const key = userWallet.toLowerCase();
  if (isPostgresConfigured()) {
    await putWalletRuntimeState(questionKey(key), null);
  }
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
    if (!isPostgresConfigured()) assertRedisAvailable("clearSummonerQuestion");
  }
  memQuestions.delete(key);
}

// ── Objectives ─────────────────────────────────────────────────────────────

let objectiveIdCounter = 0;

export function createObjectiveId(): string {
  return `obj-${Date.now()}-${++objectiveIdCounter}`;
}

/** Get the ordered objective list for an agent. */
export async function getObjectives(userWallet: string): Promise<AgentObjective[]> {
  const config = await getAgentConfig(userWallet);
  return config?.objectives ?? [];
}

/** Add a new objective at the end (or at a specific index). */
export async function addObjective(
  userWallet: string,
  objective: AgentObjective,
  index?: number,
): Promise<AgentObjective[]> {
  const config = (await getAgentConfig(userWallet)) ?? defaultConfig();
  const objectives = config.objectives ?? [];
  if (index != null && index >= 0 && index <= objectives.length) {
    objectives.splice(index, 0, objective);
  } else {
    objectives.push(objective);
  }
  await patchAgentConfig(userWallet, { objectives });
  return objectives;
}

/** Remove an objective by ID. */
export async function removeObjective(
  userWallet: string,
  objectiveId: string,
): Promise<AgentObjective[]> {
  const config = (await getAgentConfig(userWallet)) ?? defaultConfig();
  const objectives = (config.objectives ?? []).filter((o) => o.id !== objectiveId);
  await patchAgentConfig(userWallet, { objectives });
  return objectives;
}

/** Mark an objective as completed and advance to the next one. */
export async function completeObjective(
  userWallet: string,
  objectiveId: string,
): Promise<AgentObjective[]> {
  const config = (await getAgentConfig(userWallet)) ?? defaultConfig();
  const objectives = config.objectives ?? [];
  const obj = objectives.find((o) => o.id === objectiveId);
  if (obj) {
    obj.status = "completed";
    obj.completedAt = Date.now();
  }
  await patchAgentConfig(userWallet, { objectives });
  return objectives;
}

/** Update progress on the active objective. */
export async function updateObjectiveProgress(
  userWallet: string,
  objectiveId: string,
  progress: number,
): Promise<void> {
  const config = (await getAgentConfig(userWallet)) ?? defaultConfig();
  const obj = (config.objectives ?? []).find((o) => o.id === objectiveId);
  if (obj) {
    obj.progress = progress;
    await patchAgentConfig(userWallet, { objectives: config.objectives });
  }
}

/** Reorder objectives (move an objective to a new index). */
export async function reorderObjective(
  userWallet: string,
  objectiveId: string,
  newIndex: number,
): Promise<AgentObjective[]> {
  const config = (await getAgentConfig(userWallet)) ?? defaultConfig();
  const objectives = config.objectives ?? [];
  const idx = objectives.findIndex((o) => o.id === objectiveId);
  if (idx < 0) return objectives;
  const [removed] = objectives.splice(idx, 1);
  objectives.splice(Math.max(0, Math.min(newIndex, objectives.length)), 0, removed);
  await patchAgentConfig(userWallet, { objectives });
  return objectives;
}

/** Clear all completed objectives. */
export async function clearCompletedObjectives(userWallet: string): Promise<AgentObjective[]> {
  const config = (await getAgentConfig(userWallet)) ?? defaultConfig();
  const objectives = (config.objectives ?? []).filter((o) => o.status !== "completed");
  await patchAgentConfig(userWallet, { objectives });
  return objectives;
}

/** Get the first non-completed objective (the one the agent should work on). */
export function getActiveObjective(objectives: AgentObjective[]): AgentObjective | null {
  return objectives.find((o) => o.status === "pending" || o.status === "active") ?? null;
}

export async function listEnabledAgentWallets(): Promise<string[]> {
  if (!isPostgresConfigured()) return [];
  const rows = await listWalletRuntimeStatesByPrefix<AgentConfig>("agent:config:");
  return rows
    .filter((row) => row.payload?.enabled)
    .map((row) => row.key.replace(/^agent:config:/, "").toLowerCase());
}

/** Derive the focus + targetZone an objective implies. */
export function objectiveToFocus(obj: AgentObjective): { focus: AgentFocus; targetZone?: string; strategy?: AgentStrategy } {
  switch (obj.type) {
    case "reach_level":
      return { focus: "combat", strategy: "balanced" };
    case "travel_to":
      return { focus: "traveling", targetZone: obj.params.zoneId as string };
    case "gather":
      return { focus: "gathering" };
    case "craft":
      return { focus: "crafting" };
    case "earn_gold":
      return { focus: "combat", strategy: "aggressive" };
    case "complete_quest":
      return { focus: "questing" };
    case "learn_profession":
      return { focus: "learning" };
    case "learn_technique":
      return { focus: "learning" };
    case "buy_item":
      return { focus: "shopping" };
    case "custom":
      return { focus: (obj.params.focus as AgentFocus) ?? "questing" };
    default:
      return { focus: "questing" };
  }
}
