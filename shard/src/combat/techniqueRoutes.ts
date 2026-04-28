import type { FastifyInstance } from "fastify";
import { getTechniquesByClass, getLearnedTechniques, getTechniqueById, getRequiredPreviousRank, getPreviousRankId } from "./techniques.js";
import type { TechniqueDefinition } from "./techniques.js";
import { getOrCreateZone, getEntity, recalculateEntityVitals, unregisterSpawnedWallet, handleMobDeath } from "../world/zoneRuntime.js";
import { clampToZoneBounds } from "../world/worldLayout.js";
import type { Entity, ActiveEffect, ZoneState } from "../world/zoneRuntime.js";
import { getAvailableGoldAsync, recordGoldSpendAsync } from "../blockchain/goldLedger.js";
import { getGoldBalance } from "../blockchain/blockchain.js";
import { authenticateRequest, verifyEntityOwnership } from "../auth/auth.js";
import { randomUUID } from "crypto";
import { saveCharacter } from "../character/characterStore.js";
import { copperToGold } from "../blockchain/currency.js";
import { logZoneEvent } from "../world/zoneEvents.js";
import { getPartyMembers } from "../social/partySystem.js";

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
    if (learned.includes(techniqueId)) {
      return reply.status(400).send({ error: "Technique already learned" });
    }

    // Rank prerequisite check: must know R1 to learn R2, R2 to learn R3
    const requiredPrev = getRequiredPreviousRank(techniqueId);
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
    player.learnedTechniques.push(techniqueId);

    // Remove previous rank if upgrading (R2 replaces R1, R3 replaces R2)
    const replacedRank = getPreviousRankId(techniqueId);
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
      data: { techniqueName: technique.name, techniqueId, techniqueType: technique.type },
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
      const targetEntity = getEntity(targetEntityId);
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

    // Party-targeted techniques: apply to all party members
    if (technique.targetType === "party") {
      const result = applyPartyTechniqueEffects(caster, technique, zone);

      logZoneEvent({
        zoneId,
        type: "ability",
        tick: zone.tick,
        message: `${caster.name} uses ${technique.name} on the party!`,
        entityId: caster.id,
        entityName: caster.name,
        data: {
          techniqueId: technique.id,
          techniqueName: technique.name,
          techniqueType: technique.type,
          animStyle: technique.animStyle,
          isPartyBuff: true,
          affectedCount: result.affected.length,
          casterX: caster.x,
          casterZ: caster.y,
        },
      });

      return reply.send({
        success: true,
        technique: technique.name,
        casterEssence: caster.essence,
        cooldownExpiresAtTick,
        result,
      });
    }

    // Apply technique effects (single-target / self / area)
    const result = await applyTechniqueEffects(caster, target, technique, zone);

    // Log ability event for VFX pipeline
    logZoneEvent({
      zoneId,
      type: "ability",
      tick: zone.tick,
      message: `${caster.name} uses ${technique.name}!`,
      entityId: caster.id,
      entityName: caster.name,
      targetId: target.id !== caster.id ? target.id : undefined,
      targetName: target.id !== caster.id ? target.name : undefined,
      data: {
        techniqueId: technique.id,
        techniqueName: technique.name,
        techniqueType: technique.type,
        animStyle: technique.animStyle,
        damage: result.damage,
        healing: result.healing,
        casterX: caster.x,
        casterZ: caster.y,
        targetX: target.id !== caster.id ? target.x : undefined,
        targetZ: target.id !== caster.id ? target.y : undefined,
        knockback: result.knockback,
        lunge: result.lunge,
        targetNewX: result.targetNewX,
        targetNewZ: result.targetNewZ,
        casterNewX: result.casterNewX,
        casterNewZ: result.casterNewZ,
      },
    });

    return reply.send({
      success: true,
      technique: technique.name,
      casterEssence: caster.essence,
      cooldownExpiresAtTick,
      result,
    });
  });
}

function getTrainerClass(trainer: Entity): string | null {
  if (trainer.teachesClass) return trainer.teachesClass.toLowerCase();

  // Backward-compatible fallback if older NPC data is still live.
  const match = trainer.name.toLowerCase().match(/(warrior|paladin|rogue|ranger|mage|cleric|warlock|monk)\s+trainer/);
  return match?.[1] ?? null;
}

function addActiveEffect(entity: Entity, effect: ActiveEffect): void {
  if (!entity.activeEffects) {
    entity.activeEffects = [];
  }
  // Same techniqueId refreshes (replaces), different techniques stack
  entity.activeEffects = entity.activeEffects.filter(e => e.techniqueId !== effect.techniqueId);
  entity.activeEffects.push(effect);
}

async function applyTechniqueEffects(
  caster: Entity,
  target: Entity,
  technique: TechniqueDefinition,
  zone: ZoneState
): Promise<any> {
  const { effects, type } = technique;
  const result: any = {};

  // Attack techniques
  if (type === "attack" && effects.damageMultiplier) {
    const baseDamage = calculateBaseDamage(caster);
    const damage = Math.floor(baseDamage * effects.damageMultiplier);

    if (effects.maxTargets && effects.maxTargets > 1) {
      // Multi-target attack
      const targets = findNearbyEnemies(target, zone, effects.maxTargets, effects.areaRadius);
      const rows: any[] = [];
      for (const t of targets) {
        const actualDamage = Math.min(damage, t.hp);
        t.hp = Math.max(0, t.hp - damage);
        const killed = t.hp === 0;
        if (killed && (t.type === "mob" || t.type === "boss")) {
          handleMobDeath(t, caster, zone);
        }
        // Players are NOT deleted — zoneRuntime tick handles player death properly
        // (respawn at graveyard, XP penalty, etc.)
        rows.push({ id: t.id, name: t.name, damage: actualDamage, killed });
      }
      result.targets = rows;
    } else {
      // Single target attack
      const actualDamage = Math.min(damage, target.hp);
      target.hp = Math.max(0, target.hp - damage);
      result.damage = actualDamage;
      result.targetHp = target.hp;

      if (target.hp === 0 && (target.type === "mob" || target.type === "boss")) {
        handleMobDeath(target, caster, zone);
        result.targetKilled = true;
      }
    }

    // Lifesteal (Drain Life, Siphon Soul — attacks with healAmount)
    if (effects.healAmount && type === "attack") {
      const heal = Math.floor(damage * (effects.healAmount / 100));
      const actualHeal = Math.min(heal, caster.maxHp - caster.hp);
      caster.hp = Math.min(caster.maxHp, caster.hp + actualHeal);
      result.healing = actualHeal;
    }

    // Hybrid: attack + debuff (Judgment, Flying Kick, Shadow Bolt R3)
    if (effects.statReduction && effects.duration) {
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
    }

    // Hybrid: attack + DoT (Rending Strike, Holy Smite R3, Fireball R3)
    if (effects.dotDamage && effects.duration) {
      const dotEffect: ActiveEffect = {
        id: randomUUID(),
        techniqueId: technique.id,
        name: `${technique.name} DoT`,
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

    // Hybrid: buff + instant heal (Rallying Cry — buff with healAmount, no HoT)
    if (effects.healAmount && !effects.shield) {
      const healAmount = Math.floor(target.maxHp * (effects.healAmount / 100));
      const actualHeal = Math.min(healAmount, target.maxHp - target.hp);
      target.hp = Math.min(target.maxHp, target.hp + actualHeal);
      result.healing = actualHeal;
    }

    // Hybrid: buff + shield (Aura of Resolve — stat bonus + absorb)
    if (effects.shield) {
      const shieldHp = Math.floor(target.maxHp * (effects.shield / 100));
      const shieldEffect: ActiveEffect = {
        id: randomUUID(),
        techniqueId: `${technique.id}_shield`,
        name: `${technique.name} Shield`,
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
    }

    // Hybrid: buff + HoT (Spirit of Redemption — DEF buff with healAmount as HoT)
    if (effects.healAmount && effects.duration && technique.id === "cleric_spirit_of_redemption") {
      const totalHeal = Math.floor(target.maxHp * (effects.healAmount / 100));
      const healPerTick = Math.max(1, Math.floor(totalHeal / effects.duration));
      const hotEffect: ActiveEffect = {
        id: randomUUID(),
        techniqueId: `${technique.id}_hot`,
        name: `${technique.name} HoT`,
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
    }
  }

  // Debuffs with stat reductions (pure debuffs only — hybrid attack+debuff handled above)
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

  // DoTs (pure debuff-type DoTs like Poison Blade, Consecration, Corruption)
  if (type !== "attack" && effects.dotDamage && effects.duration) {
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

  // Shields (pure buff-type shields like Divine Protection, Soul Shield, Mana Shield)
  if (effects.shield && effects.duration && !effects.statBonus) {
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

  // ── Knockback: push target away from caster ──────────────────────
  if (effects.knockback && target.id !== caster.id) {
    const dx = target.x - caster.x;
    const dy = target.y - caster.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;
    target.x += Math.round(nx * effects.knockback);
    target.y += Math.round(ny * effects.knockback);
    clampToZoneBounds(target, zone.zoneId);
    result.knockback = effects.knockback;
    result.targetNewX = target.x;
    result.targetNewZ = target.y;
  }

  // ── Lunge: dash caster toward target ─────────────────────────────
  if (effects.lunge && target.id !== caster.id) {
    const dx = target.x - caster.x;
    const dy = target.y - caster.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;
    // Don't overshoot — stop 5 units short of target
    const lungeActual = Math.min(effects.lunge, Math.max(0, dist - 5));
    caster.x += Math.round(nx * lungeActual);
    caster.y += Math.round(ny * lungeActual);
    clampToZoneBounds(caster, zone.zoneId);
    result.lunge = effects.lunge;
    result.casterNewX = caster.x;
    result.casterNewZ = caster.y;
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

/**
 * Apply a party-targeted technique to all party members.
 * Handles buffs (stat bonuses, shields) and heals (instant + HoT).
 * Falls back to self-only if not in a party.
 */
function applyPartyTechniqueEffects(
  caster: Entity,
  technique: TechniqueDefinition,
  zone: ZoneState,
): any {
  const { effects, type } = technique;
  const memberIds = getPartyMembers(caster.id);
  const affected: any[] = [];

  for (const memberId of memberIds) {
    const member = getEntity(memberId);
    if (!member || member.hp <= 0) continue;

    const memberResult: any = { id: member.id, name: member.name };

    // Stat buff
    if (effects.statBonus && effects.duration) {
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
      addActiveEffect(member, buffEffect);
      recalculateEntityVitals(member);
      memberResult.buffs = effects.statBonus;
      memberResult.duration = effects.duration;
    }

    // Shield
    if (effects.shield && effects.duration) {
      const shieldHp = Math.floor(member.maxHp * (effects.shield / 100));
      const shieldEffect: ActiveEffect = {
        id: randomUUID(),
        techniqueId: `${technique.id}_shield`,
        name: `${technique.name} Shield`,
        type: "shield",
        casterId: caster.id,
        appliedAtTick: zone.tick,
        durationTicks: effects.duration,
        remainingTicks: effects.duration,
        shieldHp,
        shieldMaxHp: shieldHp,
      };
      addActiveEffect(member, shieldEffect);
      memberResult.shield = shieldHp;
    }

    // Healing — instant or HoT
    if (effects.healAmount) {
      if (effects.duration && effects.duration > 0 && (type === "healing" || (type === "buff" && effects.statBonus))) {
        // HoT for party healing spells and buff+heal hybrids
        const totalHeal = Math.floor(member.maxHp * (effects.healAmount / 100));
        const healPerTick = Math.max(1, Math.floor(totalHeal / effects.duration));
        const hotEffect: ActiveEffect = {
          id: randomUUID(),
          techniqueId: `${technique.id}_hot`,
          name: `${technique.name} HoT`,
          type: "hot",
          casterId: caster.id,
          appliedAtTick: zone.tick,
          durationTicks: effects.duration,
          remainingTicks: effects.duration,
          hotHealPerTick: healPerTick,
        };
        addActiveEffect(member, hotEffect);
        memberResult.hotApplied = true;
        memberResult.healPerTick = healPerTick;
      } else {
        // Instant heal
        const healAmount = Math.floor(member.maxHp * (effects.healAmount / 100));
        const actualHeal = Math.min(healAmount, member.maxHp - member.hp);
        member.hp = Math.min(member.maxHp, member.hp + actualHeal);
        memberResult.healing = actualHeal;
      }
    }

    affected.push(memberResult);
  }

  return { affected, partySize: memberIds.length };
}
