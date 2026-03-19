import type { FastifyInstance } from "fastify";
import { authenticateRequest } from "../auth/auth.js";
import { getAgentCustodialWallet } from "../agents/agentConfigStore.js";
import { getEntity, getAllEntities } from "../world/zoneRuntime.js";
import { getRedis } from "../redis.js";

interface Party {
  id: string;
  leaderId: string;
  memberIds: string[];
  zoneId: string;
  createdAt: number;
  shareXp: boolean;
  shareGold: boolean;
}

// ── In-memory party storage (entity-ID-based for fast tick lookups) ──────
const parties = new Map<string, Party>();
const playerToParty = new Map<string, string>(); // entityId -> partyId

// ── Redis persistence (wallet-based, survives restarts) ─────────────────
// Keys:
//   wog:party:{partyId}           → JSON { leaderWallet, memberWallets[], zoneId, createdAt, shareXp, shareGold }
//   wog:party:wallet:{wallet}     → partyId

interface PersistedParty {
  id: string;
  leaderWallet: string;
  memberWallets: string[];
  zoneId: string;
  createdAt: number;
  shareXp: boolean;
  shareGold: boolean;
}

const PARTY_KEY_PREFIX = "wog:party:";
const WALLET_PARTY_KEY_PREFIX = "wog:party:wallet:";

function partyKey(partyId: string): string { return `${PARTY_KEY_PREFIX}${partyId}`; }
function walletPartyKey(wallet: string): string { return `${WALLET_PARTY_KEY_PREFIX}${wallet.toLowerCase()}`; }

/** Persist party to Redis (fire-and-forget). */
function persistParty(party: Party): void {
  const redis = getRedis();
  if (!redis) return;

  // Resolve wallet addresses from entity IDs
  const memberWallets: string[] = [];
  let leaderWallet = "";
  for (const memberId of party.memberIds) {
    const entity = getEntity(memberId) as any;
    const wallet = entity?.walletAddress?.toLowerCase();
    if (wallet) {
      memberWallets.push(wallet);
      if (memberId === party.leaderId) leaderWallet = wallet;
    }
  }

  if (memberWallets.length === 0) return;
  if (!leaderWallet) leaderWallet = memberWallets[0];

  const persisted: PersistedParty = {
    id: party.id,
    leaderWallet,
    memberWallets,
    zoneId: party.zoneId,
    createdAt: party.createdAt,
    shareXp: party.shareXp,
    shareGold: party.shareGold,
  };

  redis.set(partyKey(party.id), JSON.stringify(persisted)).catch(() => {});
  for (const w of memberWallets) {
    redis.set(walletPartyKey(w), party.id).catch(() => {});
  }
}

/** Remove party from Redis. */
function unpersistParty(partyId: string, wallets: string[]): void {
  const redis = getRedis();
  if (!redis) return;

  redis.del(partyKey(partyId)).catch(() => {});
  for (const w of wallets) {
    redis.del(walletPartyKey(w)).catch(() => {});
  }
}

/** Remove a single wallet from Redis party mapping. */
function unpersistWallet(wallet: string): void {
  const redis = getRedis();
  if (!redis) return;
  redis.del(walletPartyKey(wallet.toLowerCase())).catch(() => {});
}

/**
 * Re-link a freshly spawned entity to its persisted party.
 * Called from spawn route after entity is added to the world.
 */
export async function rehydratePartyMembership(entityId: string, walletAddress: string): Promise<void> {
  // Already linked in-memory (shouldn't happen, but guard)
  if (playerToParty.has(entityId)) return;

  const redis = getRedis();
  if (!redis) return;

  const wallet = walletAddress.toLowerCase();

  try {
    const partyId = await redis.get(walletPartyKey(wallet));
    if (!partyId) return;

    const raw = await redis.get(partyKey(partyId));
    if (!raw) {
      // Stale wallet key — clean up
      redis.del(walletPartyKey(wallet)).catch(() => {});
      return;
    }

    const persisted: PersistedParty = JSON.parse(raw);

    // Get or create in-memory party
    let party = parties.get(partyId);
    if (!party) {
      // Reconstruct from persisted data — leader will be re-resolved below
      party = {
        id: partyId,
        leaderId: "", // resolved below
        memberIds: [],
        zoneId: persisted.zoneId,
        createdAt: persisted.createdAt,
        shareXp: persisted.shareXp,
        shareGold: persisted.shareGold,
      };
      parties.set(partyId, party);
    }

    // Add this entity if not already present
    if (!party.memberIds.includes(entityId)) {
      party.memberIds.push(entityId);
    }
    playerToParty.set(entityId, partyId);

    // Resolve leader
    if (wallet === persisted.leaderWallet) {
      party.leaderId = entityId;
    }
    // If leader hasn't spawned yet, assign first member as interim leader
    if (!party.leaderId && party.memberIds.length > 0) {
      party.leaderId = party.memberIds[0];
    }

    console.log(`[party] Rehydrated ${wallet.slice(0, 8)}… (entity ${entityId.slice(0, 8)}…) into party ${partyId}`);
  } catch (err) {
    console.error(`[party] Rehydration failed for ${wallet.slice(0, 8)}…:`, err);
  }
}

// ── Pending party invites (wallet-based, for Champions page UI) ───────────
interface PartyInvite {
  id: string;
  fromEntityId: string;
  fromName: string;
  fromCustodialWallet: string;
  toCustodialWallet: string;
  partyId: string;
  createdAt: number;
}
const INVITE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const pendingInvites = new Map<string, PartyInvite[]>(); // custodialWallet → invites

function freshInvites(wallet: string): PartyInvite[] {
  const now = Date.now();
  const list = (pendingInvites.get(wallet.toLowerCase()) ?? []).filter(
    (i) => now - i.createdAt < INVITE_TTL_MS,
  );
  pendingInvites.set(wallet.toLowerCase(), list);
  return list;
}

// Helper: find entity by custodial wallet in unified entity map
function findEntityByCustodialWallet(custodialWallet: string): { entityId: string; zoneId: string } | null {
  const lower = custodialWallet.toLowerCase();
  for (const [eId, entity] of getAllEntities()) {
    if ((entity as any).walletAddress?.toLowerCase() === lower) {
      return { entityId: eId, zoneId: (entity as any).region ?? "unknown" };
    }
  }
  return null;
}

/** Collect wallet addresses for all members of a party. */
function getPartyWallets(party: Party): string[] {
  const wallets: string[] = [];
  for (const memberId of party.memberIds) {
    const e = getEntity(memberId) as any;
    if (e?.walletAddress) wallets.push(e.walletAddress.toLowerCase());
  }
  return wallets;
}

export function registerPartyRoutes(server: FastifyInstance): void {
  async function controlsWallet(authenticatedWallet: string, targetWallet: string | undefined): Promise<boolean> {
    if (!targetWallet) return false;
    if (targetWallet.toLowerCase() === authenticatedWallet.toLowerCase()) return true;
    const custodialWallet = await getAgentCustodialWallet(authenticatedWallet);
    return custodialWallet?.toLowerCase() === targetWallet.toLowerCase();
  }

  // Create a party
  server.post<{
    Body: { zoneId: string; leaderId: string };
  }>("/party/create", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const authenticatedWallet = (req as any).walletAddress as string;
    const { zoneId, leaderId } = req.body;

    const leader = getEntity(leaderId);

    if (!leader) {
      return reply.status(404).send({ error: "Leader entity not found" });
    }

    if (leader.type !== "player") {
      return reply.status(400).send({ error: "Only players can create parties" });
    }

    if (!(await controlsWallet(authenticatedWallet, (leader as any).walletAddress))) {
      return reply.status(403).send({ error: "Not authorized to create a party for this player" });
    }

    // Check if already in a party
    if (playerToParty.has(leaderId)) {
      return reply.status(400).send({ error: "Already in a party" });
    }

    const partyId = `party_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const party: Party = {
      id: partyId,
      leaderId,
      memberIds: [leaderId],
      zoneId,
      createdAt: Date.now(),
      shareXp: true,
      shareGold: true,
    };

    parties.set(partyId, party);
    playerToParty.set(leaderId, partyId);
    persistParty(party);

    return reply.send({
      success: true,
      party,
    });
  });

  // Invite player to party
  server.post<{
    Body: { partyId: string; invitedPlayerId: string };
  }>("/party/invite", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const authenticatedWallet = (req as any).walletAddress as string;
    const { partyId, invitedPlayerId } = req.body;

    const party = parties.get(partyId);
    if (!party) {
      return reply.status(404).send({ error: "Party not found" });
    }

    const leader = getEntity(party.leaderId) as any;
    if (!(await controlsWallet(authenticatedWallet, leader?.walletAddress))) {
      return reply.status(403).send({ error: "Only the party leader can invite players" });
    }

    // Check if player is already in a party
    if (playerToParty.has(invitedPlayerId)) {
      return reply.status(400).send({ error: "Player already in a party" });
    }

    const invitedPlayer = getEntity(invitedPlayerId);

    if (!invitedPlayer) {
      return reply.status(404).send({ error: "Invited player not found" });
    }

    if (invitedPlayer.type !== "player") {
      return reply.status(400).send({ error: "Can only invite players" });
    }

    // Check party size limit (max 5 members)
    if (party.memberIds.length >= 5) {
      return reply.status(400).send({ error: "Party is full (max 5 members)" });
    }

    // Auto-accept for AI agents (they always join)
    party.memberIds.push(invitedPlayerId);
    playerToParty.set(invitedPlayerId, partyId);
    persistParty(party);

    return reply.send({
      success: true,
      party,
      message: `${invitedPlayer.name} joined the party`,
    });
  });

  // Leave party
  server.post<{
    Body: { partyId: string; playerId: string };
  }>("/party/leave", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const authenticatedWallet = (req as any).walletAddress as string;
    const { partyId, playerId } = req.body;

    const party = parties.get(partyId);
    if (!party) {
      return reply.status(404).send({ error: "Party not found" });
    }

    if (!party.memberIds.includes(playerId)) {
      return reply.status(400).send({ error: "Not in this party" });
    }

    const leavingEntity = getEntity(playerId) as any;
    const leavingWallet = leavingEntity?.walletAddress;
    if (!(await controlsWallet(authenticatedWallet, leavingWallet))) {
      return reply.status(403).send({ error: "Not authorized to remove this player from the party" });
    }

    // Remove from party
    party.memberIds = party.memberIds.filter(id => id !== playerId);
    playerToParty.delete(playerId);
    if (leavingWallet) unpersistWallet(leavingWallet);

    // If leader leaves or party is empty, disband
    if (playerId === party.leaderId || party.memberIds.length === 0) {
      const wallets = getPartyWallets(party);
      party.memberIds.forEach(id => playerToParty.delete(id));
      parties.delete(partyId);
      unpersistParty(partyId, wallets);

      return reply.send({
        success: true,
        disbanded: true,
        message: "Party disbanded",
      });
    }

    persistParty(party);

    return reply.send({
      success: true,
      party,
    });
  });

  // Get party members in same zone
  server.get<{
    Params: { zoneId: string; partyId: string };
  }>("/party/:partyId/members/:zoneId", async (req, reply) => {
    const { partyId, zoneId } = req.params;

    const party = parties.get(partyId);
    if (!party) {
      return reply.status(404).send({ error: "Party not found" });
    }

    const members = party.memberIds
      .map(id => {
        const entity = getEntity(id);
        if (!entity) return null;
        return {
          id,
          name: entity.name,
          level: entity.level,
          hp: entity.hp,
          maxHp: entity.maxHp,
          essence: entity.essence,
          maxEssence: entity.maxEssence,
          x: entity.x,
          y: entity.y,
          classId: entity.classId,
          raceId: entity.raceId,
        };
      })
      .filter(Boolean);

    return reply.send({
      party,
      members,
    });
  });

  // Find nearby players to party with
  server.get<{
    Params: { zoneId: string; playerId: string };
  }>("/party/nearby/:zoneId/:playerId", async (req, reply) => {
    const { zoneId, playerId } = req.params;

    const player = getEntity(playerId);

    if (!player) {
      return reply.status(404).send({ error: "Player not found" });
    }

    // Find nearby players (within 100 units)
    const nearbyPlayers: any[] = [];

    for (const [id, entity] of getAllEntities()) {
      if (id === playerId) continue;
      if (entity.type !== "player") continue;
      if (playerToParty.has(id)) continue; // Skip if already in a party

      const dx = entity.x - player.x;
      const dy = entity.y - player.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= 100) {
        nearbyPlayers.push({
          id,
          name: entity.name,
          level: entity.level,
          classId: entity.classId,
          raceId: entity.raceId,
          distance: Math.round(distance),
          x: entity.x,
          y: entity.y,
        });
      }
    }

    return reply.send({
      nearbyPlayers,
      count: nearbyPlayers.length,
    });
  });

  // Get player's party info
  server.get<{
    Params: { playerId: string };
  }>("/party/player/:playerId", async (req, reply) => {
    const { playerId } = req.params;

    const partyId = playerToParty.get(playerId);
    if (!partyId) {
      return reply.send({ inParty: false });
    }

    const party = parties.get(partyId);
    return reply.send({
      inParty: true,
      party,
    });
  });

  // ── Wallet-based party endpoints (for Champions page UI) ──────────────────

  // GET /party/search?q=  — find online champions by name
  server.get<{ Querystring: { q?: string } }>("/party/search", async (req, reply) => {
    const q = (req.query.q ?? "").toLowerCase().trim();
    const results: any[] = [];
    for (const [eId, entity] of getAllEntities()) {
      const e = entity as any;
      if (e.type !== "player") continue;
      if (q && !e.name.toLowerCase().includes(q)) continue;
      results.push({
        entityId: eId,
        zoneId: e.region ?? "unknown",
        name: e.name,
        level: e.level ?? 1,
        classId: e.classId,
        raceId: e.raceId,
        walletAddress: e.walletAddress ?? null,
        inParty: playerToParty.has(eId),
      });
      if (results.length >= 20) break;
    }
    return reply.send({ results });
  });

  // POST /party/invite-champion  { fromEntityId, fromZoneId, toCustodialWallet }
  // Creates party for fromEntity if they don't have one, then queues invite
  server.post<{
    Body: { fromEntityId: string; fromZoneId: string; toCustodialWallet: string };
  }>("/party/invite-champion", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const authenticatedWallet = (req as any).walletAddress as string;
    const { fromEntityId, fromZoneId, toCustodialWallet } = req.body;

    const fromEntity = getEntity(fromEntityId) as any;
    if (!fromEntity || fromEntity.type !== "player") {
      return reply.code(404).send({ error: "Your champion is not online" });
    }

    if (!(await controlsWallet(authenticatedWallet, fromEntity.walletAddress))) {
      return reply.code(403).send({ error: "Not authorized to invite from this champion" });
    }

    // Prevent self-invite
    if (fromEntity.walletAddress?.toLowerCase() === toCustodialWallet.toLowerCase()) {
      return reply.code(400).send({ error: "Cannot invite yourself" });
    }

    // Create party if needed
    let partyId = playerToParty.get(fromEntityId);
    if (!partyId) {
      partyId = `party_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const party: Party = {
        id: partyId,
        leaderId: fromEntityId,
        memberIds: [fromEntityId],
        zoneId: fromZoneId,
        createdAt: Date.now(),
        shareXp: true,
        shareGold: true,
      };
      parties.set(partyId, party);
      playerToParty.set(fromEntityId, partyId);
      persistParty(party);
    }

    const party = parties.get(partyId)!;
    if (party.memberIds.length >= 5) {
      return reply.code(400).send({ error: "Party is full (max 5)" });
    }

    // Check target isn't already in this party
    const targetRef = findEntityByCustodialWallet(toCustodialWallet);
    if (targetRef && playerToParty.get(targetRef.entityId) === partyId) {
      return reply.code(400).send({ error: "Champion is already in your party" });
    }

    // Queue invite
    const invite: PartyInvite = {
      id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fromEntityId,
      fromName: fromEntity.name,
      fromCustodialWallet: (fromEntity.walletAddress ?? "").toLowerCase(),
      toCustodialWallet: toCustodialWallet.toLowerCase(),
      partyId,
      createdAt: Date.now(),
    };
    const existing = freshInvites(toCustodialWallet);
    // Dedupe: remove any existing invite from same party
    const deduped = existing.filter((i) => i.partyId !== partyId || i.fromEntityId !== fromEntityId);
    pendingInvites.set(toCustodialWallet.toLowerCase(), [...deduped, invite]);

    return reply.send({ success: true, inviteId: invite.id });
  });

  // GET /party/invites/:custodialWallet  — pending invites for a champion
  server.get<{ Params: { custodialWallet: string } }>(
    "/party/invites/:custodialWallet",
    async (req, reply) => {
      const invites = freshInvites(req.params.custodialWallet);
      return reply.send({ invites });
    },
  );

  // POST /party/accept-invite  { custodialWallet, inviteId }
  server.post<{
    Body: { custodialWallet: string; inviteId: string };
  }>("/party/accept-invite", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const authenticatedWallet = (req as any).walletAddress as string;
    const { custodialWallet, inviteId } = req.body;

    if (!(await controlsWallet(authenticatedWallet, custodialWallet))) {
      return reply.code(403).send({ error: "Not authorized to accept invites for this champion" });
    }

    const invites = freshInvites(custodialWallet);
    const invite = invites.find((i) => i.id === inviteId);
    if (!invite) return reply.code(404).send({ error: "Invite not found or expired" });

    const party = parties.get(invite.partyId);
    if (!party) return reply.code(404).send({ error: "Party no longer exists" });
    if (party.memberIds.length >= 5) return reply.code(400).send({ error: "Party is full" });

    // Find accepting champion's entity
    const ref = findEntityByCustodialWallet(custodialWallet);
    if (!ref) return reply.code(400).send({ error: "Your champion must be online to join a party" });

    if (playerToParty.has(ref.entityId)) {
      return reply.code(400).send({ error: "Your champion is already in a party" });
    }

    party.memberIds.push(ref.entityId);
    playerToParty.set(ref.entityId, invite.partyId);
    persistParty(party);

    // Remove accepted invite
    pendingInvites.set(custodialWallet.toLowerCase(), invites.filter((i) => i.id !== inviteId));

    return reply.send({ success: true, party });
  });

  // POST /party/decline-invite  { custodialWallet, inviteId }
  server.post<{
    Body: { custodialWallet: string; inviteId: string };
  }>("/party/decline-invite", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const authenticatedWallet = (req as any).walletAddress as string;
    const { custodialWallet, inviteId } = req.body;

    if (!(await controlsWallet(authenticatedWallet, custodialWallet))) {
      return reply.code(403).send({ error: "Not authorized to decline invites for this champion" });
    }

    const invites = freshInvites(custodialWallet);
    pendingInvites.set(custodialWallet.toLowerCase(), invites.filter((i) => i.id !== inviteId));
    return reply.send({ success: true });
  });

  // GET /party/status/:custodialWallet  — current party + all members
  server.get<{ Params: { custodialWallet: string } }>(
    "/party/status/:custodialWallet",
    async (req, reply) => {
      const ref = findEntityByCustodialWallet(req.params.custodialWallet);
      if (!ref) return reply.send({ inParty: false, members: [], entityId: null, zoneId: null });

      const partyId = playerToParty.get(ref.entityId);
      if (!partyId) {
        return reply.send({ inParty: false, members: [], entityId: ref.entityId, zoneId: ref.zoneId });
      }

      const party = parties.get(partyId);
      if (!party) {
        return reply.send({ inParty: false, members: [], entityId: ref.entityId, zoneId: ref.zoneId });
      }

      const members = party.memberIds.map((mId) => {
        const e = getEntity(mId) as any;
        if (e) {
          return {
            entityId: mId,
            zoneId: e.region ?? "unknown",
            name: e.name,
            level: e.level ?? 1,
            hp: e.hp ?? 0,
            maxHp: e.maxHp ?? 100,
            classId: e.classId,
            raceId: e.raceId,
            walletAddress: e.walletAddress ?? null,
            isLeader: mId === party.leaderId,
          };
        }
        return { entityId: mId, name: "Offline", isLeader: mId === party.leaderId, level: 0, hp: 0, maxHp: 1 };
      });

      return reply.send({ inParty: true, partyId, party, members, entityId: ref.entityId, zoneId: ref.zoneId });
    },
  );

  // POST /party/leave-wallet  { custodialWallet }  — leave from Champions page
  server.post<{ Body: { custodialWallet: string } }>(
    "/party/leave-wallet",
    {
      preHandler: authenticateRequest,
    },
    async (req, reply) => {
      const authenticatedWallet = (req as any).walletAddress as string;
      if (!(await controlsWallet(authenticatedWallet, req.body.custodialWallet))) {
        return reply.code(403).send({ error: "Not authorized to manage this champion" });
      }

      const ref = findEntityByCustodialWallet(req.body.custodialWallet);
      if (!ref) return reply.code(404).send({ error: "Champion not online" });

      const partyId = playerToParty.get(ref.entityId);
      if (!partyId) return reply.code(400).send({ error: "Not in a party" });

      const party = parties.get(partyId);
      if (!party) return reply.code(404).send({ error: "Party not found" });

      party.memberIds = party.memberIds.filter((id) => id !== ref.entityId);
      playerToParty.delete(ref.entityId);
      unpersistWallet(req.body.custodialWallet);

      if (ref.entityId === party.leaderId || party.memberIds.length === 0) {
        const wallets = getPartyWallets(party);
        party.memberIds.forEach((id) => playerToParty.delete(id));
        parties.delete(partyId);
        unpersistParty(partyId, wallets);
        return reply.send({ success: true, disbanded: true });
      }

      // Promote next member to leader
      if (ref.entityId === party.leaderId) {
        party.leaderId = party.memberIds[0];
      }

      persistParty(party);

      return reply.send({ success: true, party });
    },
  );
}

// Helper to get party members
export function getPartyMembers(playerId: string): string[] {
  const partyId = playerToParty.get(playerId);
  if (!partyId) return [playerId];

  const party = parties.get(partyId);
  return party ? party.memberIds : [playerId];
}

// Helper to check if two players are in same party
export function areInSameParty(playerId1: string, playerId2: string): boolean {
  const party1 = playerToParty.get(playerId1);
  const party2 = playerToParty.get(playerId2);
  return party1 != null && party1 === party2;
}

// Helper to get a player's party ID (or undefined if solo)
export function getPlayerPartyId(playerId: string): string | undefined {
  return playerToParty.get(playerId);
}

// Helper to get a party leader ID (or the player themselves if solo)
export function getPartyLeaderId(playerId: string): string | undefined {
  const partyId = playerToParty.get(playerId);
  if (!partyId) return playerId;

  const party = parties.get(partyId);
  return party?.leaderId ?? playerId;
}

/**
 * Programmatically add an entity to a player's party (e.g. rented characters).
 * If the player has no party, creates one with them as leader.
 * Returns the partyId or null on failure.
 */
export function addEntityToParty(leaderEntityId: string, newEntityId: string, zoneId: string): string | null {
  let partyId = playerToParty.get(leaderEntityId);

  if (!partyId) {
    // Create a party for the leader
    partyId = `party_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const party: Party = {
      id: partyId,
      leaderId: leaderEntityId,
      memberIds: [leaderEntityId],
      zoneId,
      createdAt: Date.now(),
      shareXp: true,
      shareGold: true,
    };
    parties.set(partyId, party);
    playerToParty.set(leaderEntityId, partyId);
  }

  const party = parties.get(partyId);
  if (!party) return null;
  if (party.memberIds.length >= 5) return null;
  if (party.memberIds.includes(newEntityId)) return partyId;

  party.memberIds.push(newEntityId);
  playerToParty.set(newEntityId, partyId);
  persistParty(party);
  return partyId;
}

/**
 * Programmatically remove an entity from its party (e.g. rental expiry).
 */
export function removeEntityFromParty(entityId: string): void {
  const partyId = playerToParty.get(entityId);
  if (!partyId) return;

  const party = parties.get(partyId);
  if (!party) {
    playerToParty.delete(entityId);
    return;
  }

  party.memberIds = party.memberIds.filter(id => id !== entityId);
  playerToParty.delete(entityId);

  // Disband if empty or leader left
  if (party.memberIds.length === 0 || entityId === party.leaderId) {
    const wallets = getPartyWallets(party);
    party.memberIds.forEach(id => playerToParty.delete(id));
    parties.delete(partyId);
    unpersistParty(partyId, wallets);
  } else {
    persistParty(party);
  }
}
