// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title WoGGuild — Guild DAOs for WoG MMORPG
/// @notice Decentralized guilds with shared treasuries, governance, and member management.
/// AI agents can form guilds, vote on proposals, and coordinate resources.
contract WoGGuild {
    enum GuildStatus { Active, Disbanded }
    enum MemberRank { Member, Officer, Founder }
    enum ProposalType { WithdrawGold, KickMember, PromoteOfficer, DemoteOfficer, DisbandGuild }
    enum ProposalStatus { Active, Passed, Failed, Executed, Cancelled }

    struct Guild {
        string name;
        string description;
        address founder;
        uint256 treasury;
        uint256 level;
        uint256 reputation;
        GuildStatus status;
        uint256 createdAt;
        uint256 memberCount;
    }

    struct Member {
        address memberAddress;
        MemberRank rank;
        uint256 joinedAt;
        uint256 contributedGold;
    }

    struct Proposal {
        uint256 guildId;
        address proposer;
        ProposalType proposalType;
        string description;
        uint256 createdAt;
        uint256 votingEndsAt;
        uint256 yesVotes;
        uint256 noVotes;
        ProposalStatus status;
        // Proposal-specific data
        address targetAddress;
        uint256 targetAmount;
    }

    uint256 public nextGuildId;
    uint256 public nextProposalId;
    uint256 constant MIN_GUILD_DEPOSIT = 100 ether; // 100 gold minimum
    uint256 constant GUILD_CREATION_FEE = 50 ether; // 50 gold creation fee (protocol revenue)
    uint256 constant VOTING_DURATION = 24 hours;
    uint256 public totalFeesCollected; // Track total protocol fees

    mapping(uint256 => Guild) public guilds;
    mapping(uint256 => mapping(address => Member)) public guildMembers;
    mapping(uint256 => address[]) public guildMemberList;
    mapping(address => uint256) public memberToGuild;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    address public owner;

    event GuildCreated(uint256 indexed guildId, string name, address indexed founder, uint256 initialDeposit);
    event MemberInvited(uint256 indexed guildId, address indexed member);
    event MemberJoined(uint256 indexed guildId, address indexed member);
    event MemberLeft(uint256 indexed guildId, address indexed member);
    event GoldDeposited(uint256 indexed guildId, address indexed member, uint256 amount);
    event ProposalCreated(uint256 indexed proposalId, uint256 indexed guildId, address indexed proposer, ProposalType proposalType);
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool vote);
    event ProposalExecuted(uint256 indexed proposalId, bool passed);
    event MemberPromoted(uint256 indexed guildId, address indexed member, MemberRank newRank);
    event MemberKicked(uint256 indexed guildId, address indexed member);
    event GuildDisbanded(uint256 indexed guildId);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Create a new guild. Server calls this on behalf of founder.
    /// Charges GUILD_CREATION_FEE (50 gold) as protocol fee + MIN_GUILD_DEPOSIT (100 gold) minimum.
    function createGuild(
        string calldata name,
        string calldata description,
        address founder,
        uint256 initialDeposit,
        uint256 creationFee
    ) external onlyOwner returns (uint256 guildId) {
        require(bytes(name).length > 0 && bytes(name).length <= 32, "Invalid name length");
        require(founder != address(0), "Invalid founder");
        require(initialDeposit >= MIN_GUILD_DEPOSIT, "Insufficient initial deposit");
        require(creationFee >= GUILD_CREATION_FEE, "Insufficient creation fee");
        require(memberToGuild[founder] == 0, "Already in a guild");

        // Track protocol fees
        totalFeesCollected += creationFee;

        guildId = nextGuildId++;
        Guild storage g = guilds[guildId];

        g.name = name;
        g.description = description;
        g.founder = founder;
        g.treasury = initialDeposit;
        g.level = 1;
        g.reputation = 0;
        g.status = GuildStatus.Active;
        g.createdAt = block.timestamp;
        g.memberCount = 1;

        // Add founder as member
        guildMembers[guildId][founder] = Member({
            memberAddress: founder,
            rank: MemberRank.Founder,
            joinedAt: block.timestamp,
            contributedGold: initialDeposit
        });

        guildMemberList[guildId].push(founder);
        memberToGuild[founder] = guildId;

        emit GuildCreated(guildId, name, founder, initialDeposit);
        emit MemberJoined(guildId, founder);
    }

    /// @notice Invite a member to the guild (officers+ only).
    function inviteMember(uint256 guildId, address member) external onlyOwner {
        Guild storage g = guilds[guildId];
        require(g.status == GuildStatus.Active, "Guild not active");
        require(member != address(0), "Invalid address");
        require(memberToGuild[member] == 0, "Already in a guild");

        emit MemberInvited(guildId, member);
    }

    /// @notice Join a guild (after being invited).
    function joinGuild(uint256 guildId, address member) external onlyOwner {
        Guild storage g = guilds[guildId];
        require(g.status == GuildStatus.Active, "Guild not active");
        require(member != address(0), "Invalid address");
        require(memberToGuild[member] == 0, "Already in a guild");
        require(guildMembers[guildId][member].memberAddress == address(0), "Already a member");

        guildMembers[guildId][member] = Member({
            memberAddress: member,
            rank: MemberRank.Member,
            joinedAt: block.timestamp,
            contributedGold: 0
        });

        guildMemberList[guildId].push(member);
        memberToGuild[member] = guildId;
        g.memberCount++;

        emit MemberJoined(guildId, member);
    }

    /// @notice Leave a guild voluntarily (founder cannot leave unless disbanding).
    function leaveGuild(uint256 guildId, address member) external onlyOwner {
        Guild storage g = guilds[guildId];
        require(memberToGuild[member] == guildId, "Not a member");
        require(guildMembers[guildId][member].rank != MemberRank.Founder, "Founder cannot leave");

        _removeMember(guildId, member);

        emit MemberLeft(guildId, member);
    }

    /// @notice Deposit gold into guild treasury.
    function depositGold(uint256 guildId, address member, uint256 amount) external onlyOwner {
        Guild storage g = guilds[guildId];
        require(g.status == GuildStatus.Active, "Guild not active");
        require(memberToGuild[member] == guildId, "Not a member");
        require(amount > 0, "Amount must be positive");

        g.treasury += amount;
        guildMembers[guildId][member].contributedGold += amount;

        emit GoldDeposited(guildId, member, amount);
    }

    /// @notice Create a proposal for guild action.
    function createProposal(
        uint256 guildId,
        address proposer,
        ProposalType proposalType,
        string calldata description,
        address targetAddress,
        uint256 targetAmount
    ) external onlyOwner returns (uint256 proposalId) {
        Guild storage g = guilds[guildId];
        require(g.status == GuildStatus.Active, "Guild not active");
        require(memberToGuild[proposer] == guildId, "Not a member");

        Member storage member = guildMembers[guildId][proposer];
        require(
            member.rank == MemberRank.Officer || member.rank == MemberRank.Founder,
            "Only officers can propose"
        );

        proposalId = nextProposalId++;
        Proposal storage p = proposals[proposalId];

        p.guildId = guildId;
        p.proposer = proposer;
        p.proposalType = proposalType;
        p.description = description;
        p.createdAt = block.timestamp;
        p.votingEndsAt = block.timestamp + VOTING_DURATION;
        p.status = ProposalStatus.Active;
        p.targetAddress = targetAddress;
        p.targetAmount = targetAmount;

        emit ProposalCreated(proposalId, guildId, proposer, proposalType);
    }

    /// @notice Vote on a proposal (all members can vote).
    function vote(uint256 proposalId, address voter, bool voteYes) external onlyOwner {
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.Active, "Proposal not active");
        require(memberToGuild[voter] == p.guildId, "Not a member");
        require(!hasVoted[proposalId][voter], "Already voted");
        require(block.timestamp < p.votingEndsAt, "Voting period ended");

        hasVoted[proposalId][voter] = true;

        if (voteYes) {
            p.yesVotes++;
        } else {
            p.noVotes++;
        }

        emit VoteCast(proposalId, voter, voteYes);
    }

    /// @notice Execute a proposal after voting ends (server calls this).
    function executeProposal(uint256 proposalId) external onlyOwner {
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.Active, "Proposal not active");
        require(block.timestamp >= p.votingEndsAt, "Voting still ongoing");

        Guild storage g = guilds[p.guildId];
        bool passed = p.yesVotes > p.noVotes;

        if (passed) {
            p.status = ProposalStatus.Executed;

            // Execute based on proposal type
            if (p.proposalType == ProposalType.WithdrawGold) {
                require(g.treasury >= p.targetAmount, "Insufficient treasury");
                g.treasury -= p.targetAmount;
                // Server will handle actual gold transfer off-chain
            } else if (p.proposalType == ProposalType.KickMember) {
                require(guildMembers[p.guildId][p.targetAddress].rank != MemberRank.Founder, "Cannot kick founder");
                _removeMember(p.guildId, p.targetAddress);
                emit MemberKicked(p.guildId, p.targetAddress);
            } else if (p.proposalType == ProposalType.PromoteOfficer) {
                Member storage member = guildMembers[p.guildId][p.targetAddress];
                require(member.memberAddress != address(0), "Not a member");
                require(member.rank == MemberRank.Member, "Already officer or founder");
                member.rank = MemberRank.Officer;
                emit MemberPromoted(p.guildId, p.targetAddress, MemberRank.Officer);
            } else if (p.proposalType == ProposalType.DemoteOfficer) {
                Member storage member = guildMembers[p.guildId][p.targetAddress];
                require(member.rank == MemberRank.Officer, "Not an officer");
                member.rank = MemberRank.Member;
                emit MemberPromoted(p.guildId, p.targetAddress, MemberRank.Member);
            } else if (p.proposalType == ProposalType.DisbandGuild) {
                g.status = GuildStatus.Disbanded;
                emit GuildDisbanded(p.guildId);
            }
        } else {
            p.status = ProposalStatus.Failed;
        }

        emit ProposalExecuted(proposalId, passed);
    }

    /// @notice Internal function to remove a member from guild.
    function _removeMember(uint256 guildId, address member) internal {
        Guild storage g = guilds[guildId];

        // Remove from member mapping
        delete guildMembers[guildId][member];
        delete memberToGuild[member];

        // Remove from member list
        address[] storage members = guildMemberList[guildId];
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i] == member) {
                members[i] = members[members.length - 1];
                members.pop();
                break;
            }
        }

        g.memberCount--;
    }

    /// @notice Get guild details.
    function getGuild(uint256 guildId) external view returns (
        string memory name,
        string memory description,
        address founder,
        uint256 treasury,
        uint256 level,
        uint256 reputation,
        GuildStatus status,
        uint256 createdAt,
        uint256 memberCount
    ) {
        Guild storage g = guilds[guildId];
        return (g.name, g.description, g.founder, g.treasury, g.level, g.reputation, g.status, g.createdAt, g.memberCount);
    }

    /// @notice Get member details.
    function getMember(uint256 guildId, address memberAddress) external view returns (
        MemberRank rank,
        uint256 joinedAt,
        uint256 contributedGold
    ) {
        Member storage m = guildMembers[guildId][memberAddress];
        return (m.rank, m.joinedAt, m.contributedGold);
    }

    /// @notice Get all members of a guild.
    function getGuildMembers(uint256 guildId) external view returns (address[] memory) {
        return guildMemberList[guildId];
    }

    /// @notice Get proposal details.
    function getProposal(uint256 proposalId) external view returns (
        uint256 guildId,
        address proposer,
        ProposalType proposalType,
        string memory description,
        uint256 createdAt,
        uint256 votingEndsAt,
        uint256 yesVotes,
        uint256 noVotes,
        ProposalStatus status,
        address targetAddress,
        uint256 targetAmount
    ) {
        Proposal storage p = proposals[proposalId];
        return (
            p.guildId,
            p.proposer,
            p.proposalType,
            p.description,
            p.createdAt,
            p.votingEndsAt,
            p.yesVotes,
            p.noVotes,
            p.status,
            p.targetAddress,
            p.targetAmount
        );
    }
}
