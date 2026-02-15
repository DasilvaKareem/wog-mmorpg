import type { FastifyInstance } from "fastify";
import { distributeSFuel, mintGold, getGoldBalance, getItemBalance } from "./blockchain.js";
import { formatGold, getAvailableGold, getSpentGold } from "./goldLedger.js";
import { ITEM_CATALOG } from "./itemCatalog.js";

// Track registered wallets to avoid duplicate welcome bonuses
const registeredWallets = new Set<string>();

export function registerWalletRoutes(server: FastifyInstance) {
  /**
   * POST /wallet/register { address }
   * First-time wallet setup: distributes sFUEL + mints 50 welcome gold.
   */
  server.post<{ Body: { address: string } }>(
    "/wallet/register",
    async (request, reply) => {
      const { address } = request.body;

      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        reply.code(400);
        return { error: "Invalid Ethereum address" };
      }

      const normalized = address.toLowerCase();

      if (registeredWallets.has(normalized)) {
        return { ok: true, message: "Already registered" };
      }

      try {
        const sfuelTx = await distributeSFuel(address);
        server.log.info(`sFUEL sent to ${address}: ${sfuelTx}`);

        const goldTx = await mintGold(address, "50");
        server.log.info(`50 GOLD minted to ${address}: ${goldTx}`);

        registeredWallets.add(normalized);

        return {
          ok: true,
          message: "Wallet registered",
          sfuelTx,
          goldTx,
        };
      } catch (err) {
        server.log.error(err, `Failed to register wallet ${address}`);
        reply.code(500);
        return { error: "Blockchain transaction failed" };
      }
    }
  );

  /**
   * GET /wallet/:address/balance
   * Returns gold balance + all item balances from chain.
   */
  server.get<{ Params: { address: string } }>(
    "/wallet/:address/balance",
    async (request, reply) => {
      const { address } = request.params;

      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        reply.code(400);
        return { error: "Invalid Ethereum address" };
      }

      try {
        const onChainGold = parseFloat(await getGoldBalance(address));
        const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
        const spentGold = getSpentGold(address);
        const availableGold = getAvailableGold(address, safeOnChainGold);

        const items: {
          tokenId: string;
          name: string;
          balance: string;
          category: string;
          equipSlot: string | null;
          armorSlot: string | null;
          statBonuses: Record<string, number>;
          maxDurability: number | null;
        }[] = [];
        for (const item of ITEM_CATALOG) {
          const balance = await getItemBalance(address, item.tokenId);
          if (balance > 0n) {
            items.push({
              tokenId: item.tokenId.toString(),
              name: item.name,
              balance: balance.toString(),
              category: item.category,
              equipSlot: item.equipSlot ?? null,
              armorSlot: item.armorSlot ?? null,
              statBonuses: item.statBonuses ?? {},
              maxDurability: item.maxDurability ?? null,
            });
          }
        }

        return {
          address,
          gold: formatGold(availableGold),
          onChainGold: formatGold(safeOnChainGold),
          spentGold: formatGold(spentGold),
          items,
        };
      } catch (err) {
        server.log.error(err, `Failed to fetch balance for ${address}`);
        reply.code(500);
        return { error: "Failed to read blockchain state" };
      }
    }
  );
}
