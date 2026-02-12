import type { FastifyInstance } from "fastify";
import { getGoldBalance } from "./blockchain.js";
import {
  formatGold,
  getAvailableGold,
  recordGoldSpend,
  reserveGold,
  unreserveGold,
} from "./goldLedger.js";
import {
  createGuildOnChain,
  inviteMemberOnChain,
  joinGuildOnChain,
  leaveGuildOnChain,
  depositGoldOnChain,
  createProposalOnChain,
  voteOnProposalOnChain,
  executeProposalOnChain,
  getGuildFromChain,
  getMemberFromChain,
  getGuildMembersFromChain,
  getProposalFromChain,
  getNextGuildId,
  getNextProposalId,
  getMemberGuildId,
  GuildStatus,
  MemberRank,
  ProposalType,
  ProposalStatus,
  type GuildData,
  type MemberData,
  type ProposalData,
} from "./guildChain.js";
import { getAllZones } from "./zoneRuntime.js";
import { authenticateRequest } from "./auth.js";

const RANK_NAMES = ["Member", "Officer", "Founder"];
const STATUS_NAMES = ["active", "disbanded"];
const PROPOSAL_TYPE_NAMES = ["withdraw-gold", "kick-member", "promote-officer", "demote-officer", "disband-guild"];
const PROPOSAL_STATUS_NAMES = ["active", "passed", "failed", "executed", "cancelled"];

function formatGuildForResponse(guild: GuildData) {
  return {
    guildId: guild.guildId,
    name: guild.name,
    description: guild.description,
    founder: guild.founder,
    treasury: guild.treasury,
    level: guild.level,
    reputation: guild.reputation,
    status: STATUS_NAMES[guild.status] || "unknown",
    createdAt: guild.createdAt,
    memberCount: guild.memberCount,
  };
}

function formatMemberForResponse(member: MemberData) {
  return {
    address: member.address,
    rank: RANK_NAMES[member.rank] || "unknown",
    joinedAt: member.joinedAt,
    contributedGold: member.contributedGold,
  };
}

function formatProposalForResponse(proposal: ProposalData) {
  const now = Math.floor(Date.now() / 1000);
  return {
    proposalId: proposal.proposalId,
    guildId: proposal.guildId,
    proposer: proposal.proposer,
    proposalType: PROPOSAL_TYPE_NAMES[proposal.proposalType] || "unknown",
    description: proposal.description,
    createdAt: proposal.createdAt,
    votingEndsAt: proposal.votingEndsAt,
    timeRemaining: Math.max(0, proposal.votingEndsAt - now),
    yesVotes: proposal.yesVotes,
    noVotes: proposal.noVotes,
    status: PROPOSAL_STATUS_NAMES[proposal.status] || "unknown",
    targetAddress: proposal.targetAddress,
    targetAmount: proposal.targetAmount,
  };
}

export function registerGuildRoutes(server: FastifyInstance) {
  /**
   * GET /guild/registrar/:zoneId/:entityId
   * Interact with Guild Registrar NPC to browse/create guilds.
   */
  server.get<{ Params: { zoneId: string; entityId: string } }>(
    "/guild/registrar/:zoneId/:entityId",
    async (request, reply) => {
      const { zoneId, entityId } = request.params;

      const zone = getAllZones().get(zoneId);
      if (!zone) {
        reply.code(404);
        return { error: "Zone not found" };
      }

      const entity = zone.entities.get(entityId);
      if (!entity || entity.type !== "guild-registrar") {
        reply.code(404);
        return { error: "Guild Registrar not found" };
      }

      try {
        // Get all guilds
        const nextId = await getNextGuildId();
        const activeGuilds = [];

        for (let i = 0; i < nextId; i++) {
          const guild = await getGuildFromChain(i);
          if (guild.status === GuildStatus.Active) {
            activeGuilds.push(formatGuildForResponse(guild));
          }
        }

        return {
          npcId: entity.id,
          npcName: entity.name,
          npcType: entity.type,
          zoneId,
          description: `${entity.name} manages guild registration. Create a new guild (requires 50 gold creation fee + 100 gold minimum deposit = 150 gold total) or browse existing guilds to join.`,
          activeGuilds,
          endpoints: {
            createGuild: "/guild/create",
            listGuilds: "/guilds",
            viewGuild: "/guild/:guildId",
          },
        };
      } catch (err) {
        server.log.error(err, `Failed to get guild registrar ${entityId}`);
        reply.code(500);
        return { error: "Failed to retrieve guild data" };
      }
    }
  );

  /**
   * POST /guild/create
   * Create a new guild (requires minimum 100 gold deposit).
   */
  server.post<{
    Body: {
      founderAddress: string;
      name: string;
      description: string;
      initialDeposit: number;
    };
  }>("/guild/create", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { founderAddress, name, description, initialDeposit } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    if (!founderAddress || !/^0x[a-fA-F0-9]{40}$/.test(founderAddress)) {
      reply.code(400);
      return { error: "Invalid founder address" };
    }

    if (founderAddress.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Not authorized to use this wallet" };
    }

    if (!name || name.length < 3 || name.length > 32) {
      reply.code(400);
      return { error: "Guild name must be 3-32 characters" };
    }

    if (initialDeposit < 100) {
      reply.code(400);
      return { error: "Minimum initial deposit is 100 gold" };
    }

    const creationFee = 50; // Guild creation fee (protocol revenue)
    const totalCost = initialDeposit + creationFee;

    try {
      // Check if already in a guild
      const currentGuildId = await getMemberGuildId(founderAddress);
      if (currentGuildId > 0) {
        reply.code(400);
        return { error: "Already a member of a guild" };
      }

      // Check gold balance
      const onChainGold = parseFloat(await getGoldBalance(founderAddress));
      const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
      const availableGold = getAvailableGold(founderAddress, safeOnChainGold);

      if (availableGold < totalCost) {
        reply.code(400);
        return {
          error: "Insufficient gold",
          required: totalCost,
          available: formatGold(availableGold),
          breakdown: {
            creationFee,
            initialDeposit,
            total: totalCost,
          },
        };
      }

      // Create guild on-chain
      const { guildId, txHash } = await createGuildOnChain(
        name,
        description,
        founderAddress,
        initialDeposit,
        creationFee
      );

      // Record gold spend (deposit + fee)
      recordGoldSpend(founderAddress, totalCost);

      server.log.info(`Guild ${guildId} "${name}" created by ${founderAddress}`);

      return {
        ok: true,
        guildId,
        name,
        initialDeposit,
        creationFee,
        totalCost,
        remainingGold: formatGold(getAvailableGold(founderAddress, safeOnChainGold)),
        txHash,
      };
    } catch (err) {
      server.log.error(err, "Failed to create guild");
      reply.code(500);
      return { error: "Failed to create guild" };
    }
  });

  /**
   * GET /guilds
   * List all active guilds.
   */
  server.get("/guilds", async (_request, reply) => {
    try {
      const nextId = await getNextGuildId();
      const guilds = [];

      for (let i = 0; i < nextId; i++) {
        const guild = await getGuildFromChain(i);
        if (guild.status === GuildStatus.Active) {
          guilds.push(formatGuildForResponse(guild));
        }
      }

      return guilds;
    } catch (err) {
      server.log.error(err, "Failed to list guilds");
      reply.code(500);
      return { error: "Failed to list guilds" };
    }
  });

  /**
   * GET /guild/:guildId
   * Get detailed guild information including members.
   */
  server.get<{ Params: { guildId: string } }>(
    "/guild/:guildId",
    async (request, reply) => {
      const guildId = parseInt(request.params.guildId, 10);
      if (isNaN(guildId) || guildId < 0) {
        reply.code(400);
        return { error: "Invalid guild ID" };
      }

      try {
        const guild = await getGuildFromChain(guildId);
        const memberAddresses = await getGuildMembersFromChain(guildId);

        const members = [];
        for (const address of memberAddresses) {
          const member = await getMemberFromChain(guildId, address);
          members.push(formatMemberForResponse(member));
        }

        return {
          ...formatGuildForResponse(guild),
          members,
        };
      } catch (err) {
        server.log.error(err, `Failed to get guild ${guildId}`);
        reply.code(500);
        return { error: "Failed to get guild details" };
      }
    }
  );

  /**
   * POST /guild/:guildId/invite
   * Invite a member to the guild (officers+ only).
   */
  server.post<{
    Params: { guildId: string };
    Body: { memberAddress: string };
  }>("/guild/:guildId/invite", async (request, reply) => {
    const guildId = parseInt(request.params.guildId, 10);
    const { memberAddress } = request.body;

    if (!memberAddress || !/^0x[a-fA-F0-9]{40}$/.test(memberAddress)) {
      reply.code(400);
      return { error: "Invalid member address" };
    }

    try {
      // Check if member is already in a guild
      const currentGuildId = await getMemberGuildId(memberAddress);
      if (currentGuildId > 0) {
        reply.code(400);
        return { error: "Member is already in a guild" };
      }

      const txHash = await inviteMemberOnChain(guildId, memberAddress);

      server.log.info(`Invited ${memberAddress} to guild ${guildId}`);

      return {
        ok: true,
        guildId,
        memberAddress,
        txHash,
      };
    } catch (err) {
      server.log.error(err, `Failed to invite member to guild ${guildId}`);
      reply.code(500);
      return { error: "Failed to invite member" };
    }
  });

  /**
   * POST /guild/:guildId/join
   * Join a guild (after being invited).
   */
  server.post<{
    Params: { guildId: string };
    Body: { memberAddress: string };
  }>("/guild/:guildId/join", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const guildId = parseInt(request.params.guildId, 10);
    const { memberAddress } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    if (!memberAddress || !/^0x[a-fA-F0-9]{40}$/.test(memberAddress)) {
      reply.code(400);
      return { error: "Invalid member address" };
    }

    // Verify authenticated wallet matches member address
    if (memberAddress.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Not authorized to use this wallet" };
    }

    try {
      // Check if already in a guild
      const currentGuildId = await getMemberGuildId(memberAddress);
      if (currentGuildId > 0) {
        reply.code(400);
        return { error: "Already a member of a guild" };
      }

      const txHash = await joinGuildOnChain(guildId, memberAddress);

      server.log.info(`${memberAddress} joined guild ${guildId}`);

      return {
        ok: true,
        guildId,
        memberAddress,
        txHash,
      };
    } catch (err) {
      server.log.error(err, `Failed to join guild ${guildId}`);
      reply.code(500);
      return { error: "Failed to join guild" };
    }
  });

  /**
   * POST /guild/:guildId/leave
   * Leave a guild voluntarily.
   */
  server.post<{
    Params: { guildId: string };
    Body: { memberAddress: string };
  }>("/guild/:guildId/leave", async (request, reply) => {
    const guildId = parseInt(request.params.guildId, 10);
    const { memberAddress } = request.body;

    if (!memberAddress || !/^0x[a-fA-F0-9]{40}$/.test(memberAddress)) {
      reply.code(400);
      return { error: "Invalid member address" };
    }

    try {
      const txHash = await leaveGuildOnChain(guildId, memberAddress);

      server.log.info(`${memberAddress} left guild ${guildId}`);

      return {
        ok: true,
        guildId,
        memberAddress,
        txHash,
      };
    } catch (err) {
      server.log.error(err, `Failed to leave guild ${guildId}`);
      reply.code(500);
      return { error: "Failed to leave guild" };
    }
  });

  /**
   * POST /guild/:guildId/deposit
   * Deposit gold into guild treasury.
   */
  server.post<{
    Params: { guildId: string };
    Body: { memberAddress: string; amount: number };
  }>("/guild/:guildId/deposit", async (request, reply) => {
    const guildId = parseInt(request.params.guildId, 10);
    const { memberAddress, amount } = request.body;

    if (!memberAddress || !/^0x[a-fA-F0-9]{40}$/.test(memberAddress)) {
      reply.code(400);
      return { error: "Invalid member address" };
    }

    if (amount <= 0) {
      reply.code(400);
      return { error: "Amount must be positive" };
    }

    try {
      // Check gold balance
      const onChainGold = parseFloat(await getGoldBalance(memberAddress));
      const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
      const availableGold = getAvailableGold(memberAddress, safeOnChainGold);

      if (availableGold < amount) {
        reply.code(400);
        return {
          error: "Insufficient gold",
          required: amount,
          available: formatGold(availableGold),
        };
      }

      const txHash = await depositGoldOnChain(guildId, memberAddress, amount);

      // Record gold spend
      recordGoldSpend(memberAddress, amount);

      server.log.info(`${memberAddress} deposited ${amount} gold to guild ${guildId}`);

      return {
        ok: true,
        guildId,
        amount,
        remainingGold: formatGold(getAvailableGold(memberAddress, safeOnChainGold)),
        txHash,
      };
    } catch (err) {
      server.log.error(err, `Failed to deposit gold to guild ${guildId}`);
      reply.code(500);
      return { error: "Failed to deposit gold" };
    }
  });

  /**
   * POST /guild/:guildId/propose
   * Create a proposal (officers+ only).
   */
  server.post<{
    Params: { guildId: string };
    Body: {
      proposerAddress: string;
      proposalType: string;
      description: string;
      targetAddress?: string;
      targetAmount?: number;
    };
  }>("/guild/:guildId/propose", async (request, reply) => {
    const guildId = parseInt(request.params.guildId, 10);
    const { proposerAddress, proposalType, description, targetAddress, targetAmount } = request.body;

    if (!proposerAddress || !/^0x[a-fA-F0-9]{40}$/.test(proposerAddress)) {
      reply.code(400);
      return { error: "Invalid proposer address" };
    }

    const typeIndex = PROPOSAL_TYPE_NAMES.indexOf(proposalType);
    if (typeIndex === -1) {
      reply.code(400);
      return { error: "Invalid proposal type. Use: withdraw-gold, kick-member, promote-officer, demote-officer, disband-guild" };
    }

    try {
      const { proposalId, txHash } = await createProposalOnChain(
        guildId,
        proposerAddress,
        typeIndex,
        description,
        targetAddress || "0x0000000000000000000000000000000000000000",
        targetAmount || 0
      );

      server.log.info(`Proposal ${proposalId} created in guild ${guildId} by ${proposerAddress}`);

      return {
        ok: true,
        proposalId,
        guildId,
        proposalType,
        txHash,
      };
    } catch (err) {
      server.log.error(err, `Failed to create proposal in guild ${guildId}`);
      reply.code(500);
      return { error: "Failed to create proposal" };
    }
  });

  /**
   * POST /guild/:guildId/vote
   * Vote on a proposal (all members can vote).
   */
  server.post<{
    Params: { guildId: string };
    Body: { proposalId: number; voterAddress: string; vote: boolean };
  }>("/guild/:guildId/vote", async (request, reply) => {
    const guildId = parseInt(request.params.guildId, 10);
    const { proposalId, voterAddress, vote } = request.body;

    if (!voterAddress || !/^0x[a-fA-F0-9]{40}$/.test(voterAddress)) {
      reply.code(400);
      return { error: "Invalid voter address" };
    }

    try {
      const txHash = await voteOnProposalOnChain(proposalId, voterAddress, vote);

      server.log.info(`${voterAddress} voted ${vote ? "yes" : "no"} on proposal ${proposalId}`);

      return {
        ok: true,
        proposalId,
        vote,
        txHash,
      };
    } catch (err) {
      server.log.error(err, `Failed to vote on proposal ${proposalId}`);
      reply.code(500);
      return { error: "Failed to cast vote" };
    }
  });

  /**
   * GET /guild/:guildId/proposals
   * List all proposals for a guild.
   */
  server.get<{
    Params: { guildId: string };
    Querystring: { status?: string };
  }>("/guild/:guildId/proposals", async (request, reply) => {
    const guildId = parseInt(request.params.guildId, 10);
    const { status } = request.query;

    try {
      const nextId = await getNextProposalId();
      const proposals = [];

      for (let i = 0; i < nextId; i++) {
        const proposal = await getProposalFromChain(i);
        if (proposal.guildId !== guildId) continue;

        if (status) {
          const statusIndex = PROPOSAL_STATUS_NAMES.indexOf(status.toLowerCase());
          if (statusIndex !== -1 && proposal.status !== statusIndex) continue;
        }

        proposals.push(formatProposalForResponse(proposal));
      }

      return proposals;
    } catch (err) {
      server.log.error(err, `Failed to list proposals for guild ${guildId}`);
      reply.code(500);
      return { error: "Failed to list proposals" };
    }
  });

  /**
   * GET /guild/:guildId/proposal/:proposalId
   * Get proposal details.
   */
  server.get<{
    Params: { guildId: string; proposalId: string };
  }>("/guild/:guildId/proposal/:proposalId", async (request, reply) => {
    const guildId = parseInt(request.params.guildId, 10);
    const proposalId = parseInt(request.params.proposalId, 10);

    if (isNaN(proposalId) || proposalId < 0) {
      reply.code(400);
      return { error: "Invalid proposal ID" };
    }

    try {
      const proposal = await getProposalFromChain(proposalId);

      if (proposal.guildId !== guildId) {
        reply.code(404);
        return { error: "Proposal not found in this guild" };
      }

      return formatProposalForResponse(proposal);
    } catch (err) {
      server.log.error(err, `Failed to get proposal ${proposalId}`);
      reply.code(500);
      return { error: "Failed to get proposal details" };
    }
  });
}
