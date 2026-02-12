// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title WoGGuildVault - Guild Item Vault for WoG MMORPG
/// @notice Extension to WoGGuild that allows guilds to store and lend ERC-1155 items.
/// Officers can manage the vault, members can borrow items temporarily.
contract WoGGuildVault {
    struct VaultItem {
        uint256 tokenId;
        uint256 quantity;
        uint256 available;
    }

    struct LentItem {
        uint256 tokenId;
        uint256 quantity;
        address borrower;
        uint256 lentAt;
        uint256 dueAt;
    }

    mapping(uint256 => mapping(uint256 => uint256)) public guildVault; // guildId => tokenId => quantity
    mapping(uint256 => uint256[]) public guildTokenIds; // guildId => tokenId list
    mapping(uint256 => mapping(address => LentItem[])) public lentItems; // guildId => borrower => items

    uint256 public nextLoanId;
    mapping(uint256 => LentItem) public loans; // loanId => LentItem
    mapping(uint256 => uint256) public loanToGuild; // loanId => guildId

    address public owner;
    address public guildContract;

    event ItemDeposited(uint256 indexed guildId, uint256 tokenId, uint256 quantity, address depositor);
    event ItemWithdrawn(uint256 indexed guildId, uint256 tokenId, uint256 quantity, address recipient);
    event ItemLent(uint256 indexed guildId, uint256 indexed loanId, address indexed borrower, uint256 tokenId, uint256 quantity, uint256 dueAt);
    event ItemReturned(uint256 indexed guildId, uint256 indexed loanId, address indexed borrower, uint256 tokenId, uint256 quantity);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor(address _guildContract) {
        owner = msg.sender;
        guildContract = _guildContract;
    }

    /// @notice Deposit items into guild vault (server-authoritative).
    function depositItem(
        uint256 guildId,
        uint256 tokenId,
        uint256 quantity,
        address depositor
    ) external onlyOwner {
        require(quantity > 0, "Quantity must be positive");

        // Track tokenId if first deposit
        if (guildVault[guildId][tokenId] == 0) {
            guildTokenIds[guildId].push(tokenId);
        }

        guildVault[guildId][tokenId] += quantity;

        emit ItemDeposited(guildId, tokenId, quantity, depositor);
    }

    /// @notice Withdraw items from guild vault (officers only).
    function withdrawItem(
        uint256 guildId,
        uint256 tokenId,
        uint256 quantity,
        address recipient
    ) external onlyOwner {
        require(quantity > 0, "Quantity must be positive");
        require(guildVault[guildId][tokenId] >= quantity, "Insufficient vault balance");

        guildVault[guildId][tokenId] -= quantity;

        emit ItemWithdrawn(guildId, tokenId, quantity, recipient);
    }

    /// @notice Lend item to guild member (officers only).
    function lendItem(
        uint256 guildId,
        uint256 tokenId,
        uint256 quantity,
        address borrower,
        uint256 durationDays
    ) external onlyOwner returns (uint256 loanId) {
        require(quantity > 0, "Quantity must be positive");
        require(guildVault[guildId][tokenId] >= quantity, "Insufficient vault balance");
        require(borrower != address(0), "Invalid borrower");

        guildVault[guildId][tokenId] -= quantity;

        loanId = nextLoanId++;
        uint256 dueAt = block.timestamp + (durationDays * 1 days);

        LentItem memory loan = LentItem({
            tokenId: tokenId,
            quantity: quantity,
            borrower: borrower,
            lentAt: block.timestamp,
            dueAt: dueAt
        });

        loans[loanId] = loan;
        loanToGuild[loanId] = guildId;
        lentItems[guildId][borrower].push(loan);

        emit ItemLent(guildId, loanId, borrower, tokenId, quantity, dueAt);
    }

    /// @notice Return borrowed item to vault.
    function returnItem(
        uint256 loanId,
        address borrower
    ) external onlyOwner {
        LentItem storage loan = loans[loanId];
        require(loan.borrower == borrower, "Not the borrower");

        uint256 guildId = loanToGuild[loanId];
        guildVault[guildId][loan.tokenId] += loan.quantity;

        // Remove from lentItems
        LentItem[] storage borrowerLoans = lentItems[guildId][borrower];
        for (uint256 i = 0; i < borrowerLoans.length; i++) {
            if (borrowerLoans[i].tokenId == loan.tokenId &&
                borrowerLoans[i].lentAt == loan.lentAt) {
                borrowerLoans[i] = borrowerLoans[borrowerLoans.length - 1];
                borrowerLoans.pop();
                break;
            }
        }

        emit ItemReturned(guildId, loanId, borrower, loan.tokenId, loan.quantity);

        delete loans[loanId];
        delete loanToGuild[loanId];
    }

    /// @notice Get all items in guild vault.
    function getVaultItems(uint256 guildId) external view returns (VaultItem[] memory) {
        uint256[] memory tokenIds = guildTokenIds[guildId];
        VaultItem[] memory items = new VaultItem[](tokenIds.length);

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            items[i] = VaultItem({
                tokenId: tokenId,
                quantity: guildVault[guildId][tokenId],
                available: guildVault[guildId][tokenId]
            });
        }

        return items;
    }

    /// @notice Get all items lent to a member.
    function getLentItems(uint256 guildId, address borrower) external view returns (LentItem[] memory) {
        return lentItems[guildId][borrower];
    }

    /// @notice Get all active loans for a guild.
    function getGuildLoans(uint256 guildId) external view returns (uint256[] memory, LentItem[] memory) {
        // Count active loans
        uint256 count = 0;
        for (uint256 i = 0; i < nextLoanId; i++) {
            if (loanToGuild[i] == guildId && loans[i].borrower != address(0)) {
                count++;
            }
        }

        uint256[] memory loanIds = new uint256[](count);
        LentItem[] memory loanData = new LentItem[](count);

        uint256 index = 0;
        for (uint256 i = 0; i < nextLoanId; i++) {
            if (loanToGuild[i] == guildId && loans[i].borrower != address(0)) {
                loanIds[index] = i;
                loanData[index] = loans[i];
                index++;
            }
        }

        return (loanIds, loanData);
    }
}
