import type { FastifyInstance } from "fastify";
import { getTechniquesByClass, getLearnedTechniques, getTechniqueById } from "./techniques.js";
import type { TechniqueDefinition } from "./techniques.js";
import { getOrCreateZone, recalculateEntityVitals } from "./zoneRuntime.js";
import type { Entity, ActiveEffect, ZoneState } from "./zoneRuntime.js";
import { getAvailableGold, recordGoldSpend } from "./goldLedger.js";
import { getGoldBalance } from "./blockchain.js";
import { authenticateRequest, verifyEntityOwnership } from "./auth.js";
import { randomUUID } from "crypto";

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
  server.get<{ Params: { zoneId: string; entityId: string } }>(
    "/techniques/learned/:zoneId/:entityId",
    async (req, reply) => {
      const { zoneId, entityId } = req.params;
      const zone = getOrCreateZone(zoneId);
      const entity = zone.entities.get(entityId);

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
    }
  );

  // Get available techniques for a character (based on class and level)
  server.get<{ Params: { zoneId: string; entityId: string } }>(
    "/techniques/available/:zoneId/:entityId",
    async (req, reply) => {
      const { zoneId, entityId } = req.params;
      const zone = getOrCreateZone(zoneId);
      const entity = zone.entities.get(entityId);

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
    }
  );

  // Learn a technique from a trainer (PROTECTED)
  server.post<{
    Body: {
      zoneId: string;
      playerEntityId: string;
      techniqueId: string;
      trainerEntityId: string;
    };
  }>("/techniques/learn", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const { zoneId, playerEntityId, techniqueId, trainerEntityId } = req.body;
    const authenticatedWallet = (req as any).walletAddress;

    const zone = getOrCreateZone(zoneId);
    const player = zone.entities.get(playerEntityId);
    const trainer = zone.entities.get(trainerEntityId);

    if (!player) {
      return reply.status(404).send({ error: "Player entity not found" });
    }

    // Verify ownership
    if (!verifyEntityOwnership(player.walletAddress, authenticatedWallet)) {
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

    // Validate level requirement
    if (!player.level || player.level < technique.levelRequired) {
      return reply.status(400).send({
        error: `Level ${technique.levelRequired} required to learn this technique`
      });
    }

    // Check if already learned
    const learned = player.learnedTechniques ?? [];
    if (learned.includes(techniqueId)) {
      return reply.status(400).send({ error: "Technique already learned" });
    }

    // Check distance to trainer
    const dx = player.x - trainer.x;
    const dy = player.y - trainer.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > 50) {
      return reply.status(400).send({ error: "Too far from trainer" });
    }

    // Check gold balance
    const onChainGoldStr = await getGoldBalance(player.walletAddress);
    const onChainGold = Number(onChainGoldStr);
    const availableGold = getAvailableGold(player.walletAddress, onChainGold);

    if (availableGold < technique.goldCost) {
      return reply.status(400).send({
        error: `Not enough gold. Need ${technique.goldCost}, have ${availableGold}`
      });
    }

    // Deduct gold
    recordGoldSpend(player.walletAddress, technique.goldCost);

    // Add technique to learned list
    if (!player.learnedTechniques) {
      player.learnedTechniques = [];
    }
    player.learnedTechniques.push(techniqueId);

    const newAvailableGold = getAvailableGold(player.walletAddress, onChainGold);

    return reply.send({
      success: true,
      technique: technique.name,
      goldSpent: technique.goldCost,
      remainingGold: newAvailableGold,
      totalLearned: player.learnedTechniques.length,
    });
  });

  // Use a technique (PROTECTED)
  server.post<{
    Body: {
      zoneId: string;
      casterEntityId: string;
      techniqueId: string;
      targetEntityId?: string;
    };
  }>("/techniques/use", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const { zoneId, casterEntityId, techniqueId, targetEntityId } = req.body;
    const authenticatedWallet = (req as any).walletAddress;

    const zone = getOrCreateZone(zoneId);
    const caster = zone.entities.get(casterEntityId);

    if (!caster) {
      return reply.status(404).send({ error: "Caster entity not found" });
    }

    // Verify ownership
    if (!verifyEntityOwnership(caster.walletAddress, authenticatedWallet)) {
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
    if (!learned.includes(techniqueId)) {
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
      const cooldownExpires = caster.cooldowns.get(techniqueId);
      if (cooldownExpires != null && zone.tick < cooldownExpires) {
        const remainingTicks = cooldownExpires - zone.tick;
        return reply.status(400).send({
          error: `Technique on cooldown. ${remainingTicks}s remaining.`,
          cooldownExpiresAtTick: cooldownExpires,
          remainingSeconds: remainingTicks,
        });
      }
    }

    // Get target if needed
    let target = caster; // Default to self
    if (technique.targetType === "enemy" || technique.targetType === "ally") {
      if (!targetEntityId) {
        return reply.status(400).send({ error: "Target required for this technique" });
      }
      const targetEntity = zone.entities.get(targetEntityId);
      if (!targetEntity) {
        return reply.status(404).send({ error: "Target entity not found" });
      }
      target = targetEntity;
    }

    // Deduct essence cost
    caster.essence = currentEssence - technique.essenceCost;

    // Set cooldown
    const cooldownExpiresAtTick = zone.tick + technique.cooldown;
    if (!caster.cooldowns) {
      caster.cooldowns = new Map();
    }
    caster.cooldowns.set(techniqueId, cooldownExpiresAtTick);

    // Apply technique effects
    const result = applyTechniqueEffects(caster, target, technique, zone);

    return reply.send({
      success: true,
      technique: technique.name,
      casterEssence: caster.essence,
      cooldownExpiresAtTick,
      result,
    });
  });
}

function addActiveEffect(entity: Entity, effect: ActiveEffect): void {
  if (!entity.activeEffects) {
    entity.activeEffects = [];
  }
  // Same techniqueId refreshes (replaces), different techniques stack
  entity.activeEffects = entity.activeEffects.filter(e => e.techniqueId !== effect.techniqueId);
  entity.activeEffects.push(effect);
}

function applyTechniqueEffects(
  caster: Entity,
  target: Entity,
  technique: TechniqueDefinition,
  zone: ZoneState
): any {
  const { effects, type } = technique;
  const result: any = {};

  // Attack techniques
  if (type === "attack" && effects.damageMultiplier) {
    const baseDamage = calculateBaseDamage(caster);
    const damage = Math.floor(baseDamage * effects.damageMultiplier);

    if (effects.maxTargets && effects.maxTargets > 1) {
      // Multi-target attack
      const targets = findNearbyEnemies(target, zone, effects.maxTargets, effects.areaRadius);
      result.targets = targets.map((t: Entity) => {
        const actualDamage = Math.min(damage, t.hp);
        t.hp = Math.max(0, t.hp - damage);
        if (t.hp === 0) {
          zone.entities.delete(t.id);
        }
        return { id: t.id, name: t.name, damage: actualDamage };
      });
    } else {
      // Single target attack
      const actualDamage = Math.min(damage, target.hp);
      target.hp = Math.max(0, target.hp - damage);
      result.damage = actualDamage;
      result.targetHp = target.hp;

      if (target.hp === 0 && target.type === "mob") {
        zone.entities.delete(target.id);
        result.targetKilled = true;
      }
    }

    // Lifesteal for Drain Life
    if (effects.healAmount && type === "attack") {
      const heal = Math.floor(damage * (effects.healAmount / 100));
      const actualHeal = Math.min(heal, caster.maxHp - caster.hp);
      caster.hp = Math.min(caster.maxHp, caster.hp + actualHeal);
      result.healing = actualHeal;
    }
  }

  // Healing techniques — instant vs HoT
  if (type === "healing" && effects.healAmount) {
    if (effects.duration && effects.duration > 0) {
      // Heal-over-time (Renew, Nature's Blessing, Meditation)
      const totalHeal = Math.floor(target.maxHp * (effects.healAmount / 100));
      const healPerTick = Math.max(1, Math.floor(totalHeal / effects.duration));
      const hotEffect: ActiveEffect = {
        id: randomUUID(),
        techniqueId: technique.id,
        name: technique.name,
        type: "hot",
        casterId: caster.id,
        appliedAtTick: zone.tick,
        durationTicks: effects.duration,
        remainingTicks: effects.duration,
        hotHealPerTick: healPerTick,
      };
      addActiveEffect(target, hotEffect);
      result.hotApplied = true;
      result.healPerTick = healPerTick;
      result.duration = effects.duration;
    } else {
      // Instant heal (Holy Light, Lay on Hands)
      const healAmount = Math.floor(target.maxHp * (effects.healAmount / 100));
      const actualHeal = Math.min(healAmount, target.maxHp - target.hp);
      target.hp = Math.min(target.maxHp, target.hp + actualHeal);
      result.healing = actualHeal;
      result.targetHp = target.hp;
    }
  }

  // Buffs with stat bonuses
  if (type === "buff" && effects.statBonus && effects.duration) {
    const buffEffect: ActiveEffect = {
      id: randomUUID(),
      techniqueId: technique.id,
      name: technique.name,
      type: "buff",
      casterId: caster.id,
      appliedAtTick: zone.tick,
      durationTicks: effects.duration,
      remainingTicks: effects.duration,
      statModifiers: effects.statBonus,
    };
    addActiveEffect(target, buffEffect);
    recalculateEntityVitals(target);
    result.buffs = effects.statBonus;
    result.duration = effects.duration;
  }

  // Debuffs with stat reductions
  if (type === "debuff" && effects.statReduction && effects.duration) {
    const debuffEffect: ActiveEffect = {
      id: randomUUID(),
      techniqueId: technique.id,
      name: technique.name,
      type: "debuff",
      casterId: caster.id,
      appliedAtTick: zone.tick,
      durationTicks: effects.duration,
      remainingTicks: effects.duration,
      statModifiers: effects.statReduction,
    };
    addActiveEffect(target, debuffEffect);
    recalculateEntityVitals(target);
    result.debuffs = effects.statReduction;
    result.duration = effects.duration;
  }

  // DoTs (Poison Blade, Consecration, Corruption)
  if (effects.dotDamage && effects.duration) {
    const dotEffect: ActiveEffect = {
      id: randomUUID(),
      techniqueId: technique.id,
      name: technique.name,
      type: "dot",
      casterId: caster.id,
      appliedAtTick: zone.tick,
      durationTicks: effects.duration,
      remainingTicks: effects.duration,
      dotDamage: effects.dotDamage,
    };
    addActiveEffect(target, dotEffect);
    result.dotApplied = true;
    result.dotDamage = effects.dotDamage;
    result.duration = effects.duration;
  }

  // Shields (Divine Protection, Soul Shield)
  if (effects.shield && effects.duration) {
    const shieldHp = Math.floor(target.maxHp * (effects.shield / 100));
    const shieldEffect: ActiveEffect = {
      id: randomUUID(),
      techniqueId: technique.id,
      name: technique.name,
      type: "shield",
      casterId: caster.id,
      appliedAtTick: zone.tick,
      durationTicks: effects.duration,
      remainingTicks: effects.duration,
      shieldHp,
      shieldMaxHp: shieldHp,
    };
    addActiveEffect(target, shieldEffect);
    result.shield = shieldHp;
    result.duration = effects.duration;
  }

  return result;
}

function calculateBaseDamage(caster: Entity): number {
  const str = caster.effectiveStats?.str ?? caster.stats?.str ?? 10;
  const int = caster.effectiveStats?.int ?? caster.stats?.int ?? 10;

  // Use STR for physical classes, INT for casters
  const primaryStat = ["mage", "cleric", "warlock"].includes(caster.classId ?? "") ? int : str;

  return Math.floor(5 + primaryStat * 0.5);
}

function findNearbyEnemies(origin: Entity, zone: ZoneState, maxTargets: number, radius: number = 50): Entity[] {
  const enemies: Entity[] = [];

  for (const entity of zone.entities.values()) {
    if (entity.type !== "mob" && entity.type !== "player") continue;
    if (entity.id === origin.id) continue;

    const dx = entity.x - origin.x;
    const dy = entity.y - origin.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= radius) {
      enemies.push(entity);
      if (enemies.length >= maxTargets) break;
    }
  }

  return enemies;
}
