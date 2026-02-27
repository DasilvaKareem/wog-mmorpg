// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title WoGNameService
 * @notice On-chain .wog name service for WoG MMORPG wallets
 * @dev One name per wallet, case-insensitive uniqueness, 3-16 chars
 */
contract WoGNameService is Ownable {
    // ============ State ============

    /// @dev keccak256(lowercased name) => owner wallet
    mapping(bytes32 => address) public nameHashToOwner;

    /// @dev wallet => display name (preserves original casing)
    mapping(address => string) public ownerToName;

    /// @dev quick check: is this name hash taken?
    mapping(bytes32 => bool) public nameTaken;

    // ============ Events ============

    event NameRegistered(address indexed owner, string name);
    event NameReleased(address indexed owner, string name);

    // ============ Errors ============

    error NameTooShort();
    error NameTooLong();
    error InvalidCharacter();
    error NameAlreadyTaken();
    error WalletAlreadyHasName();
    error WalletHasNoName();

    // ============ Constructor ============

    constructor() {}

    // ============ Core Functions ============

    /**
     * @notice Register a .wog name for a wallet (owner-only, server acts on behalf of users)
     * @param wallet The wallet address to assign the name to
     * @param name The display name (3-16 chars, a-zA-Z0-9_-)
     */
    function registerName(address wallet, string calldata name) external onlyOwner {
        bytes memory nameBytes = bytes(name);

        if (nameBytes.length < 3) revert NameTooShort();
        if (nameBytes.length > 16) revert NameTooLong();

        // Validate characters and compute lowercase hash simultaneously
        bytes memory lowered = new bytes(nameBytes.length);
        for (uint256 i = 0; i < nameBytes.length; i++) {
            bytes1 c = nameBytes[i];
            if (
                (c >= 0x41 && c <= 0x5A) // A-Z
            ) {
                lowered[i] = bytes1(uint8(c) + 32); // to lowercase
            } else if (
                (c >= 0x61 && c <= 0x7A) || // a-z
                (c >= 0x30 && c <= 0x39) || // 0-9
                c == 0x5F ||                 // _
                c == 0x2D                    // -
            ) {
                lowered[i] = c;
            } else {
                revert InvalidCharacter();
            }
        }

        bytes32 nameHash = keccak256(lowered);

        if (nameTaken[nameHash]) revert NameAlreadyTaken();
        if (bytes(ownerToName[wallet]).length > 0) revert WalletAlreadyHasName();

        nameHashToOwner[nameHash] = wallet;
        ownerToName[wallet] = name;
        nameTaken[nameHash] = true;

        emit NameRegistered(wallet, name);
    }

    /**
     * @notice Release a wallet's .wog name (owner-only)
     * @param wallet The wallet to release the name from
     */
    function releaseName(address wallet) external onlyOwner {
        string memory currentName = ownerToName[wallet];
        if (bytes(currentName).length == 0) revert WalletHasNoName();

        // Compute the lowercase hash to clear mappings
        bytes memory nameBytes = bytes(currentName);
        bytes memory lowered = new bytes(nameBytes.length);
        for (uint256 i = 0; i < nameBytes.length; i++) {
            bytes1 c = nameBytes[i];
            if (c >= 0x41 && c <= 0x5A) {
                lowered[i] = bytes1(uint8(c) + 32);
            } else {
                lowered[i] = c;
            }
        }
        bytes32 nameHash = keccak256(lowered);

        delete nameHashToOwner[nameHash];
        delete ownerToName[wallet];
        delete nameTaken[nameHash];

        emit NameReleased(wallet, currentName);
    }

    // ============ View Functions ============

    /**
     * @notice Resolve a name to its owner address
     * @param name The name to look up (case-insensitive)
     * @return The owner address (address(0) if not registered)
     */
    function resolve(string calldata name) external view returns (address) {
        bytes memory nameBytes = bytes(name);
        bytes memory lowered = new bytes(nameBytes.length);
        for (uint256 i = 0; i < nameBytes.length; i++) {
            bytes1 c = nameBytes[i];
            if (c >= 0x41 && c <= 0x5A) {
                lowered[i] = bytes1(uint8(c) + 32);
            } else {
                lowered[i] = c;
            }
        }
        return nameHashToOwner[keccak256(lowered)];
    }

    /**
     * @notice Reverse lookup — get the name for a wallet
     * @param wallet The wallet address
     * @return The display name (empty string if none)
     */
    function reverseLookup(address wallet) external view returns (string memory) {
        return ownerToName[wallet];
    }
}
