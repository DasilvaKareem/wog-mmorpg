import type { FastifyInstance } from "fastify";
import {
  getNextProposalId,
  getProposalFromChain,
  executeProposalOnChain,
  ProposalStatus,
  ProposalType,
  refreshGuildNameCache,
} from "./guildChain.js";
import { recordGoldSpendAsync } from "../blockchain/goldLedger.js";

const TICK_INTERVAL_MS = 30_000; // 30 seconds (was 10s — proposals have 24hr voting)

// Track known-active proposal IDs to avoid scanning all proposals each tick
const activeProposals = new Set<number>();
let initialScanDone = false;

/** Call when a new proposal is created to add it to the active set. */
export function addActiveProposal(proposalId: number): void {
  activeProposals.add(proposalId);
}

/**
 * Initial scan: read all proposals to seed the active set.
 * Only runs once on first tick.
 */
async function seedActiveProposals(server: FastifyInstance): Promise<void> {
  try {
    const nextId = await getNextProposalId();
    for (let i = 0; i < nextId; i++) {
      try {
        const proposal = await getProposalFromChain(i);
        if (proposal.status === ProposalStatus.Active) {
          activeProposals.add(i);
        }
      } catch {
        // Skip errors for individual proposals
      }
    }
    server.log.info(`[guild-tick] Seeded ${activeProposals.size} active proposals (scanned ${nextId})`);
  } catch (err) {
    server.log.error(err, "[guild-tick] Failed to seed active proposals");
  }
  initialScanDone = true;
}

/**
 * Check only known-active proposals and execute any where voting has ended.
 */
async function guildTick(server: FastifyInstance) {
  if (!initialScanDone) {
    await seedActiveProposals(server);
    return; // give the first real tick a clean start
  }

  // Nothing to check
  if (activeProposals.size === 0) return;

  try {
    const now = Math.floor(Date.now() / 1000);

    for (const i of activeProposals) {
      try {
        const proposal = await getProposalFromChain(i);
        const proposalChangesGuildLabels =
          proposal.proposalType === ProposalType.KickMember ||
          proposal.proposalType === ProposalType.DisbandGuild;

        // If no longer active, remove from tracking set
        if (proposal.status !== ProposalStatus.Active) {
          if (proposal.status === ProposalStatus.Executed && proposalChangesGuildLabels) {
            await refreshGuildNameCache().catch((err) => {
              server.log.warn(`[guild-tick] Failed to refresh guild cache after observed execution of proposal ${i}: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
            });
          }
          activeProposals.delete(i);
          continue;
        }

        // Check if voting period has ended
        if (now >= proposal.votingEndsAt) {
          server.log.info(
            `Proposal ${i} voting ended. Executing... (yes: ${proposal.yesVotes}, no: ${proposal.noVotes})`
          );

          // Execute proposal on-chain
          await executeProposalOnChain(i);

          // Fetch updated proposal to see if it passed
          const updatedProposal = await getProposalFromChain(i);
          const passed = updatedProposal.status === ProposalStatus.Executed;

          // Remove from active set regardless of pass/fail
          activeProposals.delete(i);

          if (passed) {
            server.log.info(
              `Proposal ${i} passed and executed (type: ${proposal.proposalType})`
            );

            if (proposalChangesGuildLabels) {
              await refreshGuildNameCache().catch((err) => {
                server.log.warn(`[guild-tick] Failed to refresh guild cache after executing proposal ${i}: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
              });
            }

            // If it's a gold withdrawal, handle the transfer on the server side
            if (proposal.proposalType === ProposalType.WithdrawGold) {
              // Note: The contract already deducted from treasury and sent to recipient
              // Apply 3% protocol tax on the withdrawal amount
              const taxRate = 0.03;
              const taxAmount = proposal.targetAmount * taxRate;
              if (taxAmount > 0 && proposal.targetAddress) {
                await recordGoldSpendAsync(proposal.targetAddress, taxAmount);
                server.log.info(
                  `Guild withdrawal tax: ${taxAmount.toFixed(4)} gold (3%) from ${proposal.targetAmount} gold to ${proposal.targetAddress}`
                );
              } else {
                server.log.info(
                  `Guild withdrawal: ${proposal.targetAmount} gold to ${proposal.targetAddress}`
                );
              }
            }
          } else {
            server.log.info(`Proposal ${i} failed (more no votes than yes votes)`);
          }
        }
      } catch (err) {
        server.log.error(err, `Error processing proposal ${i} in guild tick`);
      }
    }
  } catch (err) {
    server.log.error(err, "Error in guild tick");
  }
}

/**
 * Register the guild tick with the server.
 * The tick runs every 30 seconds to check for proposals ready to execute.
 */
export function registerGuildTick(server: FastifyInstance) {
  server.log.info("Registering guild tick (30s interval)");

  const tickInterval = setInterval(() => {
    guildTick(server).catch((err) => {
      server.log.error(err, "Unhandled error in guild tick");
    });
  }, TICK_INTERVAL_MS);

  // Clean up interval when server closes
  server.addHook("onClose", async () => {
    clearInterval(tickInterval);
    server.log.info("Guild tick stopped");
  });
}
