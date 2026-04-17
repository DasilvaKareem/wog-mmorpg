import { getGoldBalance } from "../blockchain/blockchain.js";
import { copperToGold } from "../blockchain/currency.js";
import { getAvailableGoldAsync, recordGoldSpendAsync } from "../blockchain/goldLedger.js";
import { claimPlot, getPlotDef, releasePlot } from "../farming/plotSystem.js";
import type { PlotState } from "../farming/plotSystem.js";

export async function claimPlotForWallet(
  plotId: string,
  walletAddress: string,
  ownerName: string
): Promise<{ ok: boolean; error?: string; plot?: PlotState; costGold?: number }> {
  const def = getPlotDef(plotId);
  if (!def) return { ok: false, error: "Plot not found." };

  const goldCost = copperToGold(def.cost * 100);
  const onChainGold = parseFloat(await getGoldBalance(walletAddress));
  const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
  const availableGold = await getAvailableGoldAsync(walletAddress, safeOnChainGold);
  if (availableGold < goldCost) {
    return { ok: false, error: `Not enough gold. Need ${def.cost} gold.` };
  }

  const result = await claimPlot(plotId, walletAddress, ownerName);
  if (!result.ok) return result;

  try {
    await recordGoldSpendAsync(walletAddress, goldCost);
  } catch (err: any) {
    await releasePlot(walletAddress).catch(() => {});
    return { ok: false, error: err?.message ?? "Failed to record plot purchase." };
  }
  return { ...result, costGold: goldCost };
}
