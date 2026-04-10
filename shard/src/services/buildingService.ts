import { enqueueItemBurn, enqueueItemMint, getGoldBalance, getItemBalance } from "../blockchain/blockchain.js";
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
      await enqueueItemBurn(walletAddress, mat.tokenId, BigInt(mat.quantity));
    } catch (err: any) {
      return { ok: false, error: `Failed to burn ${mat.name}: ${err.message}` };
    }
  }

  const result = await advanceBuildingStage(plotId, walletAddress);
  if (!result.ok) {
    const refundFailures: string[] = [];
    for (const mat of req.stage.materials) {
      try {
        await enqueueItemMint(walletAddress, mat.tokenId, BigInt(mat.quantity));
      } catch {
        refundFailures.push(`${mat.quantity}x ${mat.name}`);
      }
    }
    return {
      ...result,
      error: refundFailures.length > 0
        ? `${result.error ?? "Construction failed"}; failed to restore ${refundFailures.join(", ")}`
        : result.error,
    };
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
