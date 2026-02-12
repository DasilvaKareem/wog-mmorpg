import type { FastifyInstance } from "fastify";
import { getOrCreateZone } from "./zoneRuntime.js";

interface Party {
  id: string;
  leaderId: string;
  memberIds: string[];
  zoneId: string;
  createdAt: number;
  shareXp: boolean;
  shareGold: boolean;
}

// In-memory party storage (could be moved to database)
const parties = new Map<string, Party>();
const playerToParty = new Map<string, string>(); // playerId -> partyId

export function registerPartyRoutes(server: FastifyInstance): void {
  // Create a party
  server.post<{
    Body: { zoneId: string; leaderId: string };
  }>("/party/create", async (req, reply) => {
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
  }>("/party/invite", async (req, reply) => {
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
  }>("/party/leave", async (req, reply) => {
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
