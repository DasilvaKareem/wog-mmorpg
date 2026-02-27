import type { FastifyInstance } from "fastify";
import { authenticateRequest } from "../auth/auth.js";
import { getOrCreateZone, getAllZones } from "../world/zoneRuntime.js";

interface Party {
  id: string;
  leaderId: string;
  memberIds: string[];
  zoneId: string;
  createdAt: number;
  shareXp: boolean;
  shareGold: boolean;
}

// ── In-memory party storage ───────────────────────────────────────────────
const parties = new Map<string, Party>();
const playerToParty = new Map<string, string>(); // entityId -> partyId

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

// Helper: find entity by custodial wallet across all zones
function findEntityByCustodialWallet(custodialWallet: string): { entityId: string; zoneId: string } | null {
  const lower = custodialWallet.toLowerCase();
  for (const [zId, zone] of getAllZones()) {
    for (const [eId, entity] of zone.entities) {
      if ((entity as any).walletAddress?.toLowerCase() === lower) {
        return { entityId: eId, zoneId: zId };
      }
    }
  }
  return null;
}

export function registerPartyRoutes(server: FastifyInstance): void {
  // Create a party
  server.post<{
    Body: { zoneId: string; leaderId: string };
  }>("/party/create", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const { zoneId, leaderId } = req.body;

    const zone = getOrCreateZone(zoneId);
    const leader = zone.entities.get(leaderId);

    if (!leader) {
      return reply.status(404).send({ error: "Leader entity not found" });
    }

    if (leader.type !== "player") {
      return reply.status(400).send({ error: "Only players can create parties" });
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
    const { partyId, invitedPlayerId } = req.body;

    const party = parties.get(partyId);
    if (!party) {
      return reply.status(404).send({ error: "Party not found" });
    }

    // Check if player is already in a party
    if (playerToParty.has(invitedPlayerId)) {
      return reply.status(400).send({ error: "Player already in a party" });
    }

    const zone = getOrCreateZone(party.zoneId);
    const invitedPlayer = zone.entities.get(invitedPlayerId);

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
    const { partyId, playerId } = req.body;

    const party = parties.get(partyId);
    if (!party) {
      return reply.status(404).send({ error: "Party not found" });
    }

    if (!party.memberIds.includes(playerId)) {
      return reply.status(400).send({ error: "Not in this party" });
    }

    // Remove from party
    party.memberIds = party.memberIds.filter(id => id !== playerId);
    playerToParty.delete(playerId);

    // If leader leaves or party is empty, disband
    if (playerId === party.leaderId || party.memberIds.length === 0) {
      // Disband party
      party.memberIds.forEach(id => playerToParty.delete(id));
      parties.delete(partyId);

      return reply.send({
        success: true,
        disbanded: true,
        message: "Party disbanded",
      });
    }

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

    const zone = getOrCreateZone(zoneId);
    const members = party.memberIds
      .map(id => {
        const entity = zone.entities.get(id);
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

    const zone = getOrCreateZone(zoneId);
    const player = zone.entities.get(playerId);

    if (!player) {
      return reply.status(404).send({ error: "Player not found" });
    }

    // Find nearby players (within 100 units)
    const nearbyPlayers: any[] = [];

    for (const [id, entity] of zone.entities.entries()) {
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
    for (const [zId, zone] of getAllZones()) {
      for (const [eId, entity] of zone.entities) {
        const e = entity as any;
        if (e.type !== "player") continue;
        if (q && !e.name.toLowerCase().includes(q)) continue;
        results.push({
          entityId: eId,
          zoneId: zId,
          name: e.name,
          level: e.level ?? 1,
          classId: e.classId,
          raceId: e.raceId,
          walletAddress: e.walletAddress ?? null,
          inParty: playerToParty.has(eId),
        });
        if (results.length >= 20) break;
      }
      if (results.length >= 20) break;
    }
    return reply.send({ results });
  });

  // POST /party/invite-champion  { fromEntityId, fromZoneId, toCustodialWallet }
  // Creates party for fromEntity if they don't have one, then queues invite
  server.post<{
    Body: { fromEntityId: string; fromZoneId: string; toCustodialWallet: string };
  }>("/party/invite-champion", async (req, reply) => {
    const { fromEntityId, fromZoneId, toCustodialWallet } = req.body;

    const fromZone = getAllZones().get(fromZoneId);
    const fromEntity = fromZone?.entities.get(fromEntityId) as any;
    if (!fromEntity || fromEntity.type !== "player") {
      return reply.code(404).send({ error: "Your champion is not online" });
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
  }>("/party/accept-invite", async (req, reply) => {
    const { custodialWallet, inviteId } = req.body;
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

    // Remove accepted invite
    pendingInvites.set(custodialWallet.toLowerCase(), invites.filter((i) => i.id !== inviteId));

    return reply.send({ success: true, party });
  });

  // POST /party/decline-invite  { custodialWallet, inviteId }
  server.post<{
    Body: { custodialWallet: string; inviteId: string };
  }>("/party/decline-invite", async (req, reply) => {
    const { custodialWallet, inviteId } = req.body;
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
        for (const [zId, zone] of getAllZones()) {
          const e = zone.entities.get(mId) as any;
          if (e) {
            return {
              entityId: mId,
              zoneId: zId,
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
        }
        return { entityId: mId, name: "Offline", isLeader: mId === party.leaderId, level: 0, hp: 0, maxHp: 1 };
      });

      return reply.send({ inParty: true, partyId, party, members, entityId: ref.entityId, zoneId: ref.zoneId });
    },
  );

  // POST /party/leave-wallet  { custodialWallet }  — leave from Champions page
  server.post<{ Body: { custodialWallet: string } }>(
    "/party/leave-wallet",
    async (req, reply) => {
      const ref = findEntityByCustodialWallet(req.body.custodialWallet);
      if (!ref) return reply.code(404).send({ error: "Champion not online" });

      const partyId = playerToParty.get(ref.entityId);
      if (!partyId) return reply.code(400).send({ error: "Not in a party" });

      const party = parties.get(partyId);
      if (!party) return reply.code(404).send({ error: "Party not found" });

      party.memberIds = party.memberIds.filter((id) => id !== ref.entityId);
      playerToParty.delete(ref.entityId);

      if (ref.entityId === party.leaderId || party.memberIds.length === 0) {
        party.memberIds.forEach((id) => playerToParty.delete(id));
        parties.delete(partyId);
        return reply.send({ success: true, disbanded: true });
      }

      // Promote next member to leader
      if (ref.entityId === party.leaderId) {
        party.leaderId = party.memberIds[0];
      }

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
