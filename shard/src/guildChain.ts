import { ethers } from "ethers";
import { biteWallet } from "./biteChain.js";

const GUILD_CONTRACT_ADDRESS = process.env.GUILD_CONTRACT_ADDRESS;

/** WoGGuild ABI — only the functions/events we interact with at runtime. */
const GUILD_ABI = [
  "function createGuild(string name, string description, address founder, uint256 initialDeposit, uint256 creationFee) returns (uint256)",
  "function inviteMember(uint256 guildId, address member)",
  "function joinGuild(uint256 guildId, address member)",
  "function leaveGuild(uint256 guildId, address member)",
  "function depositGold(uint256 guildId, address member, uint256 amount)",
  "function createProposal(uint256 guildId, address proposer, uint8 proposalType, string description, address targetAddress, uint256 targetAmount) returns (uint256)",
  "function vote(uint256 proposalId, address voter, bool voteYes)",
  "function executeProposal(uint256 proposalId)",
  "function getGuild(uint256 guildId) view returns (string name, string description, address founder, uint256 treasury, uint256 level, uint256 reputation, uint8 status, uint256 createdAt, uint256 memberCount)",
  "function getMember(uint256 guildId, address memberAddress) view returns (uint8 rank, uint256 joinedAt, uint256 contributedGold)",
  "function getGuildMembers(uint256 guildId) view returns (address[])",
  "function getProposal(uint256 proposalId) view returns (uint256 guildId, address proposer, uint8 proposalType, string description, uint256 createdAt, uint256 votingEndsAt, uint256 yesVotes, uint256 noVotes, uint8 status, address targetAddress, uint256 targetAmount)",
  "function nextGuildId() view returns (uint256)",
  "function nextProposalId() view returns (uint256)",
  "function memberToGuild(address member) view returns (uint256)",
  "event GuildCreated(uint256 indexed guildId, string name, address indexed founder, uint256 initialDeposit)",
  "event MemberJoined(uint256 indexed guildId, address indexed member)",
  "event MemberLeft(uint256 indexed guildId, address indexed member)",
  "event GoldDeposited(uint256 indexed guildId, address indexed member, uint256 amount)",
  "event ProposalCreated(uint256 indexed proposalId, uint256 indexed guildId, address indexed proposer, uint8 proposalType)",
  "event VoteCast(uint256 indexed proposalId, address indexed voter, bool vote)",
  "event ProposalExecuted(uint256 indexed proposalId, bool passed)",
  "event MemberKicked(uint256 indexed guildId, address indexed member)",
];

const guildContract = GUILD_CONTRACT_ADDRESS
  ? new ethers.Contract(GUILD_CONTRACT_ADDRESS, GUILD_ABI, biteWallet)
  : null;

// -- Types --

export enum GuildStatus {
  Active = 0,
  Disbanded = 1,
}

export enum MemberRank {
  Member = 0,
  Officer = 1,
  Founder = 2,
}

export enum ProposalType {
  WithdrawGold = 0,
  KickMember = 1,
  PromoteOfficer = 2,
  DemoteOfficer = 3,
  DisbandGuild = 4,
}

export enum ProposalStatus {
  Active = 0,
  Passed = 1,
  Failed = 2,
  Executed = 3,
  Cancelled = 4,
}

export interface GuildData {
  guildId: number;
  name: string;
  description: string;
  founder: string;
  treasury: number;
  level: number;
  reputation: number;
  status: GuildStatus;
  createdAt: number;
  memberCount: number;
}

export interface MemberData {
  address: string;
  rank: MemberRank;
  joinedAt: number;
  contributedGold: number;
}

export interface ProposalData {
  proposalId: number;
  guildId: number;
  proposer: string;
  proposalType: ProposalType;
  description: string;
  createdAt: number;
  votingEndsAt: number;
  yesVotes: number;
  noVotes: number;
  status: ProposalStatus;
  targetAddress: string;
  targetAmount: number;
}

// -- Contract interaction helpers --

/**
 * Create a new guild on the WoGGuild contract.
 * Requires 50 gold creation fee + 100+ gold initial deposit.
 */
export async function createGuildOnChain(
  name: string,
  description: string,
  founder: string,
  initialDeposit: number,
  creationFee: number
): Promise<{ guildId: number; txHash: string }> {
  if (!guildContract) throw new Error("Guild contract not initialized");

  const depositWei = ethers.parseUnits(initialDeposit.toString(), 18);
  const feeWei = ethers.parseUnits(creationFee.toString(), 18);

  const tx = await guildContract.createGuild(name, description, founder, depositWei, feeWei);
  const receipt = await tx.wait();

  // Parse GuildCreated event
  for (const log of receipt.logs) {
    try {
      const parsed = guildContract.interface.parseLog(log);
      if (parsed?.name === "GuildCreated") {
        return {
          guildId: Number(parsed.args.guildId),
          txHash: receipt.hash,
        };
      }
    } catch {
      // Not our event, skip
    }
  }

  throw new Error("GuildCreated event not found in receipt");
}

/**
 * Invite a member to the guild.
 */
export async function inviteMemberOnChain(guildId: number, member: string): Promise<string> {
  if (!guildContract) throw new Error("Guild contract not initialized");

  const tx = await guildContract.inviteMember(guildId, member);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Join a guild.
 */
export async function joinGuildOnChain(guildId: number, member: string): Promise<string> {
  if (!guildContract) throw new Error("Guild contract not initialized");

  const tx = await guildContract.joinGuild(guildId, member);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Leave a guild.
 */
export async function leaveGuildOnChain(guildId: number, member: string): Promise<string> {
  if (!guildContract) throw new Error("Guild contract not initialized");

  const tx = await guildContract.leaveGuild(guildId, member);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Deposit gold into guild treasury.
 */
export async function depositGoldOnChain(
  guildId: number,
  member: string,
  amount: number
): Promise<string> {
  if (!guildContract) throw new Error("Guild contract not initialized");

  const amountWei = ethers.parseUnits(amount.toString(), 18);

  const tx = await guildContract.depositGold(guildId, member, amountWei);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Create a proposal.
 */
export async function createProposalOnChain(
  guildId: number,
  proposer: string,
  proposalType: ProposalType,
  description: string,
  targetAddress: string,
  targetAmount: number
): Promise<{ proposalId: number; txHash: string }> {
  if (!guildContract) throw new Error("Guild contract not initialized");

  const amountWei = ethers.parseUnits(targetAmount.toString(), 18);

  const tx = await guildContract.createProposal(
    guildId,
    proposer,
    proposalType,
    description,
    targetAddress,
    amountWei
  );
  const receipt = await tx.wait();

  // Parse ProposalCreated event
  for (const log of receipt.logs) {
    try {
      const parsed = guildContract.interface.parseLog(log);
      if (parsed?.name === "ProposalCreated") {
        return {
          proposalId: Number(parsed.args.proposalId),
          txHash: receipt.hash,
        };
      }
    } catch {
      // Not our event, skip
    }
  }

  throw new Error("ProposalCreated event not found in receipt");
}

/**
 * Vote on a proposal.
 */
export async function voteOnProposalOnChain(
  proposalId: number,
  voter: string,
  voteYes: boolean
): Promise<string> {
  if (!guildContract) throw new Error("Guild contract not initialized");

  const tx = await guildContract.vote(proposalId, voter, voteYes);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Execute a proposal (after voting period ends).
 */
export async function executeProposalOnChain(proposalId: number): Promise<string> {
  if (!guildContract) throw new Error("Guild contract not initialized");

  const tx = await guildContract.executeProposal(proposalId);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Get guild details from contract.
 */
export async function getGuildFromChain(guildId: number): Promise<GuildData> {
  if (!guildContract) throw new Error("Guild contract not initialized");

  const [name, description, founder, treasury, level, reputation, status, createdAt, memberCount] =
    await guildContract.getGuild(guildId);

  return {
    guildId,
    name,
    description,
    founder,
    treasury: parseFloat(ethers.formatUnits(treasury, 18)),
    level: Number(level),
    reputation: Number(reputation),
    status: Number(status),
    createdAt: Number(createdAt),
    memberCount: Number(memberCount),
  };
}

/**
 * Get member details from contract.
 */
export async function getMemberFromChain(guildId: number, memberAddress: string): Promise<MemberData> {
  if (!guildContract) throw new Error("Guild contract not initialized");

  const [rank, joinedAt, contributedGold] = await guildContract.getMember(guildId, memberAddress);

  return {
    address: memberAddress,
    rank: Number(rank),
    joinedAt: Number(joinedAt),
    contributedGold: parseFloat(ethers.formatUnits(contributedGold, 18)),
  };
}

/**
 * Get all guild members from contract.
 */
export async function getGuildMembersFromChain(guildId: number): Promise<string[]> {
  if (!guildContract) throw new Error("Guild contract not initialized");

  return await guildContract.getGuildMembers(guildId);
}

/**
 * Get proposal details from contract.
 */
export async function getProposalFromChain(proposalId: number): Promise<ProposalData> {
  if (!guildContract) throw new Error("Guild contract not initialized");

  const [
    guildId,
    proposer,
    proposalType,
    description,
    createdAt,
    votingEndsAt,
    yesVotes,
    noVotes,
    status,
    targetAddress,
    targetAmount,
  ] = await guildContract.getProposal(proposalId);

  return {
    proposalId,
    guildId: Number(guildId),
    proposer,
    proposalType: Number(proposalType),
    description,
    createdAt: Number(createdAt),
    votingEndsAt: Number(votingEndsAt),
    yesVotes: Number(yesVotes),
    noVotes: Number(noVotes),
    status: Number(status),
    targetAddress,
    targetAmount: parseFloat(ethers.formatUnits(targetAmount, 18)),
  };
}

/**
 * Get next guild ID (total guilds created).
 */
export async function getNextGuildId(): Promise<number> {
  if (!guildContract) throw new Error("Guild contract not initialized");

  return Number(await guildContract.nextGuildId());
}

/**
 * Get next proposal ID (total proposals created).
 */
export async function getNextProposalId(): Promise<number> {
  if (!guildContract) throw new Error("Guild contract not initialized");

  return Number(await guildContract.nextProposalId());
}

/**
 * Get guild ID for a member address.
 */
export async function getMemberGuildId(memberAddress: string): Promise<number> {
  if (!guildContract) throw new Error("Guild contract not initialized");

  return Number(await guildContract.memberToGuild(memberAddress));
}
