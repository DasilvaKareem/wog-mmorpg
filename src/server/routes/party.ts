import type { FastifyInstance } from "fastify";
import type { PartyManager } from "../../runtime/party-manager.js";

interface CreateBody { leaderId: string; leaderName: string }
interface InviteBody { inviterId: string; targetId: string }
interface JoinBody { agentId: string; agentName: string }
interface LeaveBody { agentId: string }
interface DisbandBody { requesterId: string }

export function registerPartyRoutes(app: FastifyInstance, parties: PartyManager): void {
  // Create a party
  app.post<{ Body: CreateBody }>("/v1/party/create", (req, reply) => {
    const { leaderId, leaderName } = req.body ?? {};
    if (!leaderId || !leaderName) {
      return reply.status(400).send({ error: "leaderId and leaderName are required" });
    }

    const result = parties.createParty(leaderId, leaderName);
    if (typeof result === "string") {
      return reply.status(409).send({ error: result });
    }
    return reply.send(result);
  });

  // Invite an agent
  app.post<{ Params: { partyId: string }; Body: InviteBody }>(
    "/v1/party/:partyId/invite",
    (req, reply) => {
      const { inviterId, targetId } = req.body ?? {};
      if (!inviterId || !targetId) {
        return reply.status(400).send({ error: "inviterId and targetId are required" });
      }

      const result = parties.invite(req.params.partyId, inviterId, targetId);
      if (typeof result === "string") {
        return reply.status(409).send({ error: result });
      }
      return reply.send(result);
    },
  );

  // Join a party (accept invite)
  app.post<{ Params: { partyId: string }; Body: JoinBody }>(
    "/v1/party/:partyId/join",
    (req, reply) => {
      const { agentId, agentName } = req.body ?? {};
      if (!agentId || !agentName) {
        return reply.status(400).send({ error: "agentId and agentName are required" });
      }

      const result = parties.join(req.params.partyId, agentId, agentName);
      if (typeof result === "string") {
        return reply.status(409).send({ error: result });
      }
      return reply.send(result);
    },
  );

  // Leave a party
  app.post<{ Params: { partyId: string }; Body: LeaveBody }>(
    "/v1/party/:partyId/leave",
    (req, reply) => {
      const { agentId } = req.body ?? {};
      if (!agentId) {
        return reply.status(400).send({ error: "agentId is required" });
      }

      const result = parties.leave(req.params.partyId, agentId);
      if (typeof result === "string") {
        if (result === "disbanded") return reply.send({ status: "disbanded" });
        return reply.status(409).send({ error: result });
      }
      return reply.send(result);
    },
  );

  // Disband a party
  app.post<{ Params: { partyId: string }; Body: DisbandBody }>(
    "/v1/party/:partyId/disband",
    (req, reply) => {
      const { requesterId } = req.body ?? {};
      if (!requesterId) {
        return reply.status(400).send({ error: "requesterId is required" });
      }

      const result = parties.disband(req.params.partyId, requesterId);
      if (result === "disbanded") return reply.send({ status: "disbanded" });
      return reply.status(409).send({ error: result });
    },
  );

  // Get party by ID
  app.get<{ Params: { partyId: string } }>("/v1/party/:partyId", (req, reply) => {
    const party = parties.getParty(req.params.partyId);
    if (!party) return reply.status(404).send({ error: "party not found" });
    return reply.send(party);
  });

  // Get an agent's current party
  app.get<{ Params: { agentId: string } }>("/v1/party/agent/:agentId", (req, reply) => {
    const party = parties.getAgentParty(req.params.agentId);
    if (!party) return reply.send({ party: null });
    return reply.send(party);
  });
}
