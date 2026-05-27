// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title WoGCharacterBase
 * @notice Mirror ERC-721 for WoG character NFTs bridged from SKALE Base.
 *         Mints from server-signed EIP-712 claims; burns to bridge back.
 */
contract WoGCharacterBase is ERC721URIStorage, Ownable, EIP712 {
    /// Source chain id the bridge accepts claims from (e.g. SKALE Base mainnet = 1187947933,
    /// SKALE Base sepolia = 324705682). Hardcoded at deploy time, immutable thereafter.
    uint64 public immutable expectedSourceChainId;
    uint256 private constant MAX_HOLDER_DEADLINE_DELAY = 5 minutes;
    bytes4 private constant ERC1271_MAGICVALUE = 0x1626ba7e;

    bytes32 private constant BRIDGE_CLAIM_TYPEHASH =
        keccak256(
            "BridgeClaim(uint256 sourceTokenId,uint256 destinationTokenId,address recipient,uint64 sourceChainId,uint64 destinationChainId,string metadataURI,bytes32 nonce,uint64 expiresAt)"
        );

    bytes32 private constant BURN_AUTH_TYPEHASH =
        keccak256(
            "BurnAuth(uint256 tokenId,address skaleRecipient,address holder,uint256 deadline)"
        );

    struct BridgeClaim {
        uint256 sourceTokenId;
        uint256 destinationTokenId;
        address recipient;
        uint64 sourceChainId;
        uint64 destinationChainId;
        string metadataURI;
        bytes32 nonce;
        uint64 expiresAt;
    }

    address public bridgeSigner;
    mapping(bytes32 => bool) public consumedClaims;

    event BridgeSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event BridgeOut(
        uint256 indexed tokenId,
        address indexed holder,
        address indexed destinationRecipient,
        uint64 destinationChainId,
        string metadataURI,
        bytes32 nonce
    );
    event BridgeIn(
        uint256 indexed tokenId,
        address indexed recipient,
        uint64 sourceChainId,
        bytes32 claimDigest
    );

    constructor(address initialSigner, uint64 sourceChainId_)
        ERC721("WoG Characters (Base)", "WOGB")
        EIP712("WoGBridge", "1")
    {
        require(initialSigner != address(0), "bad signer");
        require(sourceChainId_ != 0, "bad source chain id");
        bridgeSigner = initialSigner;
        expectedSourceChainId = sourceChainId_;
        emit BridgeSignerUpdated(address(0), initialSigner);
    }

    function setBridgeSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "bad signer");
        emit BridgeSignerUpdated(bridgeSigner, newSigner);
        bridgeSigner = newSigner;
    }

    /**
     * @notice Mint a character from a server-signed bridge claim.
     *         Reverts on replay, expired, wrong chain, or invalid signature.
     */
    function mintFromClaim(BridgeClaim calldata claim, bytes calldata signature) external {
        require(claim.destinationChainId == block.chainid, "wrong chain");
        require(claim.sourceChainId == expectedSourceChainId, "bad source chain");
        require(claim.expiresAt > block.timestamp, "claim expired");
        require(claim.recipient != address(0), "bad recipient");

        bytes32 digest = _claimDigest(claim);
        require(!consumedClaims[digest], "claim consumed");

        (address recovered, ECDSA.RecoverError err) = ECDSA.tryRecover(digest, signature);
        require(err == ECDSA.RecoverError.NoError && recovered == bridgeSigner, "invalid signature");

        consumedClaims[digest] = true;
        _safeMint(claim.recipient, claim.destinationTokenId);
        _setTokenURI(claim.destinationTokenId, claim.metadataURI);
        emit BridgeIn(claim.destinationTokenId, claim.recipient, claim.sourceChainId, digest);
    }

    /**
     * @notice Burn the caller's token and emit a BridgeOut event so the server can sign a claim.
     */
    function burnAndExit(uint256 tokenId, address skaleRecipient) external {
        require(skaleRecipient != address(0), "bad recipient");
        require(_isApprovedOrOwner(msg.sender, tokenId), "not authorized");
        _emitAndBurn(tokenId, ownerOf(tokenId), skaleRecipient);
    }

    /**
     * @notice Relayer-friendly variant: burn on behalf of `holder` using their EIP-712 auth.
     *         Mirrors the setAgentWallet pattern in WoGMockIdentityRegistry.
     */
    function burnAndExitFor(
        uint256 tokenId,
        address holder,
        address skaleRecipient,
        uint256 deadline,
        bytes calldata holderSignature
    ) external {
        require(skaleRecipient != address(0), "bad recipient");
        require(holder != address(0) && ownerOf(tokenId) == holder, "bad holder");
        require(block.timestamp <= deadline, "expired");
        require(deadline <= block.timestamp + MAX_HOLDER_DEADLINE_DELAY, "deadline too far");

        bytes32 structHash = keccak256(
            abi.encode(BURN_AUTH_TYPEHASH, tokenId, skaleRecipient, holder, deadline)
        );
        bytes32 digest = _hashTypedDataV4(structHash);

        (address recovered, ECDSA.RecoverError err) = ECDSA.tryRecover(digest, holderSignature);
        if (err != ECDSA.RecoverError.NoError || recovered != holder) {
            (bool ok, bytes memory res) = holder.staticcall(
                abi.encodeCall(IERC1271.isValidSignature, (digest, holderSignature))
            );
            require(
                ok && res.length >= 32 && abi.decode(res, (bytes4)) == ERC1271_MAGICVALUE,
                "invalid holder sig"
            );
        }

        _emitAndBurn(tokenId, holder, skaleRecipient);
    }

    function _emitAndBurn(uint256 tokenId, address holder, address skaleRecipient) internal {
        string memory uri = tokenURI(tokenId);
        bytes32 nonce = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                tokenId,
                holder,
                block.number,
                blockhash(block.number - 1)
            )
        );
        _burn(tokenId);
        emit BridgeOut(tokenId, holder, skaleRecipient, expectedSourceChainId, uri, nonce);
    }

    function _claimDigest(BridgeClaim calldata claim) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    BRIDGE_CLAIM_TYPEHASH,
                    claim.sourceTokenId,
                    claim.destinationTokenId,
                    claim.recipient,
                    claim.sourceChainId,
                    claim.destinationChainId,
                    keccak256(bytes(claim.metadataURI)),
                    claim.nonce,
                    claim.expiresAt
                )
            )
        );
    }

    /// @notice Helper for off-chain signer to compute the same digest the contract checks.
    function claimDigest(BridgeClaim calldata claim) external view returns (bytes32) {
        return _claimDigest(claim);
    }
}
