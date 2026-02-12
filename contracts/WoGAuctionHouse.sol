// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title WoGAuctionHouse — Regional English Auctions for WoG MMORPG
/// @notice Zone-scoped auction system with anti-snipe protection and instant buyout.
/// Server-authoritative: only contract owner (server wallet) can create auctions and place bids.
contract WoGAuctionHouse {
    enum AuctionStatus { Active, Ended, Cancelled }

    struct Auction {
        string  zoneId;
        address seller;
        uint256 tokenId;
        uint256 quantity;
        uint256 startPrice;
        uint256 buyoutPrice;
        uint256 endTime;
        address highBidder;
        uint256 highBid;
        AuctionStatus status;
        uint8   extensionCount;
    }

    uint256 public nextAuctionId;
    mapping(uint256 => Auction) public auctions;
    address public owner;

    // Anti-snipe configuration
    uint256 constant SNIPE_WINDOW = 5 minutes;
    uint256 constant SNIPE_EXTENSION = 5 minutes;
    uint8   constant MAX_EXTENSIONS = 2;

    event AuctionCreated(
        uint256 indexed auctionId,
        string zoneId,
        address indexed seller,
        uint256 tokenId,
        uint256 quantity,
        uint256 startPrice,
        uint256 buyoutPrice,
        uint256 endTime
    );

    event BidPlaced(
        uint256 indexed auctionId,
        address indexed bidder,
        uint256 bidAmount,
        address previousBidder,
        uint256 previousBid,
        uint256 newEndTime,
        bool extended
    );

    event AuctionEnded(
        uint256 indexed auctionId,
        address winner,
        uint256 finalPrice
    );

    event AuctionCancelled(uint256 indexed auctionId);

    event BuyoutExecuted(
        uint256 indexed auctionId,
        address buyer,
        uint256 buyoutPrice
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Server creates a new auction for a zone-specific item.
    function createAuction(
        string calldata zoneId,
        address seller,
        uint256 tokenId,
        uint256 quantity,
        uint256 startPrice,
        uint256 durationSeconds,
        uint256 buyoutPrice
    ) external onlyOwner returns (uint256 auctionId) {
        require(seller != address(0), "Invalid seller");
        require(quantity > 0, "Quantity must be positive");
        require(startPrice > 0, "Start price must be positive");
        require(durationSeconds > 0, "Duration must be positive");

        auctionId = nextAuctionId++;
        Auction storage a = auctions[auctionId];

        a.zoneId = zoneId;
        a.seller = seller;
        a.tokenId = tokenId;
        a.quantity = quantity;
        a.startPrice = startPrice;
        a.buyoutPrice = buyoutPrice;
        a.endTime = block.timestamp + durationSeconds;
        a.status = AuctionStatus.Active;
        a.highBidder = address(0);
        a.highBid = 0;
        a.extensionCount = 0;

        emit AuctionCreated(
            auctionId,
            zoneId,
            seller,
            tokenId,
            quantity,
            startPrice,
            buyoutPrice,
            a.endTime
        );
    }

    /// @notice Server submits a bid on behalf of an agent. Auto-extends if in snipe window.
    function placeBid(
        uint256 auctionId,
        address bidder,
        uint256 bidAmount
    ) external onlyOwner returns (address previousBidder, uint256 previousBid) {
        Auction storage a = auctions[auctionId];
        require(a.status == AuctionStatus.Active, "Auction not active");
        require(block.timestamp < a.endTime, "Auction has ended");
        require(bidder != address(0), "Invalid bidder");
        require(bidder != a.seller, "Seller cannot bid on own auction");

        // Enforce minimum bid
        uint256 minBid = a.highBid == 0 ? a.startPrice : a.highBid + 10 ether;
        require(bidAmount >= minBid, "Bid too low");

        previousBidder = a.highBidder;
        previousBid = a.highBid;

        a.highBidder = bidder;
        a.highBid = bidAmount;

        // Anti-snipe logic: extend if bid placed in final SNIPE_WINDOW
        bool extended = false;
        uint256 timeRemaining = a.endTime - block.timestamp;
        if (timeRemaining <= SNIPE_WINDOW && a.extensionCount < MAX_EXTENSIONS) {
            a.endTime += SNIPE_EXTENSION;
            a.extensionCount++;
            extended = true;
        }

        emit BidPlaced(
            auctionId,
            bidder,
            bidAmount,
            previousBidder,
            previousBid,
            a.endTime,
            extended
        );
    }

    /// @notice Server calls this when time expires to finalize auction.
    function endAuction(uint256 auctionId) external onlyOwner {
        Auction storage a = auctions[auctionId];
        require(a.status == AuctionStatus.Active, "Auction not active");
        require(block.timestamp >= a.endTime, "Auction still ongoing");

        a.status = AuctionStatus.Ended;

        emit AuctionEnded(auctionId, a.highBidder, a.highBid);
    }

    /// @notice Instant purchase at buyout price (if set).
    function buyout(uint256 auctionId, address buyer) external onlyOwner {
        Auction storage a = auctions[auctionId];
        require(a.status == AuctionStatus.Active, "Auction not active");
        require(a.buyoutPrice > 0, "Buyout not available");
        require(buyer != address(0), "Invalid buyer");
        require(buyer != a.seller, "Seller cannot buy own auction");

        address previousBidder = a.highBidder;
        uint256 previousBid = a.highBid;

        a.highBidder = buyer;
        a.highBid = a.buyoutPrice;
        a.status = AuctionStatus.Ended;

        emit BuyoutExecuted(auctionId, buyer, a.buyoutPrice);
        emit BidPlaced(
            auctionId,
            buyer,
            a.buyoutPrice,
            previousBidder,
            previousBid,
            a.endTime,
            false
        );
        emit AuctionEnded(auctionId, buyer, a.buyoutPrice);
    }

    /// @notice Seller cancels auction before first bid.
    function cancelAuction(uint256 auctionId) external onlyOwner {
        Auction storage a = auctions[auctionId];
        require(a.status == AuctionStatus.Active, "Auction not active");
        require(a.highBidder == address(0), "Cannot cancel with bids");

        a.status = AuctionStatus.Cancelled;

        emit AuctionCancelled(auctionId);
    }

    /// @notice Read full auction details.
    function getAuction(uint256 auctionId) external view returns (
        string memory zoneId,
        address seller,
        uint256 tokenId,
        uint256 quantity,
        uint256 startPrice,
        uint256 buyoutPrice,
        uint256 endTime,
        address highBidder,
        uint256 highBid,
        AuctionStatus status,
        uint8 extensionCount
    ) {
        Auction storage a = auctions[auctionId];
        return (
            a.zoneId,
            a.seller,
            a.tokenId,
            a.quantity,
            a.startPrice,
            a.buyoutPrice,
            a.endTime,
            a.highBidder,
            a.highBid,
            a.status,
            a.extensionCount
        );
    }
}
