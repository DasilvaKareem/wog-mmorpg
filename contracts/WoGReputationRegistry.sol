// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title WoGReputationRegistry
 * @notice ERC-8004 compliant Reputation Registry for WoG MMORPG
 * @dev Tracks multi-dimensional reputation scores for characters
 */
contract WoGReputationRegistry is Ownable {
    // ============ Enums ============

    enum ReputationCategory {
        Combat,      // PvP/PvE performance
        Economic,    // Trading, market activity
        Social,      // Guild, community participation
        Crafting,    // Item creation, quality
        Agent        // AI agent behavior (if applicable)
    }

    // ============ Structs ============

    struct ReputationScore {
        uint256 combat;
        uint256 economic;
        uint256 social;
        uint256 crafting;
        uint256 agent;
        uint256 overall;
        uint256 lastUpdated;
    }

    struct ReputationFeedback {
        address submitter;
        uint256 identityId;
        ReputationCategory category;
        int256 delta; // Can be positive or negative
        string reason;
        uint256 timestamp;
        bool validated;
    }

    // ============ State ============

    // identityId => ReputationScore
    mapping(uint256 => ReputationScore) public reputations;

    // Feedback history
    ReputationFeedback[] public feedbackHistory;

    // identityId => feedback indices
    mapping(uint256 => uint256[]) public identityFeedback;

    // Authorized reporters (contracts that can submit reputation updates)
    mapping(address => bool) public authorizedReporters;

    // Category weights for overall score calculation (in basis points, total = 10000)
    mapping(ReputationCategory => uint256) public categoryWeights;

    // Max/min score bounds
    uint256 public constant MAX_SCORE = 1000;
    uint256 public constant MIN_SCORE = 0;
    uint256 public constant DEFAULT_SCORE = 500; // Start at middle

    // ============ Events ============

    event ReputationUpdated(
        uint256 indexed identityId,
        ReputationCategory category,
        uint256 newScore,
        int256 delta
    );

    event FeedbackSubmitted(
        uint256 indexed feedbackId,
        uint256 indexed identityId,
        address indexed submitter,
        ReputationCategory category,
        int256 delta
    );

    event ReporterAuthorized(address indexed reporter);
    event ReporterRevoked(address indexed reporter);

    // ============ Errors ============

    error Unauthorized();
    error InvalidScore();
    error InvalidDelta();

    // ============ Constructor ============

    constructor() {
        // Set default category weights (can be adjusted)
        categoryWeights[ReputationCategory.Combat] = 3000;    // 30%
        categoryWeights[ReputationCategory.Economic] = 2500;  // 25%
        categoryWeights[ReputationCategory.Social] = 2000;    // 20%
        categoryWeights[ReputationCategory.Crafting] = 1500;  // 15%
        categoryWeights[ReputationCategory.Agent] = 1000;     // 10%

        // Owner is authorized by default
        authorizedReporters[msg.sender] = true;
    }

    // ============ Core Functions ============

    /**
     * @notice Initialize reputation for a new identity
     * @param identityId Identity to initialize
     */
    function initializeReputation(uint256 identityId) external {
        if (!authorizedReporters[msg.sender]) revert Unauthorized();

        // Only initialize if not already initialized
        if (reputations[identityId].lastUpdated == 0) {
            reputations[identityId] = ReputationScore({
                combat: DEFAULT_SCORE,
                economic: DEFAULT_SCORE,
                social: DEFAULT_SCORE,
                crafting: DEFAULT_SCORE,
                agent: DEFAULT_SCORE,
                overall: DEFAULT_SCORE,
                lastUpdated: block.timestamp
            });
        }
    }

    /**
     * @notice Submit reputation feedback
     * @param identityId Identity receiving feedback
     * @param category Reputation category
     * @param delta Change in reputation (positive or negative)
     * @param reason Human-readable reason
     */
    function submitFeedback(
        uint256 identityId,
        ReputationCategory category,
        int256 delta,
        string memory reason
    ) external {
        if (!authorizedReporters[msg.sender]) revert Unauthorized();

        // Create feedback record
        uint256 feedbackId = feedbackHistory.length;
        feedbackHistory.push(
            ReputationFeedback({
                submitter: msg.sender,
                identityId: identityId,
                category: category,
                delta: delta,
                reason: reason,
                timestamp: block.timestamp,
                validated: true // Auto-validated from authorized reporters
            })
        );

        identityFeedback[identityId].push(feedbackId);

        // Update reputation score
        _updateReputationScore(identityId, category, delta);

        emit FeedbackSubmitted(feedbackId, identityId, msg.sender, category, delta);
    }

    /**
     * @notice Batch update multiple categories at once
     * @param identityId Identity to update
     * @param deltas Array of deltas (indexed by category enum)
     * @param reason Reason for update
     */
    function batchUpdateReputation(
        uint256 identityId,
        int256[5] memory deltas,
        string memory reason
    ) external {
        if (!authorizedReporters[msg.sender]) revert Unauthorized();

        for (uint256 i = 0; i < 5; i++) {
            if (deltas[i] != 0) {
                ReputationCategory category = ReputationCategory(i);
                _updateReputationScore(identityId, category, deltas[i]);

                // Record feedback
                uint256 feedbackId = feedbackHistory.length;
                feedbackHistory.push(
                    ReputationFeedback({
                        submitter: msg.sender,
                        identityId: identityId,
                        category: category,
                        delta: deltas[i],
                        reason: reason,
                        timestamp: block.timestamp,
                        validated: true
                    })
                );
                identityFeedback[identityId].push(feedbackId);
            }
        }
    }

    /**
     * @notice Internal function to update reputation score
     * @param identityId Identity to update
     * @param category Category to update
     * @param delta Change amount
     */
    function _updateReputationScore(
        uint256 identityId,
        ReputationCategory category,
        int256 delta
    ) internal {
        ReputationScore storage rep = reputations[identityId];

        // Get current score for category
        uint256 currentScore;
        if (category == ReputationCategory.Combat) {
            currentScore = rep.combat;
        } else if (category == ReputationCategory.Economic) {
            currentScore = rep.economic;
        } else if (category == ReputationCategory.Social) {
            currentScore = rep.social;
        } else if (category == ReputationCategory.Crafting) {
            currentScore = rep.crafting;
        } else if (category == ReputationCategory.Agent) {
            currentScore = rep.agent;
        }

        // Calculate new score (with bounds checking)
        uint256 newScore;
        if (delta >= 0) {
            uint256 increase = uint256(delta);
            newScore = currentScore + increase;
            if (newScore > MAX_SCORE) {
                newScore = MAX_SCORE;
            }
        } else {
            uint256 decrease = uint256(-delta);
            if (decrease > currentScore) {
                newScore = MIN_SCORE;
            } else {
                newScore = currentScore - decrease;
            }
        }

        // Update category score
        if (category == ReputationCategory.Combat) {
            rep.combat = newScore;
        } else if (category == ReputationCategory.Economic) {
            rep.economic = newScore;
        } else if (category == ReputationCategory.Social) {
            rep.social = newScore;
        } else if (category == ReputationCategory.Crafting) {
            rep.crafting = newScore;
        } else if (category == ReputationCategory.Agent) {
            rep.agent = newScore;
        }

        // Recalculate overall score
        rep.overall = _calculateOverallScore(rep);
        rep.lastUpdated = block.timestamp;

        emit ReputationUpdated(identityId, category, newScore, delta);
    }

    /**
     * @notice Calculate weighted overall score
     * @param rep Reputation scores
     * @return uint256 Overall score (0-1000)
     */
    function _calculateOverallScore(ReputationScore memory rep)
        internal
        view
        returns (uint256)
    {
        uint256 weightedSum = 0;
        weightedSum += rep.combat * categoryWeights[ReputationCategory.Combat];
        weightedSum += rep.economic * categoryWeights[ReputationCategory.Economic];
        weightedSum += rep.social * categoryWeights[ReputationCategory.Social];
        weightedSum += rep.crafting * categoryWeights[ReputationCategory.Crafting];
        weightedSum += rep.agent * categoryWeights[ReputationCategory.Agent];

        // Divide by 10000 (total basis points)
        return weightedSum / 10000;
    }

    // ============ View Functions ============

    /**
     * @notice Get reputation score for an identity
     * @param identityId Identity to query
     * @return ReputationScore
     */
    function getReputation(uint256 identityId)
        external
        view
        returns (ReputationScore memory)
    {
        return reputations[identityId];
    }

    /**
     * @notice Get specific category score
     * @param identityId Identity to query
     * @param category Category to query
     * @return uint256 Score
     */
    function getCategoryScore(uint256 identityId, ReputationCategory category)
        external
        view
        returns (uint256)
    {
        ReputationScore memory rep = reputations[identityId];
        if (category == ReputationCategory.Combat) return rep.combat;
        if (category == ReputationCategory.Economic) return rep.economic;
        if (category == ReputationCategory.Social) return rep.social;
        if (category == ReputationCategory.Crafting) return rep.crafting;
        if (category == ReputationCategory.Agent) return rep.agent;
        return 0;
    }

    /**
     * @notice Get feedback history for an identity
     * @param identityId Identity to query
     * @return Array of feedback indices
     */
    function getIdentityFeedback(uint256 identityId)
        external
        view
        returns (uint256[] memory)
    {
        return identityFeedback[identityId];
    }

    /**
     * @notice Get feedback details
     * @param feedbackId Feedback index
     * @return ReputationFeedback
     */
    function getFeedback(uint256 feedbackId)
        external
        view
        returns (ReputationFeedback memory)
    {
        return feedbackHistory[feedbackId];
    }

    /**
     * @notice Get reputation rank name
     * @param score Overall score
     * @return string Rank name
     */
    function getRankName(uint256 score) external pure returns (string memory) {
        if (score >= 900) return "Legendary Hero";
        if (score >= 800) return "Renowned Champion";
        if (score >= 700) return "Trusted Veteran";
        if (score >= 600) return "Reliable Ally";
        if (score >= 500) return "Average Citizen";
        if (score >= 400) return "Questionable";
        if (score >= 300) return "Untrustworthy";
        return "Notorious";
    }

    // ============ Admin Functions ============

    /**
     * @notice Authorize a reporter
     * @param reporter Address to authorize
     */
    function authorizeReporter(address reporter) external onlyOwner {
        authorizedReporters[reporter] = true;
        emit ReporterAuthorized(reporter);
    }

    /**
     * @notice Revoke reporter authorization
     * @param reporter Address to revoke
     */
    function revokeReporter(address reporter) external onlyOwner {
        authorizedReporters[reporter] = false;
        emit ReporterRevoked(reporter);
    }

    /**
     * @notice Update category weights
     * @param category Category to update
     * @param weight New weight (in basis points)
     */
    function setCategoryWeight(ReputationCategory category, uint256 weight)
        external
        onlyOwner
    {
        categoryWeights[category] = weight;
    }
}
