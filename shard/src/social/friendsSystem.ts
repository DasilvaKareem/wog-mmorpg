/**
 * Persistent Friends System
 *
 * Bidirectional friends with Redis-backed persistence.
 * Storage: dual-write (in-memory Map + Redis), same pattern as diary.ts.
 * Friend requests are in-memory only with 24h TTL (like party invites).
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { authenticateRequest } from "../auth/auth.js";
import { getAgentCustodialWallet } from "../agents/agentConfigStore.js";
import { getRedis } from "../redis.js";
import { getAllEntities } from "../world/zoneRuntime.js";
import { reputationManager } from "../economy/reputationManager.js";
import { reverseLookupOnChain, resolveNameOnChain } from "../blockchain/nameServiceChain.js";
import { resolvePreferredAgentIdForWallet } from "../erc8004/agentResolution.js";
import { isPostgresConfigured } from "../db/postgres.js";
import {
  listFreshFriendRequests,
  listFriends,
  replaceFriendRequests,
  replaceFriends,
} from "../db/friendsStore.js";

// ── Types ──────────────────────────────────────────────────────────

interface Friend {
  wallet: string;
  addedAt: number;
}

interface FriendRequest {
  id: string;
  fromWallet: string;
  fromName: string;
  toWallet: string;
  createdAt: number;
}

// ── Constants ──────────────────────────────────────────────────────

const MAX_FRIENDS = 50;
const REDIS_KEY_PREFIX = "friends:";
const REDIS_REQUEST_KEY_PREFIX = "friends:req:";
const REQUEST_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── In-memory stores ───────────────────────────────────────────────

const friendsStore = new Map<string, Friend[]>(); // wallet → friends
const requestStore = new Map<string, FriendRequest[]>(); // toWallet → pending requests

// ── Helpers ────────────────────────────────────────────────────────

function norm(wallet: string): string {
  return wallet.toLowerCase();
}

function getFriends(wallet: string): Friend[] {
  return friendsStore.get(norm(wallet)) ?? [];
}

async function controlsWallet(authenticatedWallet: string, targetWallet: string | undefined): Promise<boolean> {
  if (!targetWallet) return false;
  const authLower = norm(authenticatedWallet);
  const targetLower = norm(targetWallet);
  if (authLower === targetLower) return true;
  const custodialWallet = await getAgentCustodialWallet(authenticatedWallet);
  return custodialWallet?.toLowerCase() === targetLower;
}

export async function areFriends(walletA: string, walletB: string): Promise<boolean> {
  const a = norm(walletA);
  const b = norm(walletB);
  await ensureLoaded(a);
  return getFriends(a).some((f) => f.wallet === b);
}

async function persistRequests(wallet: string, requests: FriendRequest[]): Promise<void> {
  const key = norm(wallet);
  requestStore.set(key, requests);
  if (isPostgresConfigured()) {
    await replaceFriendRequests(key, requests, REQUEST_TTL_MS);
  }
  const redis = getRedis();
  if (redis) {
    await redis.set(`${REDIS_REQUEST_KEY_PREFIX}${key}`, JSON.stringify(requests));
  }
}

async function freshRequests(wallet: string): Promise<FriendRequest[]> {
  const key = norm(wallet);
  if (isPostgresConfigured()) {
    const persisted = await listFreshFriendRequests(key, Date.now());
    requestStore.set(key, persisted);
    return persisted;
  }

  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(`${REDIS_REQUEST_KEY_PREFIX}${key}`);
      if (raw) {
        const parsed = JSON.parse(raw) as FriendRequest[];
        requestStore.set(key, parsed);
      }
    } catch {
      // fall back to in-memory cache
    }
  }

  const now = Date.now();
  const list = (requestStore.get(key) ?? []).filter(
    (r) => now - r.createdAt < REQUEST_TTL_MS,
  );
  await persistRequests(key, list);
  return list;
}

/** Persist friends list to durable storage and cache. */
async function persistFriends(wallet: string): Promise<void> {
  const key = norm(wallet);
  const friends = friendsStore.get(key) ?? [];
  if (isPostgresConfigured()) {
    await replaceFriends(key, friends);
  }
  const redis = getRedis();
  if (redis) {
    await redis.set(`${REDIS_KEY_PREFIX}${key}`, JSON.stringify(friends)).catch((err: unknown) =>
      console.error(`[friends] Redis write failed for ${key}:`, err),
    );
  }
}

/** Add friend to both sides + persist. */
async function addMutualFriend(walletA: string, walletB: string): Promise<void> {
  const now = Date.now();
  const a = norm(walletA);
  const b = norm(walletB);

  for (const [self, other] of [[a, b], [b, a]] as [string, string][]) {
    let list = friendsStore.get(self);
    if (!list) {
      list = [];
      friendsStore.set(self, list);
    }
    if (!list.some((f) => f.wallet === other)) {
      list.push({ wallet: other, addedAt: now });
    }
    await persistFriends(self);
  }
}

/** Remove friend from both sides + persist. */
async function removeMutualFriend(walletA: string, walletB: string): Promise<void> {
  const a = norm(walletA);
  const b = norm(walletB);

  for (const [self, other] of [[a, b], [b, a]] as [string, string][]) {
    const list = friendsStore.get(self);
    if (list) {
      friendsStore.set(
        self,
        list.filter((f) => f.wallet !== other),
      );
      await persistFriends(self);
    }
  }
}

/** Restore friends from Redis on first access. */
async function ensureLoaded(wallet: string): Promise<void> {
  const key = norm(wallet);
  if (friendsStore.has(key)) return;

  if (isPostgresConfigured()) {
    const persisted = await listFriends(key);
    if (persisted.length > 0) {
      friendsStore.set(key, persisted);
      return;
    }
  }

  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(`${REDIS_KEY_PREFIX}${key}`);
      if (raw) {
        const parsed = JSON.parse(raw) as Friend[];
        friendsStore.set(key, parsed);
        return;
      }
    } catch {
      // fall through to empty list
    }
  }
  friendsStore.set(key, []);
}

/** Find player entity in the unified entity map by custodial wallet. */
function findOnlinePlayer(wallet: string): {
  entityId: string;
  zoneId: string;
  name: string;
  level: number;
  classId?: string;
  raceId?: string;
} | null {
  const lower = norm(wallet);
  for (const [eId, entity] of getAllEntities()) {
    const e = entity as any;
    if (e.type !== "player") continue;
    if (e.walletAddress?.toLowerCase() === lower) {
      return {
        entityId: eId,
        zoneId: e.region ?? "unknown",
        name: e.name,
        level: e.level ?? 1,
        classId: e.classId,
        raceId: e.raceId,
      };
    }
  }
  return null;
}

// ── Routes ─────────────────────────────────────────────────────────

export function registerFriendsRoutes(server: FastifyInstance): void {
  /**
   * GET /friends/:wallet
   * List friends with online status.
   */
  server.get<{ Params: { wallet: string } }>(
    "/friends/:wallet",
    async (req, reply) => {
      const wallet = norm(req.params.wallet);
      await ensureLoaded(wallet);
      const friends = getFriends(wallet);

      const result = await Promise.all(
        friends.map(async (f) => {
          const online = findOnlinePlayer(f.wallet);
          const friendAgentId = await resolvePreferredAgentIdForWallet(f.wallet);
          const rep = friendAgentId ? reputationManager.getReputation(friendAgentId) : null;
          const overall = rep?.overall ?? 500;
          // Resolve .wog name — gives offline friends an identity too
          const wogName = await reverseLookupOnChain(f.wallet).catch(() => null);
          return {
            wallet: f.wallet,
            addedAt: f.addedAt,
            online: online !== null,
            name: online?.name ?? null,
            wogName: wogName ? `${wogName}.wog` : null,
            level: online?.level ?? null,
            classId: online?.classId ?? null,
            raceId: online?.raceId ?? null,
            zoneId: online?.zoneId ?? null,
            reputation: overall,
            reputationRank: reputationManager.getReputationRank(overall),
          };
        }),
      );

      return reply.send({ friends: result, count: result.length });
    },
  );

  /**
   * POST /friends/request
   * Send a friend request. Body: { fromWallet, toWallet }
   */
  server.post<{
    Body: { fromWallet: string; toWallet: string };
  }>("/friends/request", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const authenticatedWallet = ((req as any).walletAddress as string).toLowerCase();
    const from = norm(req.body.fromWallet);
    const to = norm(req.body.toWallet);

    if (!(await controlsWallet(authenticatedWallet, from))) {
      return reply.code(403).send({ error: "Not authorized to send requests for this wallet" });
    }

    if (from === to) {
      return reply.code(400).send({ error: "Cannot friend yourself" });
    }

    // Check if already friends
    await ensureLoaded(from);
    const existing = getFriends(from);
    if (existing.some((f) => f.wallet === to)) {
      return reply.code(400).send({ error: "Already friends" });
    }

    // Check friend limit
    if (existing.length >= MAX_FRIENDS) {
      return reply.code(400).send({ error: `Friend limit reached (${MAX_FRIENDS})` });
    }

    // Resolve sender name for display (entity name > .wog name > truncated wallet)
    const fromPlayer = findOnlinePlayer(from);
    const fromWogName = !fromPlayer ? await reverseLookupOnChain(from).catch(() => null) : null;
    const fromName = fromPlayer?.name ?? (fromWogName ? `${fromWogName}.wog` : from.slice(0, 10));

    // Dedupe: remove existing request from same sender
    const pending = await freshRequests(to);
    const deduped = pending.filter((r) => r.fromWallet !== from);

    const request: FriendRequest = {
      id: randomUUID(),
      fromWallet: from,
      fromName,
      toWallet: to,
      createdAt: Date.now(),
    };
    await persistRequests(to, [...deduped, request]);

    return reply.send({ success: true, requestId: request.id });
  });

  /**
   * GET /friends/requests/:wallet
   * Pending incoming friend requests.
   */
  server.get<{ Params: { wallet: string } }>(
    "/friends/requests/:wallet",
    async (req, reply) => {
      const requests = await freshRequests(req.params.wallet);
      return reply.send({ requests });
    },
  );

  /**
   * POST /friends/accept
   * Accept a friend request. Body: { wallet, requestId }
   */
  server.post<{
    Body: { wallet: string; requestId: string };
  }>("/friends/accept", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const authenticatedWallet = ((req as any).walletAddress as string).toLowerCase();
    const wallet = norm(req.body.wallet);
    const { requestId } = req.body;

    if (!(await controlsWallet(authenticatedWallet, wallet))) {
      return reply.code(403).send({ error: "Not authorized to accept requests for this wallet" });
    }

    const requests = await freshRequests(wallet);
    const request = requests.find((r) => r.id === requestId);
    if (!request) {
      return reply.code(404).send({ error: "Request not found or expired" });
    }

    // Check limits on both sides
    await ensureLoaded(wallet);
    await ensureLoaded(request.fromWallet);

    if (getFriends(wallet).length >= MAX_FRIENDS) {
      return reply.code(400).send({ error: `Your friend limit reached (${MAX_FRIENDS})` });
    }
    if (getFriends(request.fromWallet).length >= MAX_FRIENDS) {
      return reply.code(400).send({ error: `Sender's friend limit reached (${MAX_FRIENDS})` });
    }

    // Mutual add
    await addMutualFriend(wallet, request.fromWallet);

    // Remove the accepted request
    await persistRequests(
      wallet,
      requests.filter((r) => r.id !== requestId),
    );

    return reply.send({ success: true });
  });

  /**
   * POST /friends/decline
   * Decline a friend request. Body: { wallet, requestId }
   */
  server.post<{
    Body: { wallet: string; requestId: string };
  }>("/friends/decline", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const authenticatedWallet = ((req as any).walletAddress as string).toLowerCase();
    const wallet = norm(req.body.wallet);
    const { requestId } = req.body;

    if (!(await controlsWallet(authenticatedWallet, wallet))) {
      return reply.code(403).send({ error: "Not authorized to decline requests for this wallet" });
    }

    const requests = await freshRequests(wallet);
    await persistRequests(
      wallet,
      requests.filter((r) => r.id !== requestId),
    );

    return reply.send({ success: true });
  });

  /**
   * POST /friends/remove
   * Remove a friend (both sides). Body: { wallet, targetWallet }
   */
  server.post<{
    Body: { wallet: string; targetWallet: string };
  }>("/friends/remove", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const authenticatedWallet = ((req as any).walletAddress as string).toLowerCase();
    const wallet = norm(req.body.wallet);
    const target = norm(req.body.targetWallet);

    if (!(await controlsWallet(authenticatedWallet, wallet))) {
      return reply.code(403).send({ error: "Not authorized to remove friends for this wallet" });
    }

    await ensureLoaded(wallet);
    await ensureLoaded(target);

    await removeMutualFriend(wallet, target);

    return reply.send({ success: true });
  });

  /**
   * POST /friends/request-by-name
   * Send a friend request using a .wog name. Body: { fromWallet, toName }
   * Resolves the .wog name to a wallet, then sends the request.
   */
  server.post<{
    Body: { fromWallet: string; toName: string };
  }>("/friends/request-by-name", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const authenticatedWallet = ((req as any).walletAddress as string).toLowerCase();
    const from = norm(req.body.fromWallet);
    const rawName = (req.body.toName ?? "").replace(/\.wog$/i, "").trim();

    if (!(await controlsWallet(authenticatedWallet, from))) {
      return reply.code(403).send({ error: "Not authorized to send requests for this wallet" });
    }

    if (!rawName) {
      return reply.code(400).send({ error: "Name is required" });
    }

    const resolved = await resolveNameOnChain(rawName);
    if (!resolved) {
      return reply.code(404).send({ error: `"${rawName}.wog" not found` });
    }

    const to = norm(resolved);

    if (from === to) {
      return reply.code(400).send({ error: "Cannot friend yourself" });
    }

    await ensureLoaded(from);
    const existing = getFriends(from);
    if (existing.some((f) => f.wallet === to)) {
      return reply.code(400).send({ error: "Already friends" });
    }
    if (existing.length >= MAX_FRIENDS) {
      return reply.code(400).send({ error: `Friend limit reached (${MAX_FRIENDS})` });
    }

    const fromPlayer = findOnlinePlayer(from);
    const fromWogName = !fromPlayer ? await reverseLookupOnChain(from).catch(() => null) : null;
    const fromName = fromPlayer?.name ?? (fromWogName ? `${fromWogName}.wog` : from.slice(0, 10));

    const pending = await freshRequests(to);
    const deduped = pending.filter((r) => r.fromWallet !== from);

    const request: FriendRequest = {
      id: randomUUID(),
      fromWallet: from,
      fromName,
      toWallet: to,
      createdAt: Date.now(),
    };
    await persistRequests(to, [...deduped, request]);

    return reply.send({ success: true, requestId: request.id, resolvedWallet: to });
  });
}
