/**
 * Reputation System Tests
 * Run with: npx tsx tests/reputation.test.ts
 *
 * Covers the current agent-keyed reputation manager behavior without Jest.
 * If chain config is present, also checks eventual consistency against the
 * on-chain reputation registry.
 */

import { reputationManager, ReputationCategory } from "../src/economy/reputationManager.js";
import { getReputationOnChain } from "../src/economy/reputationChain.js";
import { biteWallet } from "../src/blockchain/biteChain.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, details?: unknown): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    if (details !== undefined) {
      console.error(`    ${typeof details === "string" ? details : JSON.stringify(details)}`);
    }
    failed++;
  }
}

function section(name: string): void {
  console.log(`\n── ${name} ──`);
}

async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs: number
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

function snapshot(agentId: string) {
  const rep = reputationManager.getReputation(agentId);
  return rep ? { ...rep } : null;
}

const agentA = `rep-agent-a-${Date.now()}`;
const agentB = `rep-agent-b-${Date.now()}`;

section("Initialization");

reputationManager.ensureInitialized(agentA);
const initialA = snapshot(agentA);
assert(initialA !== null, "ensureInitialized creates a reputation entry");
assert(initialA?.combat === 500, "Initial combat reputation is 500", initialA);
assert(initialA?.economic === 500, "Initial economic reputation is 500", initialA);
assert(initialA?.social === 500, "Initial social reputation is 500", initialA);
assert(initialA?.overall === 500, "Initial overall reputation is 500", initialA);

section("Agent-Keyed Updates");

reputationManager.submitFeedback(agentA, ReputationCategory.Social, 10, "Helped a new player");
const afterSocial = reputationManager.getReputation(agentA);
assert(afterSocial?.social === 510, "submitFeedback updates the targeted category", afterSocial);
assert(afterSocial?.overall === 502, "submitFeedback recalculates overall score", afterSocial);

reputationManager.batchUpdateReputation(
  agentA,
  { combat: 5, economic: 3, social: 2 },
  "Tournament participation"
);
const afterBatch = snapshot(agentA);
assert(afterBatch?.combat === 505, "batchUpdateReputation updates combat", afterBatch);
assert(afterBatch?.economic === 503, "batchUpdateReputation updates economic", afterBatch);
assert(afterBatch?.social === 512, "batchUpdateReputation updates social cumulatively", afterBatch);
assert(afterBatch?.overall === 504, "batchUpdateReputation updates overall", afterBatch);

section("Isolation");

reputationManager.ensureInitialized(agentB);
const isolatedB = reputationManager.getReputation(agentB);
assert(isolatedB?.overall === 500, "A second agent starts from its own default reputation", isolatedB);
assert(
  isolatedB?.social === 500 && afterBatch?.social === 512,
  "Distinct agentIds do not leak reputation into each other",
  { agentA: afterBatch, agentB: isolatedB }
);

section("Feedback History + Ranks");

const historyA = reputationManager.getFeedbackHistory(agentA, 10);
assert(Array.isArray(historyA), "Feedback history returns an array");
assert(historyA.length >= 2, "Feedback history captures submitted updates", historyA);
assert(historyA[0]?.agentId === agentA, "Feedback history remains keyed by agentId", historyA[0]);

assert(reputationManager.getReputationRank(500) === "Average Citizen", "Rank 500 maps to Average Citizen");
assert(reputationManager.getReputationRank(800) === "Renowned Champion", "Rank 800 maps to Renowned Champion");
assert(reputationManager.getReputationRank(950) === "Legendary Hero", "Rank 950 maps to Legendary Hero");

section("Economic Helpers");

const beforeEconomic = snapshot(agentB);
reputationManager.updateEconomicReputation(agentB, true, true);
const afterEconomicWin = snapshot(agentB);
assert(
  (afterEconomicWin?.economic ?? 0) > (beforeEconomic?.economic ?? 0),
  "updateEconomicReputation rewards fair completed trades",
  { beforeEconomic, afterEconomicWin }
);

reputationManager.updateEconomicReputation(agentB, false, false);
const afterEconomicLoss = snapshot(agentB);
assert(
  (afterEconomicLoss?.economic ?? 0) < (afterEconomicWin?.economic ?? 0),
  "updateEconomicReputation penalizes failed trades",
  { afterEconomicWin, afterEconomicLoss }
);

section("Optional Chain Convergence");

if (process.env.REPUTATION_REGISTRY_ADDRESS && process.env.SKALE_BASE_RPC_URL && biteWallet) {
  const chainAgentId = `rep-chain-${Date.now()}`;
  reputationManager.ensureInitialized(chainAgentId);
  reputationManager.submitFeedback(
    chainAgentId,
    ReputationCategory.Social,
    7,
    "eventual-consistency-test"
  );

  const converged = await waitFor(async () => {
    const [apiScore, chainScore] = await Promise.all([
      reputationManager.getEventuallyConsistentReputation(chainAgentId),
      getReputationOnChain(chainAgentId),
    ]);
    if (!apiScore || !chainScore) return false;
    return apiScore.social === chainScore.social && apiScore.overall === chainScore.overall;
  }, 40_000, 5_000);

  const [finalLocal, finalChain] = await Promise.all([
    reputationManager.getEventuallyConsistentReputation(chainAgentId),
    getReputationOnChain(chainAgentId),
  ]);
  assert(
    converged,
    "Eventually-consistent reputation converges to the on-chain score when chain config is present",
    { finalLocal, finalChain }
  );
} else {
  console.log("  · Skipped on-chain convergence check (reputation registry RPC or signer not fully configured)");
}

console.log("\n==================================================");
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log("==================================================");

process.exit(failed > 0 ? 1 : 0);
