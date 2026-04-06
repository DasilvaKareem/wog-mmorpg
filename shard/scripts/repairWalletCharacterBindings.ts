import { resolveIdentityRegistrationTxHash } from "../src/blockchain/blockchain.js";
import { saveCharacter, loadAllCharactersForWallet } from "../src/character/characterStore.js";
import { getRedis } from "../src/redis.js";

async function main() {
  const wallet = process.argv[2]?.toLowerCase();
  const assignmentsArg = process.argv[3];
  if (!wallet || !assignmentsArg) {
    throw new Error("Usage: pnpm exec tsx scripts/repairWalletCharacterBindings.ts <wallet> '<name:token:agent,...>'");
  }

  const redis = getRedis();
  if (!redis) throw new Error("Redis is required");

  const assignments = new Map<string, { tokenId: string; agentId: string }>();
  for (const chunk of assignmentsArg.split(",")) {
    const [name, tokenId, agentId] = chunk.split(":").map((part) => part.trim());
    if (!name || !tokenId || !agentId) {
      throw new Error(`Invalid assignment chunk: ${chunk}`);
    }
    assignments.set(name.toLowerCase(), { tokenId, agentId });
  }

  const savedCharacters = await loadAllCharactersForWallet(wallet);
  const validTokens = new Set<string>();
  const validAgents = new Set<string>();

  for (const [nameKey, assignment] of assignments.entries()) {
    validTokens.add(assignment.tokenId);
    validAgents.add(assignment.agentId);
    const txHash = await resolveIdentityRegistrationTxHash(assignment.agentId, assignment.tokenId).catch(() => null);
    await saveCharacter(wallet, nameKey, {
      characterTokenId: assignment.tokenId,
      agentId: assignment.agentId,
      agentRegistrationTxHash: txHash,
      chainRegistrationStatus: "registered",
      chainRegistrationLastError: "",
    });
  }

  for (const character of savedCharacters) {
    const nameKey = character.name.trim().toLowerCase();
    if (assignments.has(nameKey)) continue;
    const tokenId = character.characterTokenId?.trim();
    const agentId = character.agentId?.trim();
    const overlapsKnownIdentity = Boolean(
      (tokenId && validTokens.has(tokenId)) || (agentId && validAgents.has(agentId))
    );
    if (!overlapsKnownIdentity) continue;

    await saveCharacter(wallet, character.name, {
      characterTokenId: null,
      agentId: null,
      agentRegistrationTxHash: null,
      chainRegistrationStatus: "unregistered",
      chainRegistrationLastError: "",
    });
  }

  console.log(JSON.stringify({
    wallet,
    repaired: Array.from(assignments.entries()).map(([name, assignment]) => ({ name, ...assignment })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
