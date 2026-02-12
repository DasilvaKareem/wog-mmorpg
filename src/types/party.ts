export const MAX_PARTY_SIZE = 5;

export interface PartyMember {
  agentId: string;
  name: string;
  joinedAt: number;
}

export interface Party {
  partyId: string;
  leaderId: string;
  members: PartyMember[];
  invites: Set<string>;   // agentIds with pending invites
  createdAt: number;
}

/** Serializable view of a Party (invites as array) */
export interface PartyView {
  partyId: string;
  leaderId: string;
  members: PartyMember[];
  invites: string[];
  createdAt: number;
}
