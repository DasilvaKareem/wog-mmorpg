import { burnItem, getGoldBalance, getItemBalance, mintItem } from "../blockchain/blockchain.js";
import { copperToGold } from "../blockchain/currency.js";
import { getAvailableGoldAsync, recordGoldSpendAsync } from "../blockchain/goldLedger.js";
import {
  advanceBuildingStage,
  getBuildingStatus,
  getNextStageRequirements,
} from "../farming/buildingSystem.js";

export async function constructBuildingStage(
  plotId: string,
  walletAddress: string
): Promise<{
  ok: boolean;
  error?: string;
  newStage?: number;
  complete?: boolean;
  status?: Awaited<ReturnType<typeof getBuildingStatus>>;
}> {
  const req = await getNextStageRequirements(plotId);
  if (!req.ok || !req.stage) {
    return { ok: false, error: req.error };
  }

  const copperCost = req.stage.copperCost;
  if (copperCost > 0) {
    const goldCost = copperToGold(copperCost);
    const onChainGold = parseFloat(await getGoldBalance(walletAddress));
    const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
    const availableGold = await getAvailableGoldAsync(walletAddress, safeOnChainGold);
    if (availableGold < goldCost) {
      return { ok: false, error: `Not enough gold. Need ${copperCost} copper.` };
    }
  }

  for (const mat of req.stage.materials) {
    const balance = await getItemBalance(walletAddress, mat.tokenId);
    if (balance < BigInt(mat.quantity)) {
      return {
        ok: false,
        error: `Not enough ${mat.name}. Need ${mat.quantity}, have ${balance.toString()}.`,
      };
    }
  }

  for (const mat of req.stage.materials) {
    try {
      await burnItem(walletAddress, mat.tokenId, BigInt(mat.quantity));
    } catch (err: any) {
      return { ok: false, error: `Failed to burn ${mat.name}: ${err.message}` };
    }
  }

  const result = await advanceBuildingStage(plotId, walletAddress);
  if (!result.ok) {
    for (const mat of req.stage.materials) {
      try {
        await mintItem(walletAddress, mat.tokenId, BigInt(mat.quantity));
      } catch {
        // Best-effort compensation; the original error is more actionable to callers.
      }
    }
    return result;
  }

  if (copperCost > 0) {
    await recordGoldSpendAsync(walletAddress, copperToGold(copperCost));
  }

  return {
    ok: true,
    newStage: result.newStage,
    complete: result.complete,
    status: await getBuildingStatus(plotId),
  };
}
