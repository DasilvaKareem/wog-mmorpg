/**
 * Plot Chain Layer — fire-and-forget bridge between in-memory plot state
 * and the WoGLandRegistry contract on SKALE Base.
 *
 * All functions silently swallow errors — chain failures never break gameplay.
 * Follows the same pattern as nameServiceChain.ts and reputationChain.ts.
 */

import { ethers } from "ethers";
import { biteSigner, biteWallet } from "../blockchain/biteChain.js";
import { queueBiteTransaction, reserveServerNonce, waitForBiteReceipt, waitForBiteSubmission } from "../blockchain/biteTxQueue.js";
import { traceTx } from "../blockchain/txTracer.js";

const LAND_REGISTRY_ADDRESS = process.env.LAND_REGISTRY_CONTRACT_ADDRESS;

const LAND_REGISTRY_ABI = [
  "function claimPlot(string plotId, string zoneId, uint16 x, uint16 y, address owner) external returns (uint256)",
  "function releasePlot(address owner) external",
  "function transferPlot(address from, address to) external",
  "function updateBuilding(uint256 tokenId, string buildingType, uint8 stage) external",
  "function getPlotByOwner(address owner) external view returns (tuple(string plotId, string zoneId, uint16 x, uint16 y, string buildingType, uint8 buildingStage, uint256 claimedAt))",
  "function getPlotByPlotId(string plotId) external view returns (tuple(string plotId, string zoneId, uint16 x, uint16 y, string buildingType, uint8 buildingStage, uint256 claimedAt), address owner)",
  "function ownerPlot(address) external view returns (uint256)",
  "function plotIdToToken(bytes32) external view returns (uint256)",
  "event PlotClaimed(uint256 indexed tokenId, string plotId, string zoneId, address indexed owner)",
  "event PlotReleased(uint256 indexed tokenId, string plotId, address indexed previousOwner)",
  "event PlotTransferred(uint256 indexed tokenId, address indexed from, address indexed to)",
  "event BuildingUpdated(uint256 indexed tokenId, string buildingType, uint8 stage)",
];

const landRegistryContract =
  LAND_REGISTRY_ADDRESS && (biteSigner ?? biteWallet)
    ? new ethers.Contract(LAND_REGISTRY_ADDRESS, LAND_REGISTRY_ABI, biteSigner ?? biteWallet)
    : null;

if (LAND_REGISTRY_ADDRESS) {
  console.log(`[plotChain] Land registry at ${LAND_REGISTRY_ADDRESS}`);
} else {
  console.warn("[plotChain] LAND_REGISTRY_CONTRACT_ADDRESS not set — on-chain land registration disabled");
}

async function currentPlotOwner(plotId: string): Promise<string | null> {
  if (!landRegistryContract) return null;
  try {
    const [, owner] = await landRegistryContract.getPlotByPlotId(plotId);
    return owner === ethers.ZeroAddress ? null : String(owner);
  } catch {
    return null;
  }
}

async function ownerHasPlot(ownerAddress: string): Promise<boolean> {
  if (!landRegistryContract) return false;
  try {
    const tokenId: bigint = await landRegistryContract.ownerPlot(ownerAddress);
    return tokenId !== 0n;
  } catch {
    return false;
  }
}

/**
 * Register a plot claim on-chain. Fire-and-forget.
 */
export async function claimPlotOnChain(
  plotId: string,
  zoneId: string,
  x: number,
  y: number,
  ownerAddress: string,
): Promise<boolean> {
  if (!landRegistryContract) return false;
  try {
    const existingOwner = await currentPlotOwner(plotId);
    if (existingOwner?.toLowerCase() === ownerAddress.toLowerCase()) {
      return true;
    }
    return await traceTx("plot-claim", "claimPlotOnChain", { plotId, zoneId, owner: ownerAddress }, "bite", async () => {
      try {
        await queueBiteTransaction(`plot-claim:${plotId}:${ownerAddress}`, async () => {
          const tx = await waitForBiteSubmission(
            landRegistryContract.claimPlot(plotId, zoneId, x, y, ownerAddress, { nonce: await reserveServerNonce() ?? undefined })
          );
          await waitForBiteReceipt(tx.wait());
        });
      } catch (err) {
        const ownerAfterError = await currentPlotOwner(plotId);
        if (ownerAfterError?.toLowerCase() !== ownerAddress.toLowerCase()) {
          throw err;
        }
      }
      console.log(`[plotChain] Claimed "${plotId}" for ${ownerAddress}`);
      return true;
    });
  } catch (err: any) {
    console.warn(`[plotChain] claimPlot failed for ${ownerAddress}: ${err.message?.slice(0, 80)}`);
    return false;
  }
}

/**
 * Release a plot on-chain. Fire-and-forget.
 */
export async function releasePlotOnChain(ownerAddress: string): Promise<boolean> {
  if (!landRegistryContract) return false;
  try {
    if (!(await ownerHasPlot(ownerAddress))) {
      return true;
    }
    return await traceTx("plot-release", "releasePlotOnChain", { owner: ownerAddress }, "bite", async () => {
      try {
        await queueBiteTransaction(`plot-release:${ownerAddress}`, async () => {
          const tx = await waitForBiteSubmission(
            landRegistryContract.releasePlot(ownerAddress, { nonce: await reserveServerNonce() ?? undefined })
          );
          await waitForBiteReceipt(tx.wait());
        });
      } catch (err) {
        if (await ownerHasPlot(ownerAddress)) {
          throw err;
        }
      }
      console.log(`[plotChain] Released plot for ${ownerAddress}`);
      return true;
    });
  } catch (err: any) {
    console.warn(`[plotChain] releasePlot failed for ${ownerAddress}: ${err.message?.slice(0, 80)}`);
    return false;
  }
}

/**
 * Transfer a plot on-chain. Fire-and-forget.
 */
export async function transferPlotOnChain(
  fromAddress: string,
  toAddress: string,
): Promise<boolean> {
  if (!landRegistryContract) return false;
  try {
    if (await ownerHasPlot(toAddress)) {
      return true;
    }
    return await traceTx("plot-transfer", "transferPlotOnChain", { from: fromAddress, to: toAddress }, "bite", async () => {
      try {
        await queueBiteTransaction(`plot-transfer:${fromAddress}:${toAddress}`, async () => {
          const tx = await waitForBiteSubmission(
            landRegistryContract.transferPlot(fromAddress, toAddress, { nonce: await reserveServerNonce() ?? undefined })
          );
          await waitForBiteReceipt(tx.wait());
        });
      } catch (err) {
        if (await ownerHasPlot(toAddress) && !(await ownerHasPlot(fromAddress))) {
          return true;
        }
        throw err;
      }
      console.log(`[plotChain] Transferred plot ${fromAddress} → ${toAddress}`);
      return true;
    });
  } catch (err: any) {
    console.warn(`[plotChain] transferPlot failed: ${err.message?.slice(0, 80)}`);
    return false;
  }
}

/**
 * Update building state on-chain. Fire-and-forget.
 */
export async function updateBuildingOnChain(
  plotId: string,
  buildingType: string,
  stage: number,
): Promise<boolean> {
  if (!landRegistryContract) return false;
  try {
    // Resolve tokenId from plotId hash
    const plotHash = ethers.keccak256(ethers.toUtf8Bytes(plotId));
    const tokenId: bigint = await landRegistryContract.plotIdToToken(plotHash);
    if (tokenId === 0n) {
      console.warn(`[plotChain] updateBuilding: plot "${plotId}" not registered on-chain`);
      return false;
    }

    return await traceTx("plot-building", "updateBuildingOnChain", { plotId, buildingType, stage }, "bite", async () => {
      await queueBiteTransaction(`plot-building:${plotId}:${buildingType}:${stage}`, async () => {
        const tx = await waitForBiteSubmission(
          landRegistryContract.updateBuilding(tokenId, buildingType, stage, { nonce: await reserveServerNonce() ?? undefined })
        );
        await waitForBiteReceipt(tx.wait());
      });
      console.log(`[plotChain] Updated building on "${plotId}": ${buildingType} stage ${stage}`);
      return true;
    });
  } catch (err: any) {
    console.warn(`[plotChain] updateBuilding failed for "${plotId}": ${err.message?.slice(0, 80)}`);
    return false;
  }
}
