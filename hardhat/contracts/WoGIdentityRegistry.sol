// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";

/**
 * @title WoGIdentityRegistry
 * @notice ERC-8004-style identity registry used by WoG agents and characters
 * @dev Exposes the runtime-facing ABI currently used by the shard, while
 *      keeping WoG-specific helpers for direct character registration.
 */
contract WoGIdentityRegistry is ERC721Enumerable, Ownable {
    struct Identity {
        uint256 characterTokenId;
        address characterOwner;
        string metadataURI;
        string agentURI;
        uint256 createdAt;
        bool active;
    }

    uint256 private _nextAgentId = 1;

    mapping(uint256 => Identity) public identities;
    mapping(uint256 => uint256) public characterToIdentity;
    mapping(uint256 => mapping(string => bytes)) private _metadata;

    mapping(address => bool) public authorizedMinters;

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event IdentityCreated(
        uint256 indexed identityId,
        uint256 indexed characterTokenId,
        address indexed owner,
        string metadataURI
    );
    event IdentityUpdated(uint256 indexed identityId, string newMetadataURI);
    event AgentEndpointUpdated(uint256 indexed identityId, string endpoint);
    event AgentWalletUpdated(uint256 indexed identityId, address indexed newWallet);
    event MetadataUpdated(uint256 indexed identityId, string indexed metadataKey, bytes metadataValue);
    event IdentityDeactivated(uint256 indexed identityId);
    event MinterAuthorized(address indexed minter);
    event MinterRevoked(address indexed minter);

    error IdentityAlreadyExists();
    error IdentityNotFound();
    error Unauthorized();
    error IdentityInactive();
    error InvalidAgentId();
    error InvalidWallet();
    error SignatureExpired();

    constructor() ERC721("WoG Character Identity", "WOGID") {
        authorizedMinters[msg.sender] = true;
    }

    /**
     * @notice Runtime-facing ERC-8004 registration path.
     * @dev Mints the new agent identity to msg.sender and sets its discoverable URI.
     */
    function register(string memory agentURI) external returns (uint256 agentId) {
        agentId = _mintIdentity(msg.sender, 0, msg.sender, "", agentURI, false);
        emit Registered(agentId, agentURI, msg.sender);
    }

    /**
     * @notice WoG helper path for registering a character-bound identity.
     */
    function createIdentity(
        uint256 characterTokenId,
        address characterOwner,
        string memory metadataURI
    ) external returns (uint256) {
        return createIdentityWithEndpoint(characterTokenId, characterOwner, metadataURI, "");
    }

    /**
     * @notice WoG helper path for registering a character-bound identity with endpoint.
     */
    function createIdentityWithEndpoint(
        uint256 characterTokenId,
        address characterOwner,
        string memory metadataURI,
        string memory agentEndpoint
    ) public returns (uint256 identityId) {
        if (!authorizedMinters[msg.sender]) revert Unauthorized();
        if (characterToIdentity[characterTokenId] != 0) revert IdentityAlreadyExists();

        identityId = _mintIdentity(
            characterOwner,
            characterTokenId,
            characterOwner,
            metadataURI,
            agentEndpoint,
            true
        );

        emit Registered(identityId, agentEndpoint, characterOwner);
    }

    function updateIdentity(uint256 identityId, string memory newMetadataURI) external {
        Identity storage identity = _requireIdentity(identityId);
        if (!_isAuthorizedOrOwner(msg.sender, identityId) && !authorizedMinters[msg.sender]) {
            revert Unauthorized();
        }

        identity.metadataURI = newMetadataURI;
        emit IdentityUpdated(identityId, newMetadataURI);
    }

    function deactivateIdentity(uint256 identityId) external {
        if (!authorizedMinters[msg.sender]) revert Unauthorized();

        Identity storage identity = _requireIdentity(identityId);
        identity.active = false;
        emit IdentityDeactivated(identityId);
    }

    function setAgentEndpoint(uint256 identityId, string memory endpoint) external {
        setAgentURI(identityId, endpoint);
    }

    function getAgentEndpoint(uint256 identityId) external view returns (string memory) {
        return tokenURI(identityId);
    }

    function setAgentURI(uint256 agentId, string memory newURI) public {
        Identity storage identity = _requireIdentity(agentId);
        if (!_isAuthorizedOrOwner(msg.sender, agentId) && !authorizedMinters[msg.sender]) {
            revert Unauthorized();
        }
        if (!identity.active) revert IdentityInactive();

        identity.agentURI = newURI;
        emit AgentEndpointUpdated(agentId, newURI);
    }

    /**
     * @notice Compatibility surface expected by the shard runtime.
     * @dev Signature is currently trusted by authorization rather than verified cryptographically.
     */
    function setAgentWallet(
        uint256 agentId,
        address newWallet,
        uint256 deadline,
        bytes calldata
    ) external {
        if (deadline < block.timestamp) revert SignatureExpired();
        if (newWallet == address(0)) revert InvalidWallet();
        if (!_isAuthorizedOrOwner(msg.sender, agentId) && !authorizedMinters[msg.sender]) {
            revert Unauthorized();
        }

        address currentOwner = ownerOf(agentId);
        _transfer(currentOwner, newWallet, agentId);
    }

    function setMetadata(
        uint256 agentId,
        string memory metadataKey,
        bytes memory metadataValue
    ) external {
        Identity storage identity = _requireIdentity(agentId);
        if (!_isAuthorizedOrOwner(msg.sender, agentId) && !authorizedMinters[msg.sender]) {
            revert Unauthorized();
        }
        if (!identity.active) revert IdentityInactive();

        _metadata[agentId][metadataKey] = metadataValue;

        if (_equals(metadataKey, "characterTokenId")) {
            uint256 nextCharacterTokenId = abi.decode(metadataValue, (uint256));
            uint256 previousCharacterTokenId = identity.characterTokenId;
            uint256 boundIdentityId = characterToIdentity[nextCharacterTokenId];
            if (boundIdentityId != 0 && boundIdentityId != agentId) {
                revert IdentityAlreadyExists();
            }
            if (
                previousCharacterTokenId != 0 &&
                previousCharacterTokenId != nextCharacterTokenId &&
                characterToIdentity[previousCharacterTokenId] == agentId
            ) {
                delete characterToIdentity[previousCharacterTokenId];
            }
            identity.characterTokenId = nextCharacterTokenId;
            if (nextCharacterTokenId != 0) {
                characterToIdentity[nextCharacterTokenId] = agentId;
            }
        } else if (_equals(metadataKey, "metadataURI")) {
            identity.metadataURI = abi.decode(metadataValue, (string));
            emit IdentityUpdated(agentId, identity.metadataURI);
        }

        emit MetadataUpdated(agentId, metadataKey, metadataValue);
    }

    function getMetadata(
        uint256 agentId,
        string memory metadataKey
    ) external view returns (bytes memory) {
        _requireExistingAgent(agentId);
        return _metadata[agentId][metadataKey];
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        return ownerOf(agentId);
    }

    function getIdentityByCharacter(uint256 characterTokenId) external view returns (Identity memory) {
        uint256 identityId = characterToIdentity[characterTokenId];
        if (identityId == 0) revert IdentityNotFound();
        return identities[identityId];
    }

    function getOwnerIdentities(address owner) external view returns (uint256[] memory) {
        return getAgentsByOwner(owner);
    }

    function getAgentsByOwner(address owner) public view returns (uint256[] memory identityIds) {
        uint256 count = balanceOf(owner);
        identityIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            identityIds[i] = tokenOfOwnerByIndex(owner, i);
        }
    }

    function isActive(uint256 identityId) external view returns (bool) {
        return identities[identityId].active;
    }

    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool) {
        return _isAuthorizedOrOwner(spender, agentId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireExistingAgent(tokenId);
        return identities[tokenId].agentURI;
    }

    function authorizeMinter(address minter) external onlyOwner {
        authorizedMinters[minter] = true;
        emit MinterAuthorized(minter);
    }

    function revokeMinter(address minter) external onlyOwner {
        authorizedMinters[minter] = false;
        emit MinterRevoked(minter);
    }

    function _mintIdentity(
        address mintTo,
        uint256 characterTokenId,
        address characterOwner,
        string memory metadataURI,
        string memory agentURI,
        bool linkCharacter
    ) internal returns (uint256 agentId) {
        if (mintTo == address(0) || characterOwner == address(0)) revert InvalidWallet();
        if (linkCharacter && characterTokenId != 0 && characterToIdentity[characterTokenId] != 0) {
            revert IdentityAlreadyExists();
        }

        agentId = _nextAgentId++;

        identities[agentId] = Identity({
            characterTokenId: characterTokenId,
            characterOwner: characterOwner,
            metadataURI: metadataURI,
            agentURI: agentURI,
            createdAt: block.timestamp,
            active: true
        });

        if (linkCharacter && characterTokenId != 0) {
            characterToIdentity[characterTokenId] = agentId;
            _metadata[agentId]["characterTokenId"] = abi.encode(characterTokenId);
        }

        if (bytes(metadataURI).length > 0) {
            _metadata[agentId]["metadataURI"] = abi.encode(metadataURI);
        }

        _safeMint(mintTo, agentId);

        emit IdentityCreated(agentId, characterTokenId, characterOwner, metadataURI);
        if (bytes(agentURI).length > 0) {
            emit AgentEndpointUpdated(agentId, agentURI);
        }
    }

    function _requireIdentity(uint256 identityId) internal view returns (Identity storage identity) {
        identity = identities[identityId];
        if (identity.createdAt == 0) revert IdentityNotFound();
    }

    function _requireExistingAgent(uint256 agentId) internal view {
        if (!_exists(agentId)) revert InvalidAgentId();
    }

    function _isAuthorizedOrOwner(address spender, uint256 agentId) internal view returns (bool) {
        if (!_exists(agentId)) return false;
        return _isApprovedOrOwner(spender, agentId);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 firstTokenId,
        uint256 batchSize
    ) internal override(ERC721Enumerable) {
        super._beforeTokenTransfer(from, to, firstTokenId, batchSize);
        if (from != address(0) && to != address(0) && batchSize == 1) {
            identities[firstTokenId].characterOwner = to;
            emit AgentWalletUpdated(firstTokenId, to);
        }
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _equals(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
