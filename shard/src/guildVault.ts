import type { FastifyInstance } from "fastify";
import { getItemBalance, transferItem } from "./blockchain.js";
import { getItemByTokenId } from "./itemCatalog.js";
import { getMemberFromChain } from "./guildChain.js";
import {
  depositItemOnChain,
  withdrawItemOnChain,
  lendItemOnChain,
  returnItemOnChain,
  getVaultItemsFromChain,
  getLentItemsFromChain,
  getGuildLoansFromChain,
  type VaultItem,
  type LoanInfo,
} from "./guildVaultChain.js";

function formatVaultItem(vaultItem: VaultItem) {
  const item = getItemByTokenId(BigInt(vaultItem.tokenId));

  return {
    tokenId: vaultItem.tokenId,
    name: item?.name ?? "Unknown Item",
    description: item?.description ?? "",
    category: item?.category ?? "unknown",
    quantity: vaultItem.quantity,
    available: vaultItem.available,
  };
}

function formatLoan(loan: LoanInfo) {
  const item = getItemByTokenId(BigInt(loan.tokenId));
  const now = Math.floor(Date.now() / 1000);
  const isOverdue = now > loan.dueAt;

  return {
    loanId: loan.loanId,
    tokenId: loan.tokenId,
    itemName: item?.name ?? "Unknown Item",
    quantity: loan.quantity,
    borrower: loan.borrower,
    lentAt: loan.lentAt,
    dueAt: loan.dueAt,
    isOverdue,
    timeRemaining: Math.max(0, loan.dueAt - now),
  };
}

export function registerGuildVaultRoutes(server: FastifyInstance) {
  /**
   * GET /guild/:guildId/vault
   * Get all items in guild vault + active loans.
   */
  server.get<{ Params: { guildId: string } }>(
    "/guild/:guildId/vault",
    async (request, reply) => {
      const guildId = parseInt(request.params.guildId, 10);
      if (isNaN(guildId) || guildId < 0) {
        reply.code(400);
        return { error: "Invalid guild ID" };
      }

      try {
        const vaultItems = await getVaultItemsFromChain(guildId);
        const loans = await getGuildLoansFromChain(guildId);

        return {
          guildId,
          items: vaultItems.map(formatVaultItem),
          loans: loans.map(formatLoan),
        };
      } catch (err) {
        server.log.error(err, `Failed to get vault for guild ${guildId}`);
        reply.code(500);
        return { error: "Failed to get vault contents" };
      }
    }
  );

  /**
   * POST /guild/:guildId/vault/deposit
   * Deposit item into guild vault (members can deposit).
   */
  server.post<{
    Params: { guildId: string };
    Body: { memberAddress: string; tokenId: number; quantity: number };
  }>("/guild/:guildId/vault/deposit", async (request, reply) => {
    const guildId = parseInt(request.params.guildId, 10);
    const { memberAddress, tokenId, quantity } = request.body;

    if (!memberAddress || !/^0x[a-fA-F0-9]{40}$/.test(memberAddress)) {
      reply.code(400);
      return { error: "Invalid member address" };
    }

    if (quantity <= 0) {
      reply.code(400);
      return { error: "Quantity must be positive" };
    }

    try {
      // Verify member owns the item
      const balance = await getItemBalance(memberAddress, BigInt(tokenId));
      if (balance < BigInt(quantity)) {
        reply.code(400);
        return {
          error: "Insufficient item balance",
          required: quantity,
          available: balance.toString(),
        };
      }

      // Note: In production, you'd transfer the item from member to vault contract
      // For now, we'll just track it on-chain in the vault contract
      // The actual ERC-1155 transfer would happen via transferItem() to vault contract address

      const txHash = await depositItemOnChain(guildId, tokenId, quantity, memberAddress);

      server.log.info(
        `${memberAddress} deposited ${quantity}x tokenId ${tokenId} to guild ${guildId} vault`
      );

      return {
        ok: true,
        guildId,
        tokenId,
        quantity,
        txHash,
      };
    } catch (err) {
      server.log.error(err, `Failed to deposit item to guild ${guildId} vault`);
      reply.code(500);
      return { error: "Failed to deposit item" };
    }
  });

  /**
   * POST /guild/:guildId/vault/withdraw
   * Withdraw item from guild vault (officers only).
   */
  server.post<{
    Params: { guildId: string };
    Body: { officerAddress: string; tokenId: number; quantity: number; recipientAddress: string };
  }>("/guild/:guildId/vault/withdraw", async (request, reply) => {
    const guildId = parseInt(request.params.guildId, 10);
    const { officerAddress, tokenId, quantity, recipientAddress } = request.body;

    if (!officerAddress || !/^0x[a-fA-F0-9]{40}$/.test(officerAddress)) {
      reply.code(400);
      return { error: "Invalid officer address" };
    }

    if (!recipientAddress || !/^0x[a-fA-F0-9]{40}$/.test(recipientAddress)) {
      reply.code(400);
      return { error: "Invalid recipient address" };
    }

    if (quantity <= 0) {
      reply.code(400);
      return { error: "Quantity must be positive" };
    }

    try {
      // Verify officer rank (Officer or Founder)
      const member = await getMemberFromChain(guildId, officerAddress);
      if (member.rank < 1) {
        // 0 = Member, 1 = Officer, 2 = Founder
        reply.code(403);
        return { error: "Only officers can withdraw from vault" };
      }

      const txHash = await withdrawItemOnChain(guildId, tokenId, quantity, recipientAddress);

      // Note: In production, you'd transfer the item from vault contract to recipient
      // This would happen via transferItem() from vault contract to recipient

      server.log.info(
        `Officer ${officerAddress} withdrew ${quantity}x tokenId ${tokenId} from guild ${guildId} vault to ${recipientAddress}`
      );

      return {
        ok: true,
        guildId,
        tokenId,
        quantity,
        recipientAddress,
        txHash,
      };
    } catch (err) {
      server.log.error(err, `Failed to withdraw item from guild ${guildId} vault`);
      reply.code(500);
      return { error: "Failed to withdraw item" };
    }
  });

  /**
   * POST /guild/:guildId/vault/lend
   * Lend item to guild member (officers only).
   */
  server.post<{
    Params: { guildId: string };
    Body: {
      officerAddress: string;
      tokenId: number;
      quantity: number;
      borrowerAddress: string;
      durationDays: number;
    };
  }>("/guild/:guildId/vault/lend", async (request, reply) => {
    const guildId = parseInt(request.params.guildId, 10);
    const { officerAddress, tokenId, quantity, borrowerAddress, durationDays } = request.body;

    if (!officerAddress || !/^0x[a-fA-F0-9]{40}$/.test(officerAddress)) {
      reply.code(400);
      return { error: "Invalid officer address" };
    }

    if (!borrowerAddress || !/^0x[a-fA-F0-9]{40}$/.test(borrowerAddress)) {
      reply.code(400);
      return { error: "Invalid borrower address" };
    }

    if (quantity <= 0) {
      reply.code(400);
      return { error: "Quantity must be positive" };
    }

    if (durationDays <= 0 || durationDays > 30) {
      reply.code(400);
      return { error: "Duration must be 1-30 days" };
    }

    try {
      // Verify officer rank
      const member = await getMemberFromChain(guildId, officerAddress);
      if (member.rank < 1) {
        reply.code(403);
        return { error: "Only officers can lend items" };
      }

      // Verify borrower is a guild member
      const borrower = await getMemberFromChain(guildId, borrowerAddress);
      if (!borrower || borrower.address === "0x0000000000000000000000000000000000000000") {
        reply.code(400);
        return { error: "Borrower must be a guild member" };
      }

      const { loanId, txHash } = await lendItemOnChain(
        guildId,
        tokenId,
        quantity,
        borrowerAddress,
        durationDays
      );

      // Note: In production, you'd transfer the item from vault to borrower
      // This would happen via transferItem()

      server.log.info(
        `Officer ${officerAddress} lent ${quantity}x tokenId ${tokenId} from guild ${guildId} vault to ${borrowerAddress} for ${durationDays} days`
      );

      return {
        ok: true,
        guildId,
        loanId,
        tokenId,
        quantity,
        borrowerAddress,
        durationDays,
        txHash,
      };
    } catch (err) {
      server.log.error(err, `Failed to lend item from guild ${guildId} vault`);
      reply.code(500);
      return { error: "Failed to lend item" };
    }
  });

  /**
   * POST /guild/:guildId/vault/return
   * Return borrowed item to vault.
   */
  server.post<{
    Params: { guildId: string };
    Body: { loanId: number; borrowerAddress: string };
  }>("/guild/:guildId/vault/return", async (request, reply) => {
    const guildId = parseInt(request.params.guildId, 10);
    const { loanId, borrowerAddress } = request.body;

    if (!borrowerAddress || !/^0x[a-fA-F0-9]{40}$/.test(borrowerAddress)) {
      reply.code(400);
      return { error: "Invalid borrower address" };
    }

    try {
      const txHash = await returnItemOnChain(loanId, borrowerAddress);

      // Note: In production, you'd transfer the item from borrower back to vault
      // This would happen via transferItem()

      server.log.info(
        `${borrowerAddress} returned loan ${loanId} to guild ${guildId} vault`
      );

      return {
        ok: true,
        guildId,
        loanId,
        txHash,
      };
    } catch (err) {
      server.log.error(err, `Failed to return item to guild ${guildId} vault`);
      reply.code(500);
      return { error: "Failed to return item" };
    }
  });

  /**
   * GET /guild/:guildId/vault/loans/:borrowerAddress
   * Get all items lent to a specific member.
   */
  server.get<{
    Params: { guildId: string; borrowerAddress: string };
  }>("/guild/:guildId/vault/loans/:borrowerAddress", async (request, reply) => {
    const guildId = parseInt(request.params.guildId, 10);
    const { borrowerAddress } = request.params;

    if (!borrowerAddress || !/^0x[a-fA-F0-9]{40}$/.test(borrowerAddress)) {
      reply.code(400);
      return { error: "Invalid borrower address" };
    }

    try {
      const lentItems = await getLentItemsFromChain(guildId, borrowerAddress);

      return {
        guildId,
        borrowerAddress,
        lentItems: lentItems.map((item) => {
          const itemInfo = getItemByTokenId(BigInt(item.tokenId));
          const now = Math.floor(Date.now() / 1000);
          return {
            tokenId: item.tokenId,
            itemName: itemInfo?.name ?? "Unknown Item",
            quantity: item.quantity,
            lentAt: item.lentAt,
            dueAt: item.dueAt,
            isOverdue: now > item.dueAt,
            timeRemaining: Math.max(0, item.dueAt - now),
          };
        }),
      };
    } catch (err) {
      server.log.error(err, `Failed to get lent items for ${borrowerAddress} in guild ${guildId}`);
      reply.code(500);
      return { error: "Failed to get lent items" };
    }
  });
}
