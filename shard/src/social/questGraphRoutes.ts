import type { FastifyInstance } from "fastify";
import { authenticateRequest, walletsMatch } from "../auth/auth.js";
import { getAgentCustodialWallet } from "../agents/agentConfigStore.js";
import { getEntity } from "../world/zoneRuntime.js";
import { cloneQuestGraphPlayerState, persistQuestGraphPlayerState } from "./questGraphs/effects.js";
import { getQuestArcById, listQuestArcSummaries, QUEST_ARC_VALIDATION_ISSUES } from "./questGraphs/registry.js";
import { advanceQuestGraphScene, startQuestGraphScene } from "./questGraphs/runtime.js";

async function playerWalletMatches(authenticatedWallet: string, playerWalletAddress?: string): Promise<boolean> {
  if (walletsMatch(authenticatedWallet, playerWalletAddress)) return true;
  const custodialWallet = await getAgentCustodialWallet(authenticatedWallet);
  return walletsMatch(custodialWallet, playerWalletAddress);
}

interface QuestGraphStartBody {
  entityId?: string;
  playerId?: string;
  sceneId: string;
  commit?: boolean;
}

interface QuestGraphAdvanceBody extends QuestGraphStartBody {
  nodeId: string;
  choiceId?: string;
  freeformInput?: string;
}

export function registerQuestGraphRoutes(server: FastifyInstance): void {
  server.get("/quest-arcs", async () => ({
    arcs: listQuestArcSummaries(),
    validationIssues: QUEST_ARC_VALIDATION_ISSUES,
  }));

  server.get<{ Params: { arcId: string } }>("/quest-arcs/:arcId", async (request, reply) => {
    const arc = getQuestArcById(request.params.arcId);
    if (!arc) {
      reply.code(404);
      return { error: "Quest arc not found" };
    }

    return {
      arc,
      validationIssues: QUEST_ARC_VALIDATION_ISSUES.filter((issue) => issue.arcId === arc.id),
    };
  });

  server.post<{ Params: { arcId: string }; Body: QuestGraphStartBody }>("/quest-arcs/:arcId/start", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authenticatedWallet = (request as any).walletAddress as string;
    const playerId = request.body.entityId || request.body.playerId;
    const arc = getQuestArcById(request.params.arcId);

    if (!arc) {
      reply.code(404);
      return { error: "Quest arc not found" };
    }
    if (!playerId) {
      reply.code(400);
      return { error: "entityId (or playerId) is required" };
    }

    const player = getEntity(playerId);
    if (!player || player.type !== "player") {
      reply.code(404);
      return { error: "Player not found" };
    }
    if (!(await playerWalletMatches(authenticatedWallet, player.walletAddress))) {
      reply.code(403);
      return { error: "Not authorized for this player" };
    }

    const commit = Boolean(request.body.commit);
    const workingPlayer = commit ? player : cloneQuestGraphPlayerState(player);
    const result = await startQuestGraphScene(arc, request.body.sceneId, {
      player: workingPlayer,
      arcId: arc.id,
      sceneId: request.body.sceneId,
      commit,
    });

    if (commit && result.dirty) {
      await persistQuestGraphPlayerState(player);
    }

    return {
      arcId: arc.id,
      sceneId: request.body.sceneId,
      sceneTitle: arc.scenes[request.body.sceneId]?.title ?? request.body.sceneId,
      commit,
      node: result.node,
      appliedEffects: result.appliedEffects,
      dirty: result.dirty,
    };
  });

  server.post<{ Params: { arcId: string }; Body: QuestGraphAdvanceBody }>("/quest-arcs/:arcId/advance", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authenticatedWallet = (request as any).walletAddress as string;
    const playerId = request.body.entityId || request.body.playerId;
    const arc = getQuestArcById(request.params.arcId);

    if (!arc) {
      reply.code(404);
      return { error: "Quest arc not found" };
    }
    if (!playerId) {
      reply.code(400);
      return { error: "entityId (or playerId) is required" };
    }

    const player = getEntity(playerId);
    if (!player || player.type !== "player") {
      reply.code(404);
      return { error: "Player not found" };
    }
    if (!(await playerWalletMatches(authenticatedWallet, player.walletAddress))) {
      reply.code(403);
      return { error: "Not authorized for this player" };
    }

    const commit = Boolean(request.body.commit);
    const workingPlayer = commit ? player : cloneQuestGraphPlayerState(player);
    const result = await advanceQuestGraphScene(
      arc,
      request.body.sceneId,
      request.body.nodeId,
      {
        choiceId: request.body.choiceId,
        freeformInput: request.body.freeformInput,
      },
      {
        player: workingPlayer,
        arcId: arc.id,
        sceneId: request.body.sceneId,
        commit,
      },
    );

    if (commit && result.dirty) {
      await persistQuestGraphPlayerState(player);
    }

    return {
      arcId: arc.id,
      sceneId: request.body.sceneId,
      sceneTitle: arc.scenes[request.body.sceneId]?.title ?? request.body.sceneId,
      commit,
      node: result.node,
      appliedEffects: result.appliedEffects,
      dirty: result.dirty,
      resolution: result.resolution,
    };
  });
}
