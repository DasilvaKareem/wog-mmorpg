import { ethers } from "ethers";
import { biteWallet } from "../blockchain/biteChain.js";
import { queueBiteTransaction } from "../blockchain/biteTxQueue.js";
import {
  executeRegisteredChainOperation,
  registerChainOperationProcessor,
  type ChainOperationRecord,
} from "../blockchain/chainOperationStore.js";

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

function ensureGuildContract(): ethers.Contract {
  if (!guildContract) throw new Error("Guild contract not initialized");
  return guildContract;
}

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
  return executeRegisteredChainOperation("guild-create", `${founder.toLowerCase()}:${name.toLowerCase()}`, {
    name, description, founder, initialDeposit, creationFee
  });
}
async function processGuildCreate(record: ChainOperationRecord): Promise<{ result: { guildId: number; txHash: string }; txHash: string }> {
  const payload = JSON.parse(record.payload) as { name: string; description: string; founder: string; initialDeposit: number; creationFee: number };
  const contract = ensureGuildContract();
  const depositWei = ethers.parseUnits(payload.initialDeposit.toString(), 18);
  const feeWei = ethers.parseUnits(payload.creationFee.toString(), 18);
  const receipt = await queueBiteTransaction(`guild-create:${payload.founder}:${payload.name}`, async () => {
    const tx = await contract.createGuild(payload.name, payload.description, payload.founder, depositWei, feeWei);
    return tx.wait();
  });
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "GuildCreated") {
        return { result: { guildId: Number(parsed.args.guildId), txHash: receipt.hash }, txHash: receipt.hash };
      }
    } catch {}
  }
  throw new Error("GuildCreated event not found in receipt");
}
registerChainOperationProcessor("guild-create", processGuildCreate);

/**
 * Invite a member to the guild.
 */
export async function inviteMemberOnChain(guildId: number, member: string): Promise<string> {
  return executeRegisteredChainOperation("guild-invite", `${guildId}:${member.toLowerCase()}`, { guildId, member });
}
registerChainOperationProcessor("guild-invite", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as { guildId: number; member: string };
  const receipt = await queueBiteTransaction(`guild-invite:${payload.guildId}:${payload.member}`, async () => {
    const tx = await ensureGuildContract().inviteMember(payload.guildId, payload.member);
    return tx.wait();
  });
  return { result: receipt.hash, txHash: receipt.hash };
});

/**
 * Join a guild.
 */
export async function joinGuildOnChain(guildId: number, member: string): Promise<string> {
  return executeRegisteredChainOperation("guild-join", `${guildId}:${member.toLowerCase()}`, { guildId, member });
}
registerChainOperationProcessor("guild-join", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as { guildId: number; member: string };
  const receipt = await queueBiteTransaction(`guild-join:${payload.guildId}:${payload.member}`, async () => {
    const tx = await ensureGuildContract().joinGuild(payload.guildId, payload.member);
    return tx.wait();
  });
  return { result: receipt.hash, txHash: receipt.hash };
});

/**
 * Leave a guild.
 */
export async function leaveGuildOnChain(guildId: number, member: string): Promise<string> {
  return executeRegisteredChainOperation("guild-leave", `${guildId}:${member.toLowerCase()}`, { guildId, member });
}
registerChainOperationProcessor("guild-leave", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as { guildId: number; member: string };
  const receipt = await queueBiteTransaction(`guild-leave:${payload.guildId}:${payload.member}`, async () => {
    const tx = await ensureGuildContract().leaveGuild(payload.guildId, payload.member);
    return tx.wait();
  });
  return { result: receipt.hash, txHash: receipt.hash };
});

/**
 * Deposit gold into guild treasury.
 */
export async function depositGoldOnChain(
  guildId: number,
  member: string,
  amount: number
): Promise<string> {
  return executeRegisteredChainOperation("guild-deposit", `${guildId}:${member.toLowerCase()}:${amount}`, { guildId, member, amount });
}
registerChainOperationProcessor("guild-deposit", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as { guildId: number; member: string; amount: number };
  const amountWei = ethers.parseUnits(payload.amount.toString(), 18);
  const receipt = await queueBiteTransaction(`guild-deposit:${payload.guildId}:${payload.member}`, async () => {
    const tx = await ensureGuildContract().depositGold(payload.guildId, payload.member, amountWei);
    return tx.wait();
  });
  return { result: receipt.hash, txHash: receipt.hash };
});

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
  return executeRegisteredChainOperation("guild-proposal", `${guildId}:${proposer.toLowerCase()}:${proposalType}`, {
    guildId, proposer, proposalType, description, targetAddress, targetAmount
  });
}
registerChainOperationProcessor("guild-proposal", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as {
    guildId: number; proposer: string; proposalType: ProposalType; description: string; targetAddress: string; targetAmount: number;
  };
  const amountWei = ethers.parseUnits(payload.targetAmount.toString(), 18);
  const contract = ensureGuildContract();
  const receipt = await queueBiteTransaction(`guild-proposal:${payload.guildId}:${payload.proposer}`, async () => {
    const tx = await contract.createProposal(
      payload.guildId,
      payload.proposer,
      payload.proposalType,
      payload.description,
      payload.targetAddress,
      amountWei
    );
    return tx.wait();
  });
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "ProposalCreated") {
        return { result: { proposalId: Number(parsed.args.proposalId), txHash: receipt.hash }, txHash: receipt.hash };
      }
    } catch {}
  }
  throw new Error("ProposalCreated event not found in receipt");
});

/**
 * Vote on a proposal.
 */
export async function voteOnProposalOnChain(
  proposalId: number,
  voter: string,
  voteYes: boolean
): Promise<string> {
  return executeRegisteredChainOperation("guild-vote", `${proposalId}:${voter.toLowerCase()}:${voteYes}`, { proposalId, voter, voteYes });
}
registerChainOperationProcessor("guild-vote", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as { proposalId: number; voter: string; voteYes: boolean };
  const receipt = await queueBiteTransaction(`guild-vote:${payload.proposalId}:${payload.voter}`, async () => {
    const tx = await ensureGuildContract().vote(payload.proposalId, payload.voter, payload.voteYes);
    return tx.wait();
  });
  return { result: receipt.hash, txHash: receipt.hash };
});

/**
 * Execute a proposal (after voting period ends).
 */
export async function executeProposalOnChain(proposalId: number): Promise<string> {
  return executeRegisteredChainOperation("guild-execute", String(proposalId), { proposalId });
}
registerChainOperationProcessor("guild-execute", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as { proposalId: number };
  const receipt = await queueBiteTransaction(`guild-execute:${payload.proposalId}`, async () => {
    const tx = await ensureGuildContract().executeProposal(payload.proposalId);
    return tx.wait();
  });
  return { result: receipt.hash, txHash: receipt.hash };
});

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

// --- Guild name cache (refreshed periodically, used by entity serialization) ---

const guildNameCache = new Map<string, string>(); // walletAddress (lowercase) → guild name
let cacheRefreshing = false;

/** Get cached guild name for a wallet address (returns undefined if not in a guild). */
export function getCachedGuildName(walletAddress: string): string | undefined {
  return guildNameCache.get(walletAddress.toLowerCase());
}

/** Refresh the guild name cache by scanning all active guilds. */
export async function refreshGuildNameCache(): Promise<void> {
  if (!guildContract || cacheRefreshing) return;
  cacheRefreshing = true;

  try {
    // Verify contract is actually deployed before calling methods
    const provider = guildContract.runner?.provider;
    if (provider && GUILD_CONTRACT_ADDRESS) {
      const code = await provider.getCode(GUILD_CONTRACT_ADDRESS);
      if (!code || code === "0x") {
        console.warn(`[guild-cache] No contract deployed at ${GUILD_CONTRACT_ADDRESS} — skipping refresh`);
        return;
      }
    }

    const nextId = Number(await guildContract.nextGuildId());
    const newCache = new Map<string, string>();

    // Read all guilds in parallel for faster refresh
    const guildIds = Array.from({ length: nextId - 1 }, (_, i) => i + 1);
    const results = await Promise.all(
      guildIds.map(async (guildId) => {
        try {
          const [name, , , , , , status, ,] = await guildContract!.getGuild(guildId);
          if (Number(status) !== GuildStatus.Active) return null;
          const members: string[] = await guildContract!.getGuildMembers(guildId);
          return { name, members };
        } catch {
          return null;
        }
      })
    );

    for (const result of results) {
      if (!result) continue;
      for (const addr of result.members) {
        newCache.set(addr.toLowerCase(), result.name);
      }
    }

    guildNameCache.clear();
    for (const [k, v] of newCache) guildNameCache.set(k, v);
  } catch (err) {
    console.error("[guild-cache] Failed to refresh guild name cache:", err);
  } finally {
    cacheRefreshing = false;
  }
}

/** Start periodic guild cache refresh (call once at server boot). */
export function startGuildNameCacheRefresh(intervalMs = 300_000): void {
  // Initial load
  refreshGuildNameCache().catch(() => {});
  setInterval(() => refreshGuildNameCache().catch(() => {}), intervalMs);
}
