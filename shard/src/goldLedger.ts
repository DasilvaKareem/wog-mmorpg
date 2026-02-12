import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const LEDGER_PATH = path.resolve(process.cwd(), "data", "gold-spent.json");

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

function persistLedger(): void {
  try {
    mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
    writeFileSync(LEDGER_PATH, JSON.stringify(spentByWallet, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to persist gold ledger:", error);
  }
}

export function formatGold(amount: number): string {
  const rounded = roundGold(Math.max(0, amount));
  if (Number.isInteger(rounded)) return rounded.toString();
  return rounded.toFixed(6).replace(/\.?0+$/, "");
}

export function getSpentGold(address: string): number {
  return spentByWallet[normalizeAddress(address)] ?? 0;
}

export function getAvailableGold(address: string, onChainGold: number): number {
  const spent = getSpentGold(address);
  const reserved = reservedByWallet[normalizeAddress(address)] ?? 0;
  return Math.max(0, onChainGold - spent - reserved);
}

export function recordGoldSpend(address: string, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;

  const normalized = normalizeAddress(address);
  const current = spentByWallet[normalized] ?? 0;
  spentByWallet[normalized] = roundGold(current + amount);
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
}

/**
 * Unreserve gold when a transaction is cancelled or outbid.
 */
export function unreserveGold(address: string, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;

  const normalized = normalizeAddress(address);
  const current = reservedByWallet[normalized] ?? 0;
  reservedByWallet[normalized] = Math.max(0, roundGold(current - amount));
}

/**
 * Get the total reserved gold for an address.
 */
export function getReservedGold(address: string): number {
  return reservedByWallet[normalizeAddress(address)] ?? 0;
}
