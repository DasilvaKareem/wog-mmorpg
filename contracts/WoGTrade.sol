// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface that contracts must implement to receive CTX decryption callbacks.
interface IBiteSupplicant {
    function onDecrypt(
        bytes[] calldata decryptedArguments,
        bytes[] calldata plaintextArguments
    ) external;
}

/// @notice Minimal BITE v2 library for submitting Conditional Transactions (CTXs).
/// Adapted from the SKALE BITE Solidity SDK to keep the contract self-contained.
library BITELib {
    address constant SUBMIT_CTX_ADDRESS = address(0x1B);

    function submitCTX(
        uint256 gasLimit,
        bytes[] memory encryptedArguments,
        bytes[] memory plaintextArguments
    ) internal returns (address payable callbackSender) {
        (bool success, bytes memory result) = SUBMIT_CTX_ADDRESS.staticcall(
            abi.encode(
                gasLimit,
                abi.encode(encryptedArguments, plaintextArguments)
            )
        );
        require(success, "submitCTX call failed");
        require(result.length == 20, "Invalid CTX return data length");
        callbackSender = payable(address(bytes20(result)));
    }
}

/// @title WoGTrade — Encrypted P2P trading via BITE v2
/// @notice AI agents list items with encrypted ask prices. Other agents submit encrypted bids.
/// BITE v2 decrypts both prices atomically — if bid >= ask the trade matches.
contract WoGTrade is IBiteSupplicant {
    enum Status { Created, Pending, Resolved, Failed, Cancelled }

    struct Trade {
        address seller;
        address buyer;
        uint256 tokenId;
        uint256 quantity;
        bytes   encryptedAskPrice;
        bytes   encryptedBidPrice;
        Status  status;
        address ctxSender;
        uint256 askPrice;
        uint256 bidPrice;
        bool    matched;
    }

    uint256 public nextTradeId;
    mapping(uint256 => Trade) public trades;
    mapping(address => uint256) private ctxToTradeId;
    address public owner;

    event TradeCreated(uint256 indexed tradeId, address indexed seller, uint256 tokenId, uint256 quantity);
    event OfferSubmitted(uint256 indexed tradeId, address indexed buyer);
    event TradeResolved(uint256 indexed tradeId, bool matched, uint256 askPrice, uint256 bidPrice);
    event TradeCancelled(uint256 indexed tradeId);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Seller lists an item with an encrypted ask price.
    function createTrade(
        bytes calldata encryptedAskPrice,
        uint256 tokenId,
        uint256 quantity,
        address seller
    ) external onlyOwner returns (uint256 tradeId) {
        tradeId = nextTradeId++;
        Trade storage t = trades[tradeId];
        t.seller = seller;
        t.tokenId = tokenId;
        t.quantity = quantity;
        t.encryptedAskPrice = encryptedAskPrice;
        t.status = Status.Created;

        emit TradeCreated(tradeId, seller, tokenId, quantity);
    }

    /// @notice Buyer submits an encrypted bid. Triggers BITE CTX to decrypt both prices.
    /// @dev Must send sFUEL (msg.value) to fund the CTX callback gas.
    function submitOffer(
        uint256 tradeId,
        bytes calldata encryptedBidPrice,
        address buyer
    ) external payable onlyOwner returns (address) {
        Trade storage t = trades[tradeId];
        require(t.status == Status.Created, "Trade not available");

        t.buyer = buyer;
        t.encryptedBidPrice = encryptedBidPrice;
        t.status = Status.Pending;

        // Both encrypted prices go into the CTX for atomic decryption
        bytes[] memory encryptedArgs = new bytes[](2);
        encryptedArgs[0] = t.encryptedAskPrice;
        encryptedArgs[1] = encryptedBidPrice;

        // Pass tradeId as plaintext so onDecrypt can identify the trade
        bytes[] memory plaintextArgs = new bytes[](1);
        plaintextArgs[0] = abi.encode(tradeId);

        address payable ctxSender = BITELib.submitCTX(
            msg.value / tx.gasprice,
            encryptedArgs,
            plaintextArgs
        );

        t.ctxSender = ctxSender;
        ctxToTradeId[ctxSender] = tradeId;

        // Fund the callback sender to pay for onDecrypt gas
        (bool sent, ) = ctxSender.call{value: msg.value}("");
        require(sent, "Failed to fund CTX sender");

        emit OfferSubmitted(tradeId, buyer);
        return ctxSender;
    }

    /// @notice Called by the BITE protocol in block N+1 with decrypted prices.
    function onDecrypt(
        bytes[] calldata decryptedArguments,
        bytes[] calldata plaintextArguments
    ) external override {
        uint256 tradeId = abi.decode(plaintextArguments[0], (uint256));
        Trade storage t = trades[tradeId];

        require(t.ctxSender == msg.sender, "Unauthorized callback");
        require(t.status == Status.Pending, "Trade not pending");

        uint256 askPrice = abi.decode(decryptedArguments[0], (uint256));
        uint256 bidPrice = abi.decode(decryptedArguments[1], (uint256));

        t.askPrice = askPrice;
        t.bidPrice = bidPrice;
        t.matched = bidPrice >= askPrice;
        t.status = t.matched ? Status.Resolved : Status.Failed;

        emit TradeResolved(tradeId, t.matched, askPrice, bidPrice);
    }

    /// @notice Seller can cancel a trade before any offer is submitted.
    function cancelTrade(uint256 tradeId) external onlyOwner {
        Trade storage t = trades[tradeId];
        require(t.status == Status.Created, "Can only cancel created trades");
        t.status = Status.Cancelled;
        emit TradeCancelled(tradeId);
    }

    /// @notice Read trade details.
    function getTrade(uint256 tradeId) external view returns (
        address seller,
        address buyer,
        uint256 tokenId,
        uint256 quantity,
        Status  status,
        uint256 askPrice,
        uint256 bidPrice,
        bool    matched
    ) {
        Trade storage t = trades[tradeId];
        return (t.seller, t.buyer, t.tokenId, t.quantity, t.status, t.askPrice, t.bidPrice, t.matched);
    }

    /// @notice Accept sFUEL deposits for CTX gas funding.
    receive() external payable {}
}
