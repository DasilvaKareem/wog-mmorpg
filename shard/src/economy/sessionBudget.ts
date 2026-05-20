// Session budget — Redis-backed USDC credit tracker for agent compute costs.
// First deploy grants $0.05 free. Users top up via EIP-3009 signed authorizations
// settled in batch through Circle Gateway.

import { getRedis } from "../redis.js";

export type ActionType = "combat" | "gather" | "supervisor" | "chat" | "idle";

export const ACTION_COSTS_USDC: Record<ActionType, number> = {
  combat:     0.000001,
  gather:     0.000001,
  supervisor: 0.0001,
  chat:       0.001,
  idle:       0,
};

export const FREE_STARTER_USDC = 0.05;
const LOW_BALANCE_RATIO = 0.2;

const budgetKey = (w: string) => `agent:nanopay:budget:${w}`;
const spentKey  = (w: string) => `agent:nanopay:spent:${w}`;
const authKey   = (w: string) => `agent:nanopay:auth:${w}`;
const freeKey   = (w: string) => `agent:nanopay:free:${w}`;
const PENDING_SET = "agent:nanopay:pending_settle";

// Called on first deploy — idempotent.
export async function grantFreeStarterCredit(wallet: string): Promise<void> {
  try {
    const redis = getRedis();
    const already = await redis.get(freeKey(wallet));
    if (already) return;
    await redis.set(budgetKey(wallet), FREE_STARTER_USDC.toFixed(8));
    await redis.setnx(spentKey(wallet), "0");
    await redis.set(freeKey(wallet), "1");
  } catch (err: any) {
    console.warn("[sessionBudget] grantFreeStarterCredit failed:", err.message);
  }
}

// Called when user submits a top-up EIP-3009 auth.
export async function initTopUp(wallet: string, signedAuth: string, budgetUsdc: number): Promise<void> {
  const redis = getRedis();
  const remaining = await getRemainingBalance(redis, wallet);
  await redis.set(budgetKey(wallet), (remaining + budgetUsdc).toFixed(8));
  await redis.set(spentKey(wallet), "0");
  await redis.set(
    authKey(wallet),
    JSON.stringify({ auth: signedAuth, budgetUsdc, createdAt: Date.now() }),
  );
  await redis.sadd(PENDING_SET, wallet);
}

// Deducts cost for one action. Returns ok=false when budget is exhausted.
export async function deductCost(
  wallet: string,
  action: ActionType,
): Promise<{ ok: boolean; remaining: number }> {
  const cost = ACTION_COSTS_USDC[action];
  if (cost === 0) {
    try {
      const redis = getRedis();
      return { ok: true, remaining: await getRemainingBalance(redis, wallet) };
    } catch {
      return { ok: true, remaining: 0 };
    }
  }

  try {
    const redis = getRedis();
    const budget = parseFloat((await redis.get(budgetKey(wallet))) ?? "0");
    const spent  = parseFloat((await redis.get(spentKey(wallet)))  ?? "0");
    const remaining = budget - spent;

    if (remaining <= 0) return { ok: false, remaining: 0 };

    const newSpent = spent + cost;
    await redis.set(spentKey(wallet), newSpent.toFixed(8));
    return { ok: true, remaining: budget - newSpent };
  } catch (err: any) {
    // Redis down — fail open so the agent keeps running
    console.warn("[sessionBudget] deductCost error:", err.message);
    return { ok: true, remaining: 0 };
  }
}

export interface SessionBalance {
  budget: number;
  spent: number;
  remaining: number;
  freeGranted: boolean;
  needsTopUp: boolean;
  lowBalance: boolean;
  hasAuth: boolean;
}

export async function getSessionBalance(wallet: string): Promise<SessionBalance> {
  try {
    const redis = getRedis();
    const budget      = parseFloat((await redis.get(budgetKey(wallet))) ?? "0");
    const spent       = parseFloat((await redis.get(spentKey(wallet)))  ?? "0");
    const remaining   = Math.max(0, budget - spent);
    const freeGranted = !!(await redis.get(freeKey(wallet)));
    const hasAuth     = !!(await redis.get(authKey(wallet)));

    return {
      budget,
      spent,
      remaining,
      freeGranted,
      needsTopUp: remaining <= 0,
      lowBalance: budget > 0 && remaining / budget <= LOW_BALANCE_RATIO,
      hasAuth,
    };
  } catch {
    return { budget: 0, spent: 0, remaining: 0, freeGranted: false, needsTopUp: true, lowBalance: false, hasAuth: false };
  }
}

export async function collectPendingAuthorizations(): Promise<
  Array<{ wallet: string; auth: string; budgetUsdc: number }>
> {
  try {
    const redis = getRedis();
    const wallets = await redis.smembers(PENDING_SET);
    const out: Array<{ wallet: string; auth: string; budgetUsdc: number }> = [];
    for (const wallet of wallets) {
      const raw = await redis.get(authKey(wallet));
      if (raw) {
        const parsed = JSON.parse(raw);
        out.push({ wallet, auth: parsed.auth, budgetUsdc: parsed.budgetUsdc });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function markSettled(wallets: string[]): Promise<void> {
  if (!wallets.length) return;
  try {
    const redis = getRedis();
    await redis.srem(PENDING_SET, ...wallets);
    await Promise.all(wallets.map((w) => redis.del(authKey(w))));
  } catch (err: any) {
    console.warn("[sessionBudget] markSettled failed:", err.message);
  }
}

async function getRemainingBalance(redis: ReturnType<typeof getRedis>, wallet: string): Promise<number> {
  const budget = parseFloat((await redis.get(budgetKey(wallet))) ?? "0");
  const spent  = parseFloat((await redis.get(spentKey(wallet)))  ?? "0");
  return Math.max(0, budget - spent);
}
