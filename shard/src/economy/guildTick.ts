import type { FastifyInstance } from "fastify";
import {
  getNextProposalId,
  getProposalFromChain,
  executeProposalOnChain,
  ProposalStatus,
  ProposalType,
} from "./guildChain.js";
import { recordGoldSpend, unreserveGold } from "../blockchain/goldLedger.js";

const TICK_INTERVAL_MS = 10000; // 10 seconds

/**
 * Check all active proposals and execute any where voting has ended.
 */
async function guildTick(server: FastifyInstance) {
  try {
    const nextId = await getNextProposalId();
    const now = Math.floor(Date.now() / 1000);

    for (let i = 0; i < nextId; i++) {
      try {
        const proposal = await getProposalFromChain(i);

        // Skip if not active
        if (proposal.status !== ProposalStatus.Active) continue;

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

          if (passed) {
            server.log.info(
              `Proposal ${i} passed and executed (type: ${proposal.proposalType})`
            );

            // If it's a gold withdrawal, handle the transfer on the server side
            if (proposal.proposalType === ProposalType.WithdrawGold) {
              // Note: The contract already deducted from treasury and sent to recipient
              // Apply 3% protocol tax on the withdrawal amount
              const taxRate = 0.03;
              const taxAmount = proposal.targetAmount * taxRate;
              if (taxAmount > 0 && proposal.targetAddress) {
                recordGoldSpend(proposal.targetAddress, taxAmount);
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
 * The tick runs every 10 seconds to check for proposals ready to execute.
 */
export function registerGuildTick(server: FastifyInstance) {
  server.log.info("Registering guild tick (10s interval)");

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
