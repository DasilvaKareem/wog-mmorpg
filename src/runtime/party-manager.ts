import { randomUUID } from "node:crypto";
import type { Party, PartyMember, PartyView } from "../types/party.js";
import { MAX_PARTY_SIZE } from "../types/party.js";

function toView(party: Party): PartyView {
  return {
    partyId: party.partyId,
    leaderId: party.leaderId,
    members: [...party.members],
    invites: Array.from(party.invites),
    createdAt: party.createdAt,
  };
}

export class PartyManager {
  private parties: Map<string, Party> = new Map();
  // Quick lookup: agentId → partyId
  private agentParty: Map<string, string> = new Map();

  createParty(leaderId: string, leaderName: string): PartyView | string {
    if (this.agentParty.has(leaderId)) {
      return "already in a party";
    }

    const party: Party = {
      partyId: randomUUID(),
      leaderId,
      members: [{ agentId: leaderId, name: leaderName, joinedAt: Date.now() }],
      invites: new Set(),
      createdAt: Date.now(),
    };

    this.parties.set(party.partyId, party);
    this.agentParty.set(leaderId, party.partyId);

    console.log(`[Party] ${leaderName} created party ${party.partyId}`);
    return toView(party);
  }

  invite(partyId: string, inviterId: string, targetId: string): PartyView | string {
    const party = this.parties.get(partyId);
    if (!party) return "party not found";

    if (party.leaderId !== inviterId) return "only the leader can invite";

    if (this.agentParty.has(targetId)) return "target is already in a party";

    if (party.members.length >= MAX_PARTY_SIZE) return "party is full";

    if (party.invites.has(targetId)) return "already invited";

    party.invites.add(targetId);
    return toView(party);
  }

  join(partyId: string, agentId: string, agentName: string): PartyView | string {
    const party = this.parties.get(partyId);
    if (!party) return "party not found";

    if (this.agentParty.has(agentId)) return "already in a party";

    if (!party.invites.has(agentId)) return "no invite to this party";

    if (party.members.length >= MAX_PARTY_SIZE) return "party is full";

    party.invites.delete(agentId);
    party.members.push({ agentId, name: agentName, joinedAt: Date.now() });
    this.agentParty.set(agentId, partyId);

    console.log(`[Party] ${agentName} joined party ${partyId}`);
    return toView(party);
  }

  leave(partyId: string, agentId: string): PartyView | string {
    const party = this.parties.get(partyId);
    if (!party) return "party not found";

    const idx = party.members.findIndex((m) => m.agentId === agentId);
    if (idx === -1) return "not in this party";

    party.members.splice(idx, 1);
    this.agentParty.delete(agentId);

    // If leader left, promote next member or disband
    if (party.leaderId === agentId) {
      if (party.members.length > 0) {
        party.leaderId = party.members[0].agentId;
        console.log(`[Party] Leadership passed to ${party.members[0].name} in ${partyId}`);
      } else {
        return this.disbandInternal(party);
      }
    }

    console.log(`[Party] Agent ${agentId} left party ${partyId}`);
    return toView(party);
  }

  disband(partyId: string, requesterId: string): string {
    const party = this.parties.get(partyId);
    if (!party) return "party not found";

    if (party.leaderId !== requesterId) return "only the leader can disband";

    return this.disbandInternal(party);
  }

  getParty(partyId: string): PartyView | undefined {
    const party = this.parties.get(partyId);
    return party ? toView(party) : undefined;
  }

  getAgentParty(agentId: string): PartyView | undefined {
    const partyId = this.agentParty.get(agentId);
    if (!partyId) return undefined;
    return this.getParty(partyId);
  }

  private disbandInternal(party: Party): string {
    for (const member of party.members) {
      this.agentParty.delete(member.agentId);
    }
    this.parties.delete(party.partyId);
    console.log(`[Party] Party ${party.partyId} disbanded`);
    return "disbanded";
  }
}
