import { isPostgresConfigured, postgresQuery } from "./postgres.js";
import type { GuildData, MemberData, ProposalData } from "../economy/guildChain.js";

interface GuildRow {
  guild_id: string;
  name: string;
  description: string;
  founder_wallet: string;
  treasury: string;
  level: number;
  reputation: number;
  status: number;
  created_at_sec: number;
  member_count: number;
}

interface MemberRow {
  guild_id: string;
  member_wallet: string;
  rank: number;
  joined_at_sec: number;
  contributed_gold: string;
}

interface ProposalRow {
  proposal_id: string;
  guild_id: string;
  proposer_wallet: string;
  proposal_type: number;
  description: string;
  created_at_sec: number;
  voting_ends_at_sec: number;
  yes_votes: number;
  no_votes: number;
  status: number;
  target_address: string;
  target_amount: string;
}

function mapGuildRow(row: GuildRow): GuildData {
  return {
    guildId: Number(row.guild_id),
    name: row.name,
    description: row.description,
    founder: row.founder_wallet,
    treasury: Number(row.treasury),
    level: row.level,
    reputation: row.reputation,
    status: row.status,
    createdAt: row.created_at_sec,
    memberCount: row.member_count,
  };
}

function mapMemberRow(row: MemberRow): MemberData {
  return {
    address: row.member_wallet,
    rank: row.rank,
    joinedAt: row.joined_at_sec,
    contributedGold: Number(row.contributed_gold),
  };
}

function mapProposalRow(row: ProposalRow): ProposalData {
  return {
    proposalId: Number(row.proposal_id),
    guildId: Number(row.guild_id),
    proposer: row.proposer_wallet,
    proposalType: row.proposal_type,
    description: row.description,
    createdAt: row.created_at_sec,
    votingEndsAt: row.voting_ends_at_sec,
    yesVotes: row.yes_votes,
    noVotes: row.no_votes,
    status: row.status,
    targetAddress: row.target_address,
    targetAmount: Number(row.target_amount),
  };
}

export async function upsertGuild(guild: GuildData): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.guilds (
      guild_id, name, description, founder_wallet, treasury,
      level, reputation, status, created_at_sec, member_count, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
    on conflict (guild_id) do update set
      name = excluded.name,
      description = excluded.description,
      founder_wallet = excluded.founder_wallet,
      treasury = excluded.treasury,
      level = excluded.level,
      reputation = excluded.reputation,
      status = excluded.status,
      created_at_sec = excluded.created_at_sec,
      member_count = excluded.member_count,
      updated_at = now()`,
    [
      guild.guildId,
      guild.name,
      guild.description,
      guild.founder.toLowerCase(),
      guild.treasury,
      guild.level,
      guild.reputation,
      guild.status,
      guild.createdAt,
      guild.memberCount,
    ]
  );
}

export async function getGuild(guildId: number): Promise<GuildData | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<GuildRow>(
    `select guild_id::text, name, description, founder_wallet, treasury::text,
            level, reputation, status, created_at_sec, member_count
       from game.guilds where guild_id = $1 limit 1`,
    [guildId]
  );
  return rows[0] ? mapGuildRow(rows[0]) : null;
}

export async function listGuilds(): Promise<GuildData[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<GuildRow>(
    `select guild_id::text, name, description, founder_wallet, treasury::text,
            level, reputation, status, created_at_sec, member_count
       from game.guilds
      order by guild_id asc`
  );
  return rows.map(mapGuildRow);
}

export async function upsertGuildMember(guildId: number, member: MemberData): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.guild_memberships (
      guild_id, member_wallet, rank, joined_at_sec, contributed_gold, updated_at
    ) values ($1,$2,$3,$4,$5,now())
    on conflict (guild_id, member_wallet) do update set
      rank = excluded.rank,
      joined_at_sec = excluded.joined_at_sec,
      contributed_gold = excluded.contributed_gold,
      updated_at = now()`,
    [guildId, member.address.toLowerCase(), member.rank, member.joinedAt, member.contributedGold]
  );
}

export async function removeGuildMember(guildId: number, memberWallet: string): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `delete from game.guild_memberships where guild_id = $1 and member_wallet = $2`,
    [guildId, memberWallet.toLowerCase()]
  );
}

export async function getGuildMember(guildId: number, memberWallet: string): Promise<MemberData | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<MemberRow>(
    `select guild_id::text, member_wallet, rank, joined_at_sec, contributed_gold::text
       from game.guild_memberships
      where guild_id = $1 and member_wallet = $2
      limit 1`,
    [guildId, memberWallet.toLowerCase()]
  );
  return rows[0] ? mapMemberRow(rows[0]) : null;
}

export async function listGuildMembers(guildId: number): Promise<string[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{ member_wallet: string }>(
    `select member_wallet from game.guild_memberships where guild_id = $1 order by joined_at_sec asc`,
    [guildId]
  );
  return rows.map((row) => row.member_wallet);
}

export async function getMemberGuildIdFromProjection(memberWallet: string): Promise<number> {
  if (!isPostgresConfigured()) return 0;
  const { rows } = await postgresQuery<{ guild_id: string }>(
    `select guild_id::text from game.guild_memberships where member_wallet = $1 limit 1`,
    [memberWallet.toLowerCase()]
  );
  return Number(rows[0]?.guild_id ?? "0");
}

export async function upsertGuildProposal(proposal: ProposalData): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.guild_proposals (
      proposal_id, guild_id, proposer_wallet, proposal_type, description,
      created_at_sec, voting_ends_at_sec, yes_votes, no_votes, status,
      target_address, target_amount, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
    on conflict (proposal_id) do update set
      guild_id = excluded.guild_id,
      proposer_wallet = excluded.proposer_wallet,
      proposal_type = excluded.proposal_type,
      description = excluded.description,
      created_at_sec = excluded.created_at_sec,
      voting_ends_at_sec = excluded.voting_ends_at_sec,
      yes_votes = excluded.yes_votes,
      no_votes = excluded.no_votes,
      status = excluded.status,
      target_address = excluded.target_address,
      target_amount = excluded.target_amount,
      updated_at = now()`,
    [
      proposal.proposalId,
      proposal.guildId,
      proposal.proposer.toLowerCase(),
      proposal.proposalType,
      proposal.description,
      proposal.createdAt,
      proposal.votingEndsAt,
      proposal.yesVotes,
      proposal.noVotes,
      proposal.status,
      proposal.targetAddress.toLowerCase(),
      proposal.targetAmount,
    ]
  );
}

export async function getGuildProposal(proposalId: number): Promise<ProposalData | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<ProposalRow>(
    `select proposal_id::text, guild_id::text, proposer_wallet, proposal_type, description,
            created_at_sec, voting_ends_at_sec, yes_votes, no_votes, status,
            target_address, target_amount::text
       from game.guild_proposals where proposal_id = $1 limit 1`,
    [proposalId]
  );
  return rows[0] ? mapProposalRow(rows[0]) : null;
}

export async function listGuildProposals(guildId?: number): Promise<ProposalData[]> {
  if (!isPostgresConfigured()) return [];
  const values: unknown[] = [];
  const where = typeof guildId === "number" ? (values.push(guildId), `where guild_id = $1`) : "";
  const { rows } = await postgresQuery<ProposalRow>(
    `select proposal_id::text, guild_id::text, proposer_wallet, proposal_type, description,
            created_at_sec, voting_ends_at_sec, yes_votes, no_votes, status,
            target_address, target_amount::text
       from game.guild_proposals
       ${where}
      order by proposal_id asc`,
    values
  );
  return rows.map(mapProposalRow);
}
