/**
 * Agent Config Store — Redis CRUD for AI agent configurations
 * Keys:
 *   agent:config:{userWallet}  → JSON AgentConfig
 *   agent:wallet:{userWallet}  → custodialWalletAddress
 *   agent:entity:{userWallet}  → JSON { entityId, zoneId }
 */

import { getRedis } from "./redis.js";

export type AgentFocus =
  | "questing"
  | "combat"
  | "enchanting"
  | "crafting"
  | "gathering"
  | "alchemy"
  | "cooking"
  | "trading"
  | "idle";

export type AgentStrategy = "aggressive" | "balanced" | "defensive";

export interface ChatMessage {
  role: "user" | "agent";
  text: string;
  ts: number;
}

export interface AgentConfig {
  enabled: boolean;
  focus: AgentFocus;
  strategy: AgentStrategy;
  targetZone?: string;
  lastUpdated: number;
  chatHistory: ChatMessage[];
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
    chatHistory: [],
  };
}

// ── Config ──────────────────────────────────────────────────────────────────

export async function getAgentConfig(userWallet: string): Promise<AgentConfig | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(walletKey(userWallet));
      if (raw) return JSON.parse(raw) as AgentConfig;
    } catch {}
  }
  return memConfig.get(userWallet.toLowerCase()) ?? null;
}

export async function setAgentConfig(userWallet: string, config: AgentConfig): Promise<void> {
  const key = userWallet.toLowerCase();
  memConfig.set(key, config);
  const redis = getRedis();
  if (redis) {
    try { await redis.set(walletKey(key), JSON.stringify(config)); } catch {}
  }
}

export async function patchAgentConfig(
  userWallet: string,
  patch: Partial<Omit<AgentConfig, "chatHistory">>
): Promise<AgentConfig> {
  const existing = (await getAgentConfig(userWallet)) ?? defaultConfig();
  const updated: AgentConfig = { ...existing, ...patch, lastUpdated: Date.now() };
  await setAgentConfig(userWallet, updated);
  return updated;
}

export async function appendChatMessage(
  userWallet: string,
  msg: ChatMessage,
  maxHistory = 50
): Promise<void> {
  const config = (await getAgentConfig(userWallet)) ?? defaultConfig();
  config.chatHistory = [...config.chatHistory, msg].slice(-maxHistory);
  config.lastUpdated = Date.now();
  await setAgentConfig(userWallet, config);
}

// ── Custodial wallet mapping ─────────────────────────────────────────────────

export async function getAgentCustodialWallet(userWallet: string): Promise<string | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const addr = await redis.get(custWalletKey(userWallet));
      if (addr) return addr;
    } catch {}
  }
  return memWallet.get(userWallet.toLowerCase()) ?? null;
}

export async function setAgentCustodialWallet(userWallet: string, custodialAddress: string): Promise<void> {
  const key = userWallet.toLowerCase();
  memWallet.set(key, custodialAddress.toLowerCase());
  const redis = getRedis();
  if (redis) {
    try { await redis.set(custWalletKey(key), custodialAddress.toLowerCase()); } catch {}
  }
}

// ── Entity ref ───────────────────────────────────────────────────────────────

export async function getAgentEntityRef(userWallet: string): Promise<AgentEntityRef | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(entityKey(userWallet));
      if (raw) return JSON.parse(raw) as AgentEntityRef;
    } catch {}
  }
  return memEntity.get(userWallet.toLowerCase()) ?? null;
}

export async function setAgentEntityRef(userWallet: string, ref: AgentEntityRef): Promise<void> {
  const key = userWallet.toLowerCase();
  memEntity.set(key, ref);
  const redis = getRedis();
  if (redis) {
    try { await redis.set(entityKey(key), JSON.stringify(ref)); } catch {}
  }
}
