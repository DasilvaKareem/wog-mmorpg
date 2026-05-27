// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/interfaces/IERC721.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

interface IWoGIdentityRegistry is IERC721 {
    function register(string memory agentURI) external returns (uint256 agentId);
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

/**
 * @title WoGBridgeAdapter
 * @notice SKALE-side bridge adapter wrapping the non-upgradeable WoGMockIdentityRegistry.
 *         Bridge-out: escrows NFT into this contract and emits BridgeOut.
 *         Bridge-in: verifies server-signed EIP-712 claim, either releases escrow
 *                    (round-trip) or fresh-mints via registry.register (first-from-Base).
 *
 *         NOTE: The wrapped registry clears its `agentWallet` metadata on every transfer
 *         (see WoGMockIdentityRegistry._beforeTokenTransfer). Bridged characters must
 *         re-attest their agentWallet after bridge-back; this is expected behavior.
 */
contract WoGBridgeAdapter is Ownable, EIP712, IERC721Receiver {
    /// Source chain id the bridge accepts claims from (e.g. Base mainnet = 8453,
    /// Base sepolia = 84532). Hardcoded at deploy time, immutable thereafter.
    uint64 public immutable expectedSourceChainId;
    uint256 private constant MAX_HOLDER_DEADLINE_DELAY = 5 minutes;
    bytes4 private constant ERC1271_MAGICVALUE = 0x1626ba7e;

    bytes32 private constant BRIDGE_CLAIM_TYPEHASH =
        keccak256(
            "BridgeClaim(uint256 sourceTokenId,uint256 destinationTokenId,address recipient,uint64 sourceChainId,uint64 destinationChainId,string metadataURI,bytes32 nonce,uint64 expiresAt)"
        );

    bytes32 private constant BRIDGE_OUT_AUTH_TYPEHASH =
        keccak256(
            "BridgeOutAuth(uint256 tokenId,address baseRecipient,address holder,uint256 deadline)"
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

    /// Sentinel value for `destinationTokenId` in a claim that requests a fresh mint
    /// (Base-origin character with no SKALE history). Chosen to be outside the registry's
    /// monotonic id space so it can never collide with a real tokenId.
    uint256 public constant FRESH_MINT_SENTINEL = type(uint256).max;

    IWoGIdentityRegistry public immutable registry;
    address public bridgeSigner;

    /// tokenId => held in escrow due to bridge-out
    mapping(uint256 => bool) public escrowed;
    /// tokenId => original holder (for refund flow)
    mapping(uint256 => address) public escrowHolder;
    /// digest => already consumed
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
    event EscrowReleased(uint256 indexed tokenId, address indexed recipient, bool refunded);

    constructor(address registry_, address initialSigner, uint64 sourceChainId_) EIP712("WoGBridge", "1") {
        require(registry_ != address(0) && initialSigner != address(0), "bad ctor");
        require(sourceChainId_ != 0, "bad source chain id");
        registry = IWoGIdentityRegistry(registry_);
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
     * @notice Escrow the caller's character and emit a BridgeOut event.
     *         Caller must have approved this contract via `registry.approve` (or be operator).
     */
    function bridgeOut(uint256 tokenId, address baseRecipient) external {
        require(baseRecipient != address(0), "bad recipient");
        require(registry.isAuthorizedOrOwner(msg.sender, tokenId), "not authorized");
        require(!escrowed[tokenId], "already escrowed");
        address holder = registry.ownerOf(tokenId);
        _escrowAndEmit(tokenId, holder, baseRecipient);
    }

    /**
     * @notice Relayer-friendly variant: bridge out on behalf of `holder` using their EIP-712 auth.
     */
    function bridgeOutFor(
        uint256 tokenId,
        address holder,
        address baseRecipient,
        uint256 deadline,
        bytes calldata holderSignature
    ) external {
        require(baseRecipient != address(0), "bad recipient");
        require(holder != address(0) && registry.ownerOf(tokenId) == holder, "bad holder");
        require(block.timestamp <= deadline, "expired");
        require(deadline <= block.timestamp + MAX_HOLDER_DEADLINE_DELAY, "deadline too far");
        require(!escrowed[tokenId], "already escrowed");

        bytes32 structHash = keccak256(
            abi.encode(BRIDGE_OUT_AUTH_TYPEHASH, tokenId, baseRecipient, holder, deadline)
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

        _escrowAndEmit(tokenId, holder, baseRecipient);
    }

    function _escrowAndEmit(uint256 tokenId, address holder, address baseRecipient) internal {
        string memory uri = registry.tokenURI(tokenId);
        registry.transferFrom(holder, address(this), tokenId);
        escrowed[tokenId] = true;
        escrowHolder[tokenId] = holder;
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
        emit BridgeOut(tokenId, holder, baseRecipient, expectedSourceChainId, uri, nonce);
    }

    /**
     * @notice Redeem a server-signed claim. Two paths:
     *         A) destinationTokenId is escrowed here → release back to recipient (round-trip).
     *         B) destinationTokenId == 0 → fresh mint via registry.register (first-from-Base).
     *         Path A preserves the original tokenId. Path B yields a new tokenId from the
     *         registry's auto-increment; the actual minted id is in the BridgeIn event.
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

        uint256 mintedTokenId;
        if (claim.destinationTokenId == FRESH_MINT_SENTINEL) {
            // Base-origin character that has never lived on SKALE → fresh mint.
            mintedTokenId = registry.register(claim.metadataURI);
            registry.transferFrom(address(this), claim.recipient, mintedTokenId);
        } else {
            // Round-trip: release the specific escrowed token.
            require(escrowed[claim.destinationTokenId], "not escrowed");
            escrowed[claim.destinationTokenId] = false;
            delete escrowHolder[claim.destinationTokenId];
            registry.transferFrom(address(this), claim.recipient, claim.destinationTokenId);
            mintedTokenId = claim.destinationTokenId;
        }

        emit BridgeIn(mintedTokenId, claim.recipient, claim.sourceChainId, digest);
    }

    /**
     * @notice Owner-only rollback for expired bridge-out attempts.
     *         Releases an escrowed token back to its original holder.
     */
    function refundEscrow(uint256 tokenId) external onlyOwner {
        require(escrowed[tokenId], "not escrowed");
        address holder = escrowHolder[tokenId];
        require(holder != address(0), "no holder record");
        escrowed[tokenId] = false;
        delete escrowHolder[tokenId];
        registry.transferFrom(address(this), holder, tokenId);
        emit EscrowReleased(tokenId, holder, true);
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
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
