// Session budget — Redis-backed USDC credit tracker for agent compute costs.
// First deploy grants $0.05 free. Users top up via EIP-3009 signed authorizations
// settled in batch through Circle Gateway.

import { getRedis } from "../redis.js";

export type ActionType = "combat" | "gather" | "supervisor" | "chat" | "banter" | "idle";

export const ACTION_COSTS_USDC: Record<ActionType, number> = {
  combat:     0.000001,
  gather:     0.000001,
  supervisor: 0.0001,
  chat:       0.001,
  banter:     0.00001,   // deterministic templated banter — no LLM, 100x cheaper than chat
  idle:       0,
};

export const FREE_STARTER_USDC = 0.05;
const LOW_BALANCE_RATIO = 0.2;

const budgetKey    = (w: string) => `agent:nanopay:budget:${w}`;
const spentKey     = (w: string) => `agent:nanopay:spent:${w}`;
const authKey      = (w: string) => `agent:nanopay:auth:${w}`;
const freeKey      = (w: string) => `agent:nanopay:free:${w}`;
const breakdownKey = (w: string) => `agent:nanopay:breakdown:${w}`;
const topupsKey    = (w: string) => `agent:nanopay:topups:${w}`;
const PENDING_SET = "agent:nanopay:pending_settle";
const TOPUPS_MAX = 20;

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

// Called when an on-chain USDC deposit is detected on an agent's wallet.
// Skips the Circle PENDING_SET (deposit is already settled on-chain).
//
// The receiving address `wallet` is normally the agent's custodial wallet —
// but the compute-budget ledger and `/nanopay/status` endpoint are keyed on
// the OWNER wallet (the human's signed-in wallet). Resolve owner from the
// custodial address before crediting so the wallet panel actually reflects
// the top-up.
export async function creditOnChainDeposit(wallet: string, budgetUsdc: number): Promise<void> {
  const redis = getRedis();
  let key = wallet.toLowerCase();
  try {
    const { isPostgresConfigured } = await import("../db/postgres.js");
    if (isPostgresConfigured()) {
      const { getOwnerByCustodialWallet } = await import("../character/characterProjectionStore.js");
      const owner = await getOwnerByCustodialWallet(key);
      if (owner) key = owner.toLowerCase();
    }
  } catch { /* no owner mapping — credit the receiving address directly */ }

  const remaining = await getRemainingBalance(redis, key);
  await redis.set(budgetKey(key), (remaining + budgetUsdc).toFixed(8));
  await redis.set(spentKey(key), "0");
  await redis.del(breakdownKey(key));
  try {
    await redis.lpush(topupsKey(key), JSON.stringify({ ts: Date.now(), amount: budgetUsdc }));
    await redis.ltrim(topupsKey(key), 0, TOPUPS_MAX - 1);
  } catch { /* non-fatal */ }
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
  // Reset per-budget breakdown so it reflects current session only
  await redis.del(breakdownKey(wallet));
  // Append to top-up log (these are the meaningful individual events)
  try {
    await redis.lpush(topupsKey(wallet), JSON.stringify({ ts: Date.now(), amount: budgetUsdc }));
    await redis.ltrim(topupsKey(wallet), 0, TOPUPS_MAX - 1);
  } catch { /* non-fatal */ }
}

export interface TopUpEntry {
  ts: number;
  amount: number;
}

export async function getSpendBreakdown(wallet: string): Promise<{
  breakdown: Record<string, number>;
  topups: TopUpEntry[];
}> {
  try {
    const redis = getRedis();
    const [rawBreakdown, rawTopups] = await Promise.all([
      redis.hgetall(breakdownKey(wallet)),
      redis.lrange(topupsKey(wallet), 0, TOPUPS_MAX - 1),
    ]);
    const breakdown: Record<string, number> = {};
    for (const [k, v] of Object.entries(rawBreakdown)) {
      breakdown[k] = parseFloat(v as string);
    }
    const topups = rawTopups.map((s: string) => JSON.parse(s) as TopUpEntry);
    return { breakdown, topups };
  } catch {
    return { breakdown: {}, topups: [] };
  }
}

// Deducts cost for one action. Returns ok=false when budget is exhausted.
export async function deductCost(
  wallet: string,
  action: ActionType,
): Promise<{ ok: boolean; remaining: number; lowBalance: boolean }> {
  const cost = ACTION_COSTS_USDC[action];
  if (cost === 0) {
    try {
      const redis = getRedis();
      const remaining = await getRemainingBalance(redis, wallet);
      return { ok: true, remaining, lowBalance: false };
    } catch {
      return { ok: true, remaining: 0, lowBalance: false };
    }
  }

  try {
    const redis = getRedis();
    const budget    = parseFloat((await redis.get(budgetKey(wallet))) ?? "0");
    const spent     = parseFloat((await redis.get(spentKey(wallet)))  ?? "0");
    const remaining = budget - spent;

    if (remaining <= 0) return { ok: false, remaining: 0, lowBalance: true };

    const newSpent    = spent + cost;
    const newRemaining = budget - newSpent;
    await redis.set(spentKey(wallet), newSpent.toFixed(8));
    void redis.hincrbyfloat(breakdownKey(wallet), action, cost).catch(() => {});
    const lowBalance = budget > 0 && newRemaining / budget <= LOW_BALANCE_RATIO;
    return { ok: true, remaining: newRemaining, lowBalance };
  } catch (err: any) {
    // Redis down — fail open so the agent keeps running
    console.warn("[sessionBudget] deductCost error:", err.message);
    return { ok: true, remaining: 0, lowBalance: false };
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
