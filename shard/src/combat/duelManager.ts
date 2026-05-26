import { randomUUID } from "crypto";
import type { PvPFormat } from "../types/pvp.js";

/**
 * In-memory duel-challenge store. Duels are short-lived (default 5 min) so
 * we don't bother with Postgres — losing the table on restart just expires
 * any open challenges, which is the right behavior.
 */
export interface DuelChallenge {
  challengeId: string;
  challengerWallet: string;          // lowercased
  challengerEntityId: string;
  challengerName: string;
  targetWallet: string;              // lowercased
  format: PvPFormat;
  status: "pending" | "accepted" | "declined" | "expired" | "matched";
  createdAtMs: number;
  expiresAtMs: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

const challenges = new Map<string, DuelChallenge>();

export function createDuelChallenge(params: {
  challengerWallet: string;
  challengerEntityId: string;
  challengerName: string;
  targetWallet: string;
  format: PvPFormat;
  ttlMs?: number;
}): DuelChallenge {
  const now = Date.now();
  const challenge: DuelChallenge = {
    challengeId: `duel-${randomUUID()}`,
    challengerWallet: params.challengerWallet.toLowerCase(),
    challengerEntityId: params.challengerEntityId,
    challengerName: params.challengerName,
    targetWallet: params.targetWallet.toLowerCase(),
    format: params.format,
    status: "pending",
    createdAtMs: now,
    expiresAtMs: now + (params.ttlMs ?? DEFAULT_TTL_MS),
  };
  challenges.set(challenge.challengeId, challenge);
  return challenge;
}

export function getDuelChallenge(challengeId: string): DuelChallenge | null {
  return challenges.get(challengeId) ?? null;
}

export function setDuelChallengeStatus(challengeId: string, status: DuelChallenge["status"]): DuelChallenge | null {
  const challenge = challenges.get(challengeId);
  if (!challenge) return null;
  challenge.status = status;
  return challenge;
}

/** Returns all challenges in a terminal state OR past expiry. */
export function reapStaleDuelChallenges(now: number = Date.now()): DuelChallenge[] {
  const stale: DuelChallenge[] = [];
  for (const [id, challenge] of challenges) {
    if (challenge.status === "pending" && challenge.expiresAtMs <= now) {
      challenge.status = "expired";
      stale.push(challenge);
      // Keep the record briefly for inbox lookups; full purge below.
    }
    // Hard purge anything closed for more than an hour to avoid map bloat.
    if (challenge.status !== "pending" && challenge.expiresAtMs + 60 * 60 * 1000 < now) {
      challenges.delete(id);
    }
  }
  return stale;
}

/** Active challenges where `targetWallet` matches — for inbox display. */
export function listIncomingDuels(wallet: string): DuelChallenge[] {
  const target = wallet.toLowerCase();
  return Array.from(challenges.values()).filter(
    (c) => c.targetWallet === target && c.status === "pending" && c.expiresAtMs > Date.now(),
  );
}

/** Active challenges from this wallet. */
export function listOutgoingDuels(wallet: string): DuelChallenge[] {
  const w = wallet.toLowerCase();
  return Array.from(challenges.values()).filter(
    (c) => c.challengerWallet === w && c.status === "pending" && c.expiresAtMs > Date.now(),
  );
}
