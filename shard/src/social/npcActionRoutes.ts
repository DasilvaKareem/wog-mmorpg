import type { FastifyInstance } from "fastify";
import { authenticateRequest, walletsMatch } from "../auth/auth.js";
import { getAgentCustodialWallet } from "../agents/agentConfigStore.js";
import { getEntity } from "../world/zoneRuntime.js";
import { getRedis, isMemoryFallbackAllowed } from "../redis.js";
import { generateNpcDialogueResponse } from "./npcDialogueService.js";
import { QUEST_CATALOG, npcMatchesQuestId } from "./questSystem.js";
import type { NpcActionKind } from "./npcDialogueValidator.js";

interface NpcActionBody {
  npcEntityId: string;
  entityId?: string;
  playerId?: string;
  action: { kind: NpcActionKind; questId?: string };
}

const ALLOWED_KINDS: ReadonlySet<NpcActionKind> = new Set<NpcActionKind>([
  "accept_quest", "complete_quest", "open_shop", "open_quests_tab", "open_skills", "farewell",
]);

const DIALOGUE_NPC_TYPES = new Set([
  "quest-giver", "lore-npc", "trainer", "profession-trainer",
  "merchant", "crafting-master", "guild-registrar", "auctioneer",
  "arena-master", "forge", "alchemy-lab", "enchanting-altar",
  "campfire", "tanning-rack", "jewelers-bench",
]);

async function playerWalletMatches(authenticatedWallet: string, playerWalletAddress?: string): Promise<boolean> {
  if (walletsMatch(authenticatedWallet, playerWalletAddress)) return true;
  const custodialWallet = await getAgentCustodialWallet(authenticatedWallet);
  return walletsMatch(custodialWallet, playerWalletAddress);
}

/** Best-effort 5s idempotency guard so a double-click can't accept twice.
 * Falls back to allow if Redis is unavailable in dev/local. */
async function acquireIdempotency(key: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return isMemoryFallbackAllowed() ? true : true;
  try {
    const set = await redis.set(key, "1", "EX", 5, "NX");
    return set === "OK";
  } catch {
    return true;
  }
}

/** Synthetic player message used to coax an in-character NPC follow-up after
 * a one-click action executes. Each kind gets a deterministic phrasing so
 * the LLM produces a fitting "Good, get to it." / "Here's your reward." beat. */
function syntheticPlayerMessage(kind: NpcActionKind, questTitle?: string): string {
  if (kind === "accept_quest") return questTitle ? `I'll take ${questTitle}.` : "I'll accept the quest.";
  if (kind === "complete_quest") return questTitle ? `I'm ready to turn in ${questTitle}.` : "I'm ready to turn it in.";
  if (kind === "farewell") return "Take care for now.";
  if (kind === "open_shop") return "Show me your wares.";
  if (kind === "open_quests_tab") return "Show me your jobs.";
  if (kind === "open_skills") return "Teach me what you know.";
  return "Thanks.";
}

export function registerNpcActionRoutes(server: FastifyInstance): void {
  server.post<{ Body: NpcActionBody }>("/npc/action", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authenticatedWallet = (request as any).walletAddress as string;
    const playerId = request.body.entityId || request.body.playerId;
    const npcEntityId = request.body.npcEntityId;
    const action = request.body.action;

    if (!playerId || !npcEntityId || !action || !ALLOWED_KINDS.has(action.kind)) {
      reply.code(400);
      return { error: "playerId/entityId, npcEntityId, and a valid action.kind are required" };
    }

    const player = getEntity(playerId);
    if (!player || player.type !== "player") {
      reply.code(404);
      return { error: "Player not found" };
    }
    if (!(await playerWalletMatches(authenticatedWallet, player.walletAddress))) {
      reply.code(403);
      return { error: "Not authorized to act on behalf of this player" };
    }

    const npc = getEntity(npcEntityId);
    if (!npc) {
      reply.code(404);
      return { error: "NPC not found" };
    }
    if (!DIALOGUE_NPC_TYPES.has(npc.type) && npc.name !== "Scout Kaela") {
      reply.code(400);
      return { error: "This NPC does not take actions" };
    }

    // Resolve the quest (if any) so we can validate authority before dispatch.
    let questTitle: string | undefined;
    if (action.kind === "accept_quest" || action.kind === "complete_quest") {
      if (!action.questId) {
        reply.code(400);
        return { error: `${action.kind} requires action.questId` };
      }
      const quest = QUEST_CATALOG.find((q) => q.id === action.questId);
      if (!quest) {
        reply.code(404);
        return { error: "Quest not found" };
      }
      if (!npcMatchesQuestId(npc, quest.npcId)) {
        reply.code(403);
        return { error: "This NPC does not own that quest" };
      }
      questTitle = quest.title;
    }

    // Idempotency: same (player, npc, kind, questId) within 5s collapses to one
    // dispatch. Subsequent calls return the synthesized follow-up dialogue
    // (cheap — single LLM round-trip) so the UI still gets a beat without
    // re-applying side effects.
    const idemKey = `npc:action:${player.id}:${npc.id}:${action.kind}:${action.questId ?? ""}`;
    const acquired = await acquireIdempotency(idemKey);

    let result: Record<string, unknown> = {};
    if (acquired) {
      if (action.kind === "accept_quest" || action.kind === "complete_quest") {
        const url = action.kind === "accept_quest" ? "/quests/accept" : "/quests/complete";
        const inj = await server.inject({
          method: "POST",
          url,
          headers: { authorization: request.headers["authorization"] ?? "" },
          payload: {
            entityId: player.id,
            zoneId: player.region ?? npc.region,
            questId: action.questId,
            ...(action.kind === "complete_quest" ? { npcId: npc.id } : {}),
          },
        });
        try {
          result = inj.json();
        } catch {
          result = { raw: inj.body };
        }
        if (inj.statusCode >= 400) {
          // Surface the underlying error but still let the NPC respond
          // with a deterministic line so the conversation doesn't dead-end.
          return reply.send({
            ok: false,
            result,
            dialogue: await generateNpcDialogueResponse({
              npc,
              player,
              message: "Something went wrong — what now?",
              recentHistory: [],
            }),
          });
        }
      }
      // open_shop / open_quests_tab / open_skills / farewell have no server
      // side-effect — they're client-side hints. `result` stays empty.
    } else {
      result = { idempotent: true };
    }

    // Generate the in-character follow-up beat. We pass the synthetic player
    // message so the LLM (or deterministic fallback) responds to the action
    // contextually ("Good. Get to it." for accept, "Well done." for complete).
    const dialogue = await generateNpcDialogueResponse({
      npc,
      player,
      message: syntheticPlayerMessage(action.kind, questTitle),
      recentHistory: [],
    });

    return reply.send({ ok: true, result, dialogue });
  });
}
