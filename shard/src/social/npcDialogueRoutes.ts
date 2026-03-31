import type { FastifyInstance } from "fastify";
import { authenticateRequest, walletsMatch } from "../auth/auth.js";
import { getAgentCustodialWallet } from "../agents/agentConfigStore.js";
import { getEntity } from "../world/zoneRuntime.js";
import { isQuestNpc } from "./questSystem.js";
import {
  generateNpcDialogueResponse,
  type NpcDialogueHistoryEntry,
} from "./npcDialogueService.js";

interface NpcDialogueBody {
  npcEntityId: string;
  entityId?: string;
  playerId?: string;
  message: string;
  recentHistory?: NpcDialogueHistoryEntry[];
}

async function playerWalletMatches(authenticatedWallet: string, playerWalletAddress?: string): Promise<boolean> {
  if (walletsMatch(authenticatedWallet, playerWalletAddress)) return true;
  const custodialWallet = await getAgentCustodialWallet(authenticatedWallet);
  return walletsMatch(custodialWallet, playerWalletAddress);
}

export function registerNpcDialogueRoutes(server: FastifyInstance): void {
  server.post<{ Body: NpcDialogueBody }>("/npc/dialogue", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authenticatedWallet = (request as any).walletAddress as string;
    const playerId = request.body.entityId || request.body.playerId;
    const npcEntityId = request.body.npcEntityId;
    const message = request.body.message?.trim();

    if (!playerId || !npcEntityId || !message) {
      reply.code(400);
      return { error: "entityId (or playerId), npcEntityId, and message are required" };
    }

    const player = getEntity(playerId);
    if (!player || player.type !== "player") {
      reply.code(404);
      return { error: "Player not found" };
    }

    if (!(await playerWalletMatches(authenticatedWallet, player.walletAddress))) {
      reply.code(403);
      return { error: "Not authorized to chat on behalf of this player" };
    }

    const npc = getEntity(npcEntityId);
    if (!npc) {
      reply.code(404);
      return { error: "NPC not found" };
    }

    const DIALOGUE_NPC_TYPES = new Set([
      "quest-giver", "lore-npc", "trainer", "profession-trainer",
      "merchant", "crafting-master",
    ]);
    if (!DIALOGUE_NPC_TYPES.has(npc.type) && npc.name !== "Scout Kaela") {
      reply.code(400);
      return { error: "This NPC has nothing to say" };
    }

    const response = await generateNpcDialogueResponse({
      npc,
      player,
      message,
      recentHistory: request.body.recentHistory ?? [],
    });

    return reply.send(response);
  });
}
