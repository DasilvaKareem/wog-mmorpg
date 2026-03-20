// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title WoGValidationRegistry
 * @notice ERC-8004-style validation registry for agent capability claims
 * @dev Stores verifier attestations such as `wog:a2a-enabled` or `wog:x402-enabled`.
 */
contract WoGValidationRegistry is Ownable {
    struct Verification {
        address verifier;
        string claim;
        uint256 validUntil;
    }

    mapping(address => bool) public authorizedVerifiers;
    mapping(uint256 => Verification[]) private _verifications;

    event CapabilityVerified(
        uint256 indexed agentId,
        address indexed verifier,
        string claim,
        uint256 validUntil
    );
    event VerifierAuthorized(address indexed verifier);
    event VerifierRevoked(address indexed verifier);

    error Unauthorized();
    error InvalidExpiry();

    constructor() {
        authorizedVerifiers[msg.sender] = true;
    }

    /**
     * @notice Publish a capability verification for an agent.
     */
    function verifyCapability(
        uint256 agentId,
        string memory claim,
        uint256 expiry
    ) external {
        if (!authorizedVerifiers[msg.sender]) revert Unauthorized();
        if (expiry <= block.timestamp) revert InvalidExpiry();

        _verifications[agentId].push(
            Verification({
                verifier: msg.sender,
                claim: claim,
                validUntil: expiry
            })
        );

        emit CapabilityVerified(agentId, msg.sender, claim, expiry);
    }

    /**
     * @notice Return all recorded verifications for an agent.
     */
    function getVerifications(
        uint256 agentId
    ) external view returns (Verification[] memory) {
        return _verifications[agentId];
    }

    /**
     * @notice Check whether an agent currently has a live verification for a claim.
     */
    function isVerified(uint256 agentId, string memory claim) external view returns (bool) {
        Verification[] storage entries = _verifications[agentId];
        bytes32 claimHash = keccak256(bytes(claim));

        for (uint256 i = entries.length; i > 0; i--) {
            Verification storage entry = entries[i - 1];
            if (entry.validUntil < block.timestamp) {
                continue;
            }
            if (keccak256(bytes(entry.claim)) == claimHash) {
                return true;
            }
        }

        return false;
    }

    function authorizeVerifier(address verifier) external onlyOwner {
        authorizedVerifiers[verifier] = true;
        emit VerifierAuthorized(verifier);
    }

    function revokeVerifier(address verifier) external onlyOwner {
        authorizedVerifiers[verifier] = false;
        emit VerifierRevoked(verifier);
    }
}
