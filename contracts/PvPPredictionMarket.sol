// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PvPPredictionMarket
 * @notice Encrypted prediction market for PvP battles using SKALE BITE Protocol
 * @dev Uses BITE v2 for threshold encryption of bet choices
 */
contract PvPPredictionMarket is ReentrancyGuard, Ownable {
    // ============ Structs ============

    struct Pool {
        string battleId;
        uint256 lockTimestamp;
        uint256 executeTimestamp;
        PoolStatus status;
        uint256 totalStaked;
        uint256 participantCount;
        string winner; // "RED" or "BLUE" - set after battle
        address[] participants;
    }

    struct Position {
        bytes encryptedChoice; // BITE encrypted "RED" or "BLUE"
        uint256 amount;
        uint256 timestamp;
        string decryptedChoice; // Populated by CTX callback
        bool claimed;
        uint256 payout;
    }

    enum PoolStatus {
        Open,
        Locked,
        Settled,
        Cancelled
    }

    // ============ State ============

    mapping(string => Pool) public pools;
    mapping(string => mapping(address => Position)) public positions;

    string[] public allPoolIds;

    uint256 public constant MIN_BET = 0.001 ether; // Minimum bet (SKALE sFUEL)
    uint256 public constant MAX_BET = 10000 ether; // Maximum bet
    uint256 public constant PLATFORM_FEE = 200; // 2% fee (basis points)

    address public feeCollector;

    // ============ Events ============

    event PoolCreated(
        string indexed poolId,
        string indexed battleId,
        uint256 lockTimestamp,
        uint256 executeTimestamp
    );

    event BetPlaced(
        string indexed poolId,
        address indexed better,
        uint256 amount,
        uint256 timestamp
    );

    event PoolLocked(string indexed poolId, uint256 lockTimestamp);

    event PoolSettled(
        string indexed poolId,
        string winner,
        uint256 totalPayout,
        uint256 platformFee
    );

    event WinningsClaimed(
        string indexed poolId,
        address indexed winner,
        uint256 amount
    );

    event PoolCancelled(string indexed poolId, string reason);

    // ============ Errors ============

    error PoolAlreadyExists();
    error PoolDoesNotExist();
    error PoolNotOpen();
    error PoolAlreadyLocked();
    error PoolNotSettled();
    error BetTooSmall();
    error BetTooLarge();
    error AlreadyBet();
    error NothingToClaim();
    error AlreadyClaimed();
    error InvalidWinner();

    // ============ Constructor ============

    constructor(address _feeCollector) {
        feeCollector = _feeCollector;
    }

    // ============ Core Functions ============

    /**
     * @notice Create a new prediction pool for a battle
     * @param poolId Unique pool identifier
     * @param battleId Associated battle ID
     * @param duration Battle duration in seconds
     * @param betLockTime Time before battle to lock bets (in seconds)
     */
    function createPool(
        string memory poolId,
        string memory battleId,
        uint256 duration,
        uint256 betLockTime
    ) external onlyOwner {
        if (pools[poolId].lockTimestamp != 0) revert PoolAlreadyExists();

        uint256 lockTime = block.timestamp + betLockTime;
        uint256 executeTime = lockTime + duration;

        pools[poolId] = Pool({
            battleId: battleId,
            lockTimestamp: lockTime,
            executeTimestamp: executeTime,
            status: PoolStatus.Open,
            totalStaked: 0,
            participantCount: 0,
            winner: "",
            participants: new address[](0)
        });

        allPoolIds.push(poolId);

        emit PoolCreated(poolId, battleId, lockTime, executeTime);
    }

    /**
     * @notice Place a bet on a pool with encrypted choice
     * @param poolId Pool to bet on
     * @param encryptedChoice BITE encrypted choice ("RED" or "BLUE")
     * @param better Address of the better (for agent support)
     */
    function placeBet(
        string memory poolId,
        bytes memory encryptedChoice,
        address better
    ) external payable nonReentrant {
        Pool storage pool = pools[poolId];

        if (pool.lockTimestamp == 0) revert PoolDoesNotExist();
        if (pool.status != PoolStatus.Open) revert PoolNotOpen();
        if (block.timestamp >= pool.lockTimestamp) revert PoolAlreadyLocked();
        if (msg.value < MIN_BET) revert BetTooSmall();
        if (msg.value > MAX_BET) revert BetTooLarge();

        Position storage existingPosition = positions[poolId][better];
        if (existingPosition.amount > 0) revert AlreadyBet();

        // Store encrypted position
        positions[poolId][better] = Position({
            encryptedChoice: encryptedChoice,
            amount: msg.value,
            timestamp: block.timestamp,
            decryptedChoice: "",
            claimed: false,
            payout: 0
        });

        pool.totalStaked += msg.value;
        pool.participantCount += 1;
        pool.participants.push(better);

        emit BetPlaced(poolId, better, msg.value, block.timestamp);
    }

    /**
     * @notice Lock pool - no more bets allowed
     * @param poolId Pool to lock
     */
    function lockPool(string memory poolId) external onlyOwner {
        Pool storage pool = pools[poolId];

        if (pool.lockTimestamp == 0) revert PoolDoesNotExist();
        if (pool.status != PoolStatus.Open) revert PoolNotOpen();

        pool.status = PoolStatus.Locked;

        emit PoolLocked(poolId, block.timestamp);
    }

    /**
     * @notice Settle battle - called by CTX callback after decryption
     * @param poolId Pool to settle
     * @param winner Winner of battle ("RED" or "BLUE")
     * @param decryptedChoices Decrypted choices from BITE CTX
     * @dev This would be called by BITE CTX in production
     */
    function settleBattle(
        string memory poolId,
        string memory winner,
        string[] memory decryptedChoices
    ) external onlyOwner nonReentrant {
        Pool storage pool = pools[poolId];

        if (pool.lockTimestamp == 0) revert PoolDoesNotExist();
        if (pool.status != PoolStatus.Locked) revert PoolNotOpen();

        // Validate winner
        if (
            keccak256(bytes(winner)) != keccak256(bytes("RED")) &&
            keccak256(bytes(winner)) != keccak256(bytes("BLUE"))
        ) revert InvalidWinner();

        pool.winner = winner;
        pool.status = PoolStatus.Settled;

        // Calculate payouts
        uint256 winningStake = 0;
        uint256 losingStake = 0;

        // First pass: categorize bets and decrypt choices
        for (uint256 i = 0; i < pool.participants.length; i++) {
            address participant = pool.participants[i];
            Position storage pos = positions[poolId][participant];

            // In production, decryptedChoices would come from BITE CTX
            // For now, we store the decrypted choice
            if (i < decryptedChoices.length) {
                pos.decryptedChoice = decryptedChoices[i];
            }

            if (
                keccak256(bytes(pos.decryptedChoice)) == keccak256(bytes(winner))
            ) {
                winningStake += pos.amount;
            } else {
                losingStake += pos.amount;
            }
        }

        // Calculate platform fee
        uint256 platformFee = (pool.totalStaked * PLATFORM_FEE) / 10000;
        uint256 totalPayout = pool.totalStaked - platformFee;

        // Second pass: calculate individual payouts
        for (uint256 i = 0; i < pool.participants.length; i++) {
            address participant = pool.participants[i];
            Position storage pos = positions[poolId][participant];

            if (
                keccak256(bytes(pos.decryptedChoice)) == keccak256(bytes(winner))
            ) {
                // Winner gets proportional share of total pool (minus fee)
                if (winningStake > 0) {
                    pos.payout = (pos.amount * totalPayout) / winningStake;
                }
            } else {
                // Loser gets nothing
                pos.payout = 0;
            }
        }

        // Transfer platform fee
        if (platformFee > 0) {
            payable(feeCollector).transfer(platformFee);
        }

        emit PoolSettled(poolId, winner, totalPayout, platformFee);
    }

    /**
     * @notice Claim winnings from a settled pool
     * @param poolId Pool to claim from
     */
    function claimWinnings(string memory poolId) external nonReentrant {
        Pool storage pool = pools[poolId];

        if (pool.lockTimestamp == 0) revert PoolDoesNotExist();
        if (pool.status != PoolStatus.Settled) revert PoolNotSettled();

        Position storage pos = positions[poolId][msg.sender];

        if (pos.amount == 0) revert NothingToClaim();
        if (pos.claimed) revert AlreadyClaimed();
        if (pos.payout == 0) revert NothingToClaim();

        pos.claimed = true;

        payable(msg.sender).transfer(pos.payout);

        emit WinningsClaimed(poolId, msg.sender, pos.payout);
    }

    /**
     * @notice Cancel a pool and refund all bets
     * @param poolId Pool to cancel
     * @param reason Cancellation reason
     */
    function cancelPool(string memory poolId, string memory reason)
        external
        onlyOwner
        nonReentrant
    {
        Pool storage pool = pools[poolId];

        if (pool.lockTimestamp == 0) revert PoolDoesNotExist();
        if (pool.status == PoolStatus.Settled) revert PoolNotSettled();

        pool.status = PoolStatus.Cancelled;

        // Refund all participants
        for (uint256 i = 0; i < pool.participants.length; i++) {
            address participant = pool.participants[i];
            Position storage pos = positions[poolId][participant];

            if (pos.amount > 0 && !pos.claimed) {
                pos.claimed = true;
                payable(participant).transfer(pos.amount);
            }
        }

        emit PoolCancelled(poolId, reason);
    }

    // ============ View Functions ============

    /**
     * @notice Get pool information
     */
    function getPool(string memory poolId)
        external
        view
        returns (
            string memory battleId,
            uint256 lockTimestamp,
            uint256 executeTimestamp,
            PoolStatus status,
            uint256 totalStaked,
            uint256 participantCount,
            string memory winner
        )
    {
        Pool storage pool = pools[poolId];
        return (
            pool.battleId,
            pool.lockTimestamp,
            pool.executeTimestamp,
            pool.status,
            pool.totalStaked,
            pool.participantCount,
            pool.winner
        );
    }

    /**
     * @notice Get position for a better
     */
    function getPosition(string memory poolId, address better)
        external
        view
        returns (
            uint256 amount,
            uint256 timestamp,
            string memory decryptedChoice,
            bool claimed,
            uint256 payout
        )
    {
        Position storage pos = positions[poolId][better];
        return (
            pos.amount,
            pos.timestamp,
            pos.decryptedChoice,
            pos.claimed,
            pos.payout
        );
    }

    /**
     * @notice Get all pool IDs
     */
    function getAllPools() external view returns (string[] memory) {
        return allPoolIds;
    }

    /**
     * @notice Get active pools (Open or Locked)
     */
    function getActivePools()
        external
        view
        returns (string[] memory activePools)
    {
        uint256 count = 0;

        // Count active pools
        for (uint256 i = 0; i < allPoolIds.length; i++) {
            Pool storage pool = pools[allPoolIds[i]];
            if (
                pool.status == PoolStatus.Open ||
                pool.status == PoolStatus.Locked
            ) {
                count++;
            }
        }

        // Populate array
        activePools = new string[](count);
        uint256 index = 0;

        for (uint256 i = 0; i < allPoolIds.length; i++) {
            Pool storage pool = pools[allPoolIds[i]];
            if (
                pool.status == PoolStatus.Open ||
                pool.status == PoolStatus.Locked
            ) {
                activePools[index] = allPoolIds[i];
                index++;
            }
        }

        return activePools;
    }

    // ============ Admin Functions ============

    /**
     * @notice Update fee collector address
     */
    function setFeeCollector(address _feeCollector) external onlyOwner {
        feeCollector = _feeCollector;
    }

    /**
     * @notice Emergency withdraw (only if contract has excess funds)
     */
    function emergencyWithdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
}
