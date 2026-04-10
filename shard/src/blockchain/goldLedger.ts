import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { getRedis } from "../redis.js";
import { getGoldReservations, setGoldReservation } from "../db/runtimeMetaStore.js";
import { isPostgresConfigured } from "../db/postgres.js";
import { addGoldSpend, getGoldSpendTotals, setGoldReservationAmount, subtractGoldSpend } from "../db/goldAccountStore.js";

const LEDGER_PATH = path.resolve(process.cwd(), "data", "gold-spent.json");
const REDIS_RESERVED_KEY = "gold:reserved";

type GoldLedgerState = Record<string, number>;

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function roundGold(amount: number): number {
  return Math.round(amount * 1_000_000) / 1_000_000;
}

function loadLedger(): GoldLedgerState {
  try {
    const raw = readFileSync(LEDGER_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: GoldLedgerState = {};

    for (const [address, value] of Object.entries(parsed)) {
      const amount = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(amount) || amount < 0) continue;
      next[normalizeAddress(address)] = roundGold(amount);
    }

    return next;
  } catch {
    return {};
  }
}

let spentByWallet = loadLedger();
let reservedByWallet: Record<string, number> = {};
let spentHydrated = false;
let spentHydrationPromise: Promise<void> | null = null;
let reservationsHydrated = false;
let reservationsHydrationPromise: Promise<void> | null = null;

function persistLedger(): void {
  try {
    mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
    writeFileSync(LEDGER_PATH, JSON.stringify(spentByWallet, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to persist gold ledger:", error);
  }
}

/** Persist all reservations to Redis (fire-and-forget, non-blocking) */
function persistReservations(): void {
  if (isPostgresConfigured()) {
    for (const [wallet, amount] of Object.entries(reservedByWallet)) {
      void setGoldReservation(wallet, amount).catch(() => {});
    }
  }
  const redis = getRedis();
  if (!redis) return;
  try {
    const data = JSON.stringify(reservedByWallet);
    redis.set(REDIS_RESERVED_KEY, data).catch(() => {});
  } catch {}
}

/** Restore reservations from Redis on startup */
export async function restoreReservations(): Promise<void> {
  if (isPostgresConfigured()) {
    try {
      reservedByWallet = await getGoldReservations();
      reservationsHydrated = true;
      if (Object.keys(reservedByWallet).length > 0) {
        console.log(`[goldLedger] Restored ${Object.keys(reservedByWallet).length} gold reservations from Postgres`);
        return;
      }
    } catch {
      // Fall through to Redis/file-free bootstrap path.
    }
  }
  const redis = getRedis();
  if (!redis) return;
  try {
    const raw = await redis.get(REDIS_RESERVED_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [address, value] of Object.entries(parsed)) {
        const amount = typeof value === "number" ? value : Number(value);
        if (Number.isFinite(amount) && amount > 0) {
          reservedByWallet[normalizeAddress(address)] = roundGold(amount);
        }
      }
      reservationsHydrated = true;
      console.log(`[goldLedger] Restored ${Object.keys(reservedByWallet).length} gold reservations from Redis`);
    }
  } catch {
    // Redis unavailable — start with empty reservations
  }
}

export async function ensureReservationsHydrated(): Promise<void> {
  if (reservationsHydrated) return;
  if (reservationsHydrationPromise) return await reservationsHydrationPromise;
  reservationsHydrationPromise = restoreReservations().finally(() => {
    reservationsHydrated = true;
    reservationsHydrationPromise = null;
  });
  await reservationsHydrationPromise;
}

export async function ensureSpentHydrated(): Promise<void> {
  if (spentHydrated) return;
  if (spentHydrationPromise) return await spentHydrationPromise;
  spentHydrationPromise = (async () => {
    if (isPostgresConfigured()) {
      try {
        spentByWallet = await getGoldSpendTotals();
      } catch {
        // Fall back to file-backed ledger already loaded into memory.
      }
    }
    spentHydrated = true;
  })().finally(() => {
    spentHydrationPromise = null;
  });
  await spentHydrationPromise;
}

export function formatGold(amount: number): string {
  const rounded = roundGold(Math.max(0, amount));
  if (Number.isInteger(rounded)) return rounded.toString();
  return rounded.toFixed(6).replace(/\.?0+$/, "");
}

export function getSpentGold(address: string): number {
  return spentByWallet[normalizeAddress(address)] ?? 0;
}

export async function getSpentGoldAsync(address: string): Promise<number> {
  await ensureSpentHydrated();
  return getSpentGold(address);
}

export function getAvailableGold(address: string, onChainGold: number): number {
  const spent = getSpentGold(address);
  const reserved = reservedByWallet[normalizeAddress(address)] ?? 0;
  return Math.max(0, onChainGold - spent - reserved);
}

export async function getAvailableGoldAsync(address: string, onChainGold: number): Promise<number> {
  await ensureSpentHydrated();
  await ensureReservationsHydrated();
  return getAvailableGold(address, onChainGold);
}

export function recordGoldSpend(address: string, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;

  const normalized = normalizeAddress(address);
  const current = spentByWallet[normalized] ?? 0;
  spentByWallet[normalized] = roundGold(current + amount);
  persistLedger();
}

export async function recordGoldSpendAsync(
  address: string,
  amount: number,
  client?: PoolClient | null
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  await ensureSpentHydrated();
  const normalized = normalizeAddress(address);
  const roundedAmount = roundGold(amount);
  if (isPostgresConfigured()) {
    const next = await addGoldSpend(normalized, roundedAmount, client);
    spentByWallet[normalized] = roundGold(next);
    return;
  }
  recordGoldSpend(normalized, roundedAmount);
}

export async function revertGoldSpendAsync(
  address: string,
  amount: number,
  client?: PoolClient | null
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  await ensureSpentHydrated();
  const normalized = normalizeAddress(address);
  const roundedAmount = roundGold(amount);
  if (isPostgresConfigured()) {
    const next = await subtractGoldSpend(normalized, roundedAmount, client);
    if (next > 0) {
      spentByWallet[normalized] = roundGold(next);
    } else {
      delete spentByWallet[normalized];
    }
    return;
  }
  const current = spentByWallet[normalized] ?? 0;
  const next = Math.max(0, roundGold(current - roundedAmount));
  if (next > 0) {
    spentByWallet[normalized] = next;
  } else {
    delete spentByWallet[normalized];
  }
  persistLedger();
}

/**
 * Reserve gold for pending transactions (auctions, trades).
 * Reduces available gold without recording a spend.
 */
export function reserveGold(address: string, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;

  const normalized = normalizeAddress(address);
  const current = reservedByWallet[normalized] ?? 0;
  reservedByWallet[normalized] = roundGold(current + amount);
  if (isPostgresConfigured()) {
    void setGoldReservation(normalized, reservedByWallet[normalized]).catch(() => {});
  }
  persistReservations();
}

export async function reserveGoldAsync(
  address: string,
  amount: number,
  client?: PoolClient | null
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  await ensureReservationsHydrated();
  const normalized = normalizeAddress(address);
  const current = reservedByWallet[normalized] ?? 0;
  const next = roundGold(current + amount);
  reservedByWallet[normalized] = next;
  if (isPostgresConfigured()) {
    await setGoldReservationAmount(normalized, next, client);
  } else {
    persistReservations();
  }
}

/**
 * Unreserve gold when a transaction is cancelled or outbid.
 */
export function unreserveGold(address: string, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;

  const normalized = normalizeAddress(address);
  const current = reservedByWallet[normalized] ?? 0;
  const next = Math.max(0, roundGold(current - amount));
  if (next > 0) {
    reservedByWallet[normalized] = next;
  } else {
    delete reservedByWallet[normalized];
  }
  if (isPostgresConfigured()) {
    void setGoldReservation(normalized, next).catch(() => {});
  }
  persistReservations();
}

export async function unreserveGoldAsync(
  address: string,
  amount: number,
  client?: PoolClient | null
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  await ensureReservationsHydrated();
  const normalized = normalizeAddress(address);
  const current = reservedByWallet[normalized] ?? 0;
  const next = Math.max(0, roundGold(current - amount));
  if (next > 0) {
    reservedByWallet[normalized] = next;
  } else {
    delete reservedByWallet[normalized];
  }
  if (isPostgresConfigured()) {
    await setGoldReservationAmount(normalized, next, client);
  } else {
    persistReservations();
  }
}

/**
 * Get the total reserved gold for an address.
 */
export function getReservedGold(address: string): number {
  return reservedByWallet[normalizeAddress(address)] ?? 0;
}

export async function getReservedGoldAsync(address: string): Promise<number> {
  await ensureReservationsHydrated();
  return getReservedGold(address);
}
