import type { FastifyInstance } from "fastify";
import type { BattleManager } from "../../runtime/battle-manager.js";
import type { BattleAction } from "../../types/battle.js";
import { ACTIONS } from "../../types/battle.js";

interface StartBattleBody {
  playerId: string;
  playerName: string;
  enemyTemplateIds: string[];
}

export function registerBattleRoutes(app: FastifyInstance, battles: BattleManager): void {
  // List available actions
  app.get("/v1/battle/actions", (_req, reply) => {
    return reply.send({ actions: ACTIONS });
  });

  // Start a new battle
  app.post<{ Body: StartBattleBody }>("/v1/battle/start", (req, reply) => {
    const { playerId, playerName, enemyTemplateIds } = req.body ?? {};

    if (!playerId || !playerName || !enemyTemplateIds?.length) {
      return reply.status(400).send({ error: "playerId, playerName, and enemyTemplateIds[] are required" });
    }

    const result = battles.startBattle(playerId, playerName, enemyTemplateIds);

    if (typeof result === "string") {
      return reply.status(400).send({ error: result });
    }

    return reply.send(result.getState());
  });

  // Get battle state
  app.get<{ Params: { battleId: string } }>("/v1/battle/:battleId", (req, reply) => {
    const engine = battles.getBattle(req.params.battleId);
    if (!engine) {
      return reply.status(404).send({ error: "battle not found" });
    }
    return reply.send(engine.getState());
  });

  // Submit an action
  app.post<{ Params: { battleId: string }; Body: BattleAction }>(
    "/v1/battle/:battleId/action",
    (req, reply) => {
      const engine = battles.getBattle(req.params.battleId);
      if (!engine) {
        return reply.status(404).send({ error: "battle not found" });
      }

      const body = req.body;
      if (!body?.actorId || !body?.actionId) {
        return reply.status(400).send({ error: "actorId and actionId are required" });
      }

      if (!ACTIONS[body.actionId]) {
        return reply.status(400).send({
          error: `unknown action "${body.actionId}". Valid: ${Object.keys(ACTIONS).join(", ")}`,
        });
      }

      const state = engine.submitAction(body);
      return reply.send(state);
    },
  );
}
