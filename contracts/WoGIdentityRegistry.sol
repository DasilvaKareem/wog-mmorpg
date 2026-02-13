// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/**
 * @title WoGIdentityRegistry
 * @notice ERC-8004 compliant Identity Registry for WoG MMORPG characters
 * @dev Each character gets a unique on-chain identity token when minted
 */
contract WoGIdentityRegistry is ERC721, Ownable {
    using Counters for Counters.Counter;

    Counters.Counter private _identityIds;

    // ============ Structs ============

    struct Identity {
        uint256 characterTokenId;
        address characterOwner;
        string metadataURI;
        uint256 createdAt;
        bool active;
    }

    // ============ State ============

    // identityId => Identity
    mapping(uint256 => Identity) public identities;

    // characterTokenId => identityId
    mapping(uint256 => uint256) public characterToIdentity;

    // owner address => identityIds[]
    mapping(address => uint256[]) public ownerIdentities;

    // Authorized contracts that can mint identities
    mapping(address => bool) public authorizedMinters;

    // ============ Events ============

    event IdentityCreated(
        uint256 indexed identityId,
        uint256 indexed characterTokenId,
        address indexed owner,
        string metadataURI
    );

    event IdentityUpdated(
        uint256 indexed identityId,
        string newMetadataURI
    );

    event IdentityDeactivated(uint256 indexed identityId);

    event MinterAuthorized(address indexed minter);
    event MinterRevoked(address indexed minter);

    // ============ Errors ============

    error IdentityAlreadyExists();
    error IdentityNotFound();
    error Unauthorized();
    error IdentityInactive();

    // ============ Constructor ============

    constructor() ERC721("WoG Character Identity", "WOGID") {
        // Owner is authorized by default
        authorizedMinters[msg.sender] = true;
    }

    // ============ Core Functions ============

    /**
     * @notice Create a new identity for a character
     * @param characterTokenId The character NFT token ID
     * @param characterOwner Owner of the character
     * @param metadataURI URI pointing to identity metadata
     * @return identityId The new identity token ID
     */
    function createIdentity(
        uint256 characterTokenId,
        address characterOwner,
        string memory metadataURI
    ) external returns (uint256) {
        if (!authorizedMinters[msg.sender]) revert Unauthorized();
        if (characterToIdentity[characterTokenId] != 0) revert IdentityAlreadyExists();

        _identityIds.increment();
        uint256 identityId = _identityIds.current();

        identities[identityId] = Identity({
            characterTokenId: characterTokenId,
            characterOwner: characterOwner,
            metadataURI: metadataURI,
            createdAt: block.timestamp,
            active: true
        });

        characterToIdentity[characterTokenId] = identityId;
        ownerIdentities[characterOwner].push(identityId);

        // Mint ERC-721 identity token
        _mint(characterOwner, identityId);

        emit IdentityCreated(identityId, characterTokenId, characterOwner, metadataURI);

        return identityId;
    }

    /**
     * @notice Update identity metadata URI
     * @param identityId Identity to update
     * @param newMetadataURI New metadata URI
     */
    function updateIdentity(
        uint256 identityId,
        string memory newMetadataURI
    ) external {
        Identity storage identity = identities[identityId];
        if (identity.createdAt == 0) revert IdentityNotFound();
        if (ownerOf(identityId) != msg.sender && !authorizedMinters[msg.sender]) {
            revert Unauthorized();
        }

        identity.metadataURI = newMetadataURI;

        emit IdentityUpdated(identityId, newMetadataURI);
    }

    /**
     * @notice Deactivate an identity (character deleted/burned)
     * @param identityId Identity to deactivate
     */
    function deactivateIdentity(uint256 identityId) external {
        if (!authorizedMinters[msg.sender]) revert Unauthorized();

        Identity storage identity = identities[identityId];
        if (identity.createdAt == 0) revert IdentityNotFound();

        identity.active = false;

        emit IdentityDeactivated(identityId);
    }

    /**
     * @notice Get identity by character token ID
     * @param characterTokenId The character NFT token ID
     * @return identity The identity struct
     */
    function getIdentityByCharacter(uint256 characterTokenId)
        external
        view
        returns (Identity memory)
    {
        uint256 identityId = characterToIdentity[characterTokenId];
        if (identityId == 0) revert IdentityNotFound();
        return identities[identityId];
    }

    /**
     * @notice Get all identities for an owner
     * @param owner Address to query
     * @return Array of identity IDs
     */
    function getOwnerIdentities(address owner)
        external
        view
        returns (uint256[] memory)
    {
        return ownerIdentities[owner];
    }

    /**
     * @notice Check if identity is active
     * @param identityId Identity to check
     * @return bool Active status
     */
    function isActive(uint256 identityId) external view returns (bool) {
        return identities[identityId].active;
    }

    // ============ Admin Functions ============

    /**
     * @notice Authorize a contract to mint identities
     * @param minter Address to authorize
     */
    function authorizeMinter(address minter) external onlyOwner {
        authorizedMinters[minter] = true;
        emit MinterAuthorized(minter);
    }

    /**
     * @notice Revoke minting authorization
     * @param minter Address to revoke
     */
    function revokeMinter(address minter) external onlyOwner {
        authorizedMinters[minter] = false;
        emit MinterRevoked(minter);
    }

    // ============ ERC-721 Overrides ============

    /**
     * @notice Get token URI (ERC-8004 metadata)
     * @param tokenId Identity token ID
     * @return string Metadata URI
     */
    function tokenURI(uint256 tokenId)
        public
        view
        override
        returns (string memory)
    {
        Identity memory identity = identities[tokenId];
        if (identity.createdAt == 0) revert IdentityNotFound();
        return identity.metadataURI;
    }

    /**
     * @notice Prevent transfers (soul-bound to character)
     * @dev Identities are tied to characters, not transferable
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal virtual override {
        // Allow minting (from == address(0))
        // Block all other transfers
        if (from != address(0)) {
            revert("WoGIdentity: Identity tokens are soul-bound");
        }
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }
}
