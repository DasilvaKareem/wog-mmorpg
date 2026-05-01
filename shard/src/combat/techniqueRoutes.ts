import type { FastifyInstance } from "fastify";
import { getTechniquesByClass, getLearnedTechniques, getTechniqueById, getRequiredPreviousRank, getPreviousRankId } from "./techniques.js";
import { getOrCreateZone, getEntity } from "../world/zoneRuntime.js";
import type { Entity } from "../world/zoneRuntime.js";
import { getAvailableGoldAsync, recordGoldSpendAsync } from "../blockchain/goldLedger.js";
import { getGoldBalance } from "../blockchain/blockchain.js";
import { authenticateRequest, verifyEntityOwnership } from "../auth/auth.js";
import { saveCharacter } from "../character/characterStore.js";
import { copperToGold } from "../blockchain/currency.js";
import { logZoneEvent } from "../world/zoneEvents.js";

export function registerTechniqueRoutes(server: FastifyInstance): void {
  // Get all techniques for a class
  server.get<{ Params: { className: string } }>(
    "/techniques/class/:className",
    async (req, reply) => {
      const { className } = req.params;
      const techniques = getTechniquesByClass(className);
      return reply.send({ techniques });
    }
  );

  // Get learned techniques for a character (actually learned, not available)
  const learnedHandler = async (req: any, reply: any) => {
    const entityId = req.params.entityId;
    const entity = getEntity(entityId);

    if (!entity) {
      return reply.status(404).send({ error: "Entity not found" });
    }

    if (!entity.classId) {
      return reply.status(400).send({ error: "Entity is not a player character" });
    }

    const learnedIds = entity.learnedTechniques ?? [];
    const learned = learnedIds
      .map(id => getTechniqueById(id))
      .filter((t): t is NonNullable<typeof t> => t != null);

    return reply.send({ techniques: learned });
  };

  server.get("/techniques/learned/:entityId", learnedHandler);
  // Compat alias
  server.get("/techniques/learned/:zoneId/:entityId", learnedHandler);

  // Get available techniques for a character (based on class and level)
  const availableHandler = async (req: any, reply: any) => {
    const entityId = req.params.entityId;
    const entity = getEntity(entityId);

    if (!entity) {
      return reply.status(404).send({ error: "Entity not found" });
    }

    if (!entity.classId || !entity.level) {
      return reply.status(400).send({ error: "Entity is not a player character" });
    }

    const available = getLearnedTechniques(entity.classId, entity.level);
    const learnedIds = entity.learnedTechniques ?? [];

    // Mark which are already learned
    const result = available.map(tech => ({
      ...tech,
      isLearned: learnedIds.includes(tech.id),
    }));

    return reply.send({ techniques: result });
  };

  server.get("/techniques/available/:entityId", availableHandler);
  // Compat alias
  server.get("/techniques/available/:zoneId/:entityId", availableHandler);

  // Learn a technique from a trainer (PROTECTED)
  server.post<{
    Body: {
      zoneId: string;
      playerEntityId?: string;
      entityId?: string;
      techniqueId: string;
      trainerEntityId: string;
    };
  }>("/techniques/learn", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const playerEntityId = req.body.entityId || req.body.playerEntityId;
    const { zoneId, techniqueId, trainerEntityId } = req.body;
    const authenticatedWallet = (req as any).walletAddress;

    if (!playerEntityId) {
      return reply.status(400).send({ error: "entityId (or playerEntityId) is required" });
    }

    const player = getEntity(playerEntityId);
    const trainer = getEntity(trainerEntityId);

    if (!player) {
      return reply.status(404).send({ error: "Player entity not found" });
    }

    if (player.type !== "player") {
      return reply.status(400).send({ error: "Only player entities can learn techniques" });
    }

    // Verify ownership
    if (!(await verifyEntityOwnership(player.walletAddress, authenticatedWallet, playerEntityId))) {
      return reply.status(403).send({ error: "Not authorized to control this player" });
    }

    if (!trainer || trainer.type !== "trainer") {
      return reply.status(404).send({ error: "Trainer not found" });
    }

    if (!player.walletAddress) {
      return reply.status(400).send({ error: "Player must have a wallet" });
    }

    const technique = getTechniqueById(techniqueId);
    if (!technique) {
      return reply.status(404).send({ error: "Technique not found" });
    }

    // Validate class matches
    if (player.classId !== technique.className) {
      return reply.status(400).send({ error: "This trainer cannot teach your class" });
    }

    const trainerClass = getTrainerClass(trainer);
    if (!trainerClass) {
      return reply.status(400).send({ error: "Trainer is not configured to teach a class" });
    }
    if (!player.classId || trainerClass !== player.classId) {
      return reply.status(400).send({
        error: "Wrong class trainer",
        trainerClass,
        playerClass: player.classId ?? null,
      });
    }

    // Validate level requirement
    if (!player.level || player.level < technique.levelRequired) {
      return reply.status(400).send({
        error: `Level ${technique.levelRequired} required to learn this technique`
      });
    }

    // Check if already learned
    const learned = player.learnedTechniques ?? [];
    if (learned.includes(technique.id)) {
      return reply.status(400).send({ error: "Technique already learned" });
    }

    // Rank prerequisite check: must know R1 to learn R2, R2 to learn R3
    const requiredPrev = getRequiredPreviousRank(technique.id);
    if (requiredPrev && !learned.includes(requiredPrev)) {
      const prevTech = getTechniqueById(requiredPrev);
      return reply.status(400).send({
        error: `Must know ${prevTech?.name ?? requiredPrev} before learning this rank`,
        requiredTechnique: requiredPrev,
      });
    }

    // Check distance to trainer
    const dx = player.x - trainer.x;
    const dy = player.y - trainer.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > 50) {
      return reply.status(400).send({ error: "Too far from trainer", distance: Math.round(distance), maxRange: 50 });
    }

    // Check gold balance
    const onChainGoldStr = await getGoldBalance(player.walletAddress);
    const onChainGold = Number(onChainGoldStr);
    const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
    const availableGold = await getAvailableGoldAsync(player.walletAddress, safeOnChainGold);

    const goldCost = copperToGold(technique.copperCost);
    if (availableGold < goldCost) {
      return reply.status(400).send({
        error: `Not enough gold. Need ${technique.copperCost}c, have ${availableGold}g`
      });
    }

    // Deduct gold (copper → gold conversion)
    await recordGoldSpendAsync(player.walletAddress, goldCost);

    // Add technique to learned list
    if (!player.learnedTechniques) {
      player.learnedTechniques = [];
    }
    player.learnedTechniques.push(technique.id);

    // Remove previous rank if upgrading (R2 replaces R1, R3 replaces R2)
    const replacedRank = getPreviousRankId(technique.id);
    if (replacedRank) {
      player.learnedTechniques = player.learnedTechniques.filter(id => id !== replacedRank);
    }

    // Persist to Redis
    saveCharacter(player.walletAddress, player.name, {
      learnedTechniques: player.learnedTechniques,
    }).catch((err) => console.error(`[persistence] Save failed after technique learn:`, err));

    // Emit zone event for client animation
    const zone = zoneId ? getOrCreateZone(zoneId) : undefined;
    logZoneEvent({
      zoneId,
      type: "technique",
      tick: zone?.tick ?? 0,
      message: `✦ ${player.name} learned ${technique.name}!`,
      entityId: playerEntityId,
      entityName: player.name,
      data: { techniqueName: technique.name, techniqueId: technique.id, techniqueType: technique.type },
    });

    const newAvailableGold = await getAvailableGoldAsync(player.walletAddress, safeOnChainGold);

    return reply.send({
      success: true,
      technique: technique.name,
      goldSpent: technique.copperCost,
      remainingGold: newAvailableGold,
      totalLearned: player.learnedTechniques.length,
    });
  });

  // Use a technique (PROTECTED)
  server.post<{
    Body: {
      zoneId: string;
      casterEntityId?: string;
      entityId?: string;
      techniqueId: string;
      targetEntityId?: string;
      targetId?: string;
    };
  }>("/techniques/use", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const casterEntityId = req.body.entityId || req.body.casterEntityId;
    const targetEntityId = req.body.targetId || req.body.targetEntityId;
    const { zoneId, techniqueId } = req.body;
    const authenticatedWallet = (req as any).walletAddress;

    if (!casterEntityId) {
      return reply.status(400).send({ error: "entityId (or casterEntityId) is required" });
    }

    const zone = getOrCreateZone(zoneId);
    const caster = getEntity(casterEntityId);

    if (!caster) {
      return reply.status(404).send({ error: "Caster entity not found" });
    }

    // Verify ownership
    if (!(await verifyEntityOwnership(caster.walletAddress, authenticatedWallet, casterEntityId))) {
      return reply.status(403).send({ error: "Not authorized to control this caster" });
    }

    const technique = getTechniqueById(techniqueId);
    if (!technique) {
      return reply.status(404).send({ error: "Technique not found" });
    }

    // Validate class matches
    if (caster.classId !== technique.className) {
      return reply.status(400).send({ error: "Technique not available for this class" });
    }

    // Validate level requirement
    if (!caster.level || caster.level < technique.levelRequired) {
      return reply.status(400).send({ error: "Level requirement not met" });
    }

    // Validate technique has been learned
    const learned = caster.learnedTechniques ?? [];
    if (!learned.includes(technique.id)) {
      return reply.status(400).send({
        error: "Technique not learned. Visit a class trainer to learn it."
      });
    }

    // Validate essence cost
    const currentEssence = caster.essence ?? 0;
    if (currentEssence < technique.essenceCost) {
      return reply.status(400).send({ error: "Not enough essence" });
    }

    // Validate cooldown
    if (caster.cooldowns) {
      const cooldownExpires = caster.cooldowns.get(technique.id);
      if (cooldownExpires != null && zone.tick < cooldownExpires) {
        const remainingTicks = cooldownExpires - zone.tick;
        return reply.status(400).send({
          error: `Technique on cooldown. ${remainingTicks}s remaining.`,
          cooldownExpiresAtTick: cooldownExpires,
          remainingSeconds: remainingTicks,
        });
      }
    }

    // Queue the technique into the world tick so cooldowns, windups, range,
    // damage, healing, effects, VFX events, and death handling have one owner.
    let targetId = caster.id;
    if (technique.targetType === "enemy" || technique.targetType === "ally" || technique.targetType === "area") {
      if (!targetEntityId) {
        return reply.status(400).send({ error: "Target required for this technique" });
      }
      const targetEntity = getEntity(targetEntityId);
      if (!targetEntity) {
        return reply.status(404).send({ error: "Target entity not found" });
      }
      targetId = targetEntity.id;
    }

    caster.order = { action: "technique", targetId, techniqueId: technique.id };

    return reply.send({
      success: true,
      queued: true,
      technique: technique.name,
      casterEssence: caster.essence,
      targetEntityId: targetId,
      message: "Technique queued for world tick resolution",
    });
  });
}

function getTrainerClass(trainer: Entity): string | null {
  if (trainer.teachesClass) return trainer.teachesClass.toLowerCase();

  // Backward-compatible fallback if older NPC data is still live.
  const match = trainer.name.toLowerCase().match(/(warrior|paladin|rogue|ranger|mage|cleric|warlock|monk)\s+trainer/);
  return match?.[1] ?? null;
}
