/**
 * Forged Technique Routes — LLM-powered custom ability forging.
 *
 * POST /techniques/forge         — Describe your dream ability and the trainer forges it
 * GET  /techniques/forged/:wallet — View forged techniques for a wallet
 */

import type { FastifyInstance } from "fastify";
import { getEntity } from "../world/zoneRuntime.js";
import { authenticateRequest, verifyEntityOwnership } from "../auth/auth.js";
import { saveCharacter } from "../character/characterStore.js";
import { getAvailableGoldAsync, recordGoldSpendAsync } from "../blockchain/goldLedger.js";
import { getGoldBalance } from "../blockchain/blockchain.js";
import { copperToGold } from "../blockchain/currency.js";
import { getOrCreateZone } from "../world/zoneRuntime.js";
import { logZoneEvent } from "../world/zoneEvents.js";
import {
  forgeCustomTechnique,
  getForgedTechniqueForWalletTier,
  getWalletForgedTechniques,
  getTierForLevel,
  getTierConstraints,
  type ForgeTier,
} from "./forgedTechniqueGenerator.js";

const FORGE_RANGE = 50;
const VALID_TIERS: ForgeTier[] = ["adept", "master", "legendary"];

function getTrainerClass(trainer: any): string | null {
  if (trainer.teachesClass) return trainer.teachesClass.toLowerCase();
  const match = (trainer.name ?? "").toLowerCase().match(/(warrior|paladin|rogue|ranger|mage|cleric|warlock|monk)\s+trainer/);
  return match?.[1] ?? null;
}

export function registerForgedTechniqueRoutes(server: FastifyInstance): void {

  // ── Forge a custom technique ────────────────────────────────────────
  server.post<{
    Body: {
      zoneId: string;
      playerEntityId: string;
      trainerEntityId: string;
      description: string;
      tier?: ForgeTier;
    };
  }>(
    "/techniques/forge",
    { preHandler: authenticateRequest },
    async (req, reply) => {
      const { zoneId, playerEntityId, trainerEntityId, description } = req.body ?? {};
      const authenticatedWallet = (req as any).walletAddress as string;

      if (!zoneId || !playerEntityId || !trainerEntityId || !description) {
        return reply.status(400).send({
          error: "zoneId, playerEntityId, trainerEntityId, and description are required",
        });
      }

      // Validate description length
      const trimmed = description.trim();
      if (trimmed.length < 10) {
        return reply.status(400).send({
          error: "Describe your ability in more detail (at least 10 characters)",
        });
      }
      if (trimmed.length > 500) {
        return reply.status(400).send({
          error: "Description too long (max 500 characters)",
        });
      }

      const player = getEntity(playerEntityId);
      const trainer = getEntity(trainerEntityId);

      if (!player || player.type !== "player") {
        return reply.status(404).send({ error: "Player entity not found" });
      }

      if (!(await verifyEntityOwnership(player.walletAddress, authenticatedWallet, playerEntityId))) {
        return reply.status(403).send({ error: "Not authorized to control this player" });
      }

      if (!trainer || trainer.type !== "trainer") {
        return reply.status(404).send({ error: "Trainer not found" });
      }

      if (!player.classId) {
        return reply.status(400).send({ error: "Character has no class" });
      }

      // Check trainer teaches this class
      const trainerClass = getTrainerClass(trainer);
      if (!trainerClass || trainerClass !== player.classId.toLowerCase()) {
        return reply.status(400).send({
          error: "Wrong class trainer",
          trainerClass,
          playerClass: player.classId,
        });
      }

      // Check distance to trainer
      const dx = player.x - trainer.x;
      const dy = player.y - trainer.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > FORGE_RANGE) {
        return reply.status(400).send({
          error: "Too far from trainer",
          distance: Math.round(distance),
          maxRange: FORGE_RANGE,
        });
      }

      // Determine tier from level (or explicit tier param)
      const playerLevel = player.level ?? 1;
      let tier: ForgeTier;
      if (req.body.tier && VALID_TIERS.includes(req.body.tier)) {
        tier = req.body.tier;
      } else {
        const autoTier = getTierForLevel(playerLevel);
        if (!autoTier) {
          return reply.status(400).send({
            error: "You must be at least Level 30 to forge a custom technique",
            currentLevel: playerLevel,
          });
        }
        tier = autoTier;
      }

      const constraints = getTierConstraints(tier);

      // Level check
      if (playerLevel < constraints.level) {
        return reply.status(400).send({
          error: `Level ${constraints.level} required for ${tier} forging (current: ${playerLevel})`,
        });
      }

      // Check if already forged this tier
      const existing = getForgedTechniqueForWalletTier(player.walletAddress!, tier);
      if (existing) {
        return reply.status(400).send({
          error: `You already forged a ${tier} technique: "${existing.name}". One per tier.`,
          existingTechnique: {
            id: existing.id,
            name: existing.name,
            description: existing.description,
          },
        });
      }

      // Check gold
      if (!player.walletAddress) {
        return reply.status(400).send({ error: "Player must have a wallet" });
      }

      const onChainGoldStr = await getGoldBalance(player.walletAddress);
      const onChainGold = Number(onChainGoldStr);
      const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
      const availableGold = await getAvailableGoldAsync(player.walletAddress, safeOnChainGold);

      const goldCost = copperToGold(constraints.goldCost);
      if (availableGold < goldCost) {
        return reply.status(400).send({
          error: `Not enough gold. Need ${constraints.goldCost}c (${goldCost}g), have ${availableGold}g`,
        });
      }

      // Call LLM to forge the technique
      let technique;
      try {
        technique = await forgeCustomTechnique(
          player.walletAddress,
          player.classId,
          tier,
          trimmed,
        );
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }

      // Deduct gold
      await recordGoldSpendAsync(player.walletAddress, goldCost);

      // Add to learned techniques
      if (!player.learnedTechniques) player.learnedTechniques = [];
      if (!player.learnedTechniques.includes(technique.id)) {
        player.learnedTechniques.push(technique.id);
      }

      // Persist
      saveCharacter(player.walletAddress, player.name, {
        learnedTechniques: player.learnedTechniques,
        [`forgedTechnique_${tier}`]: JSON.stringify(technique),
      } as any).catch((err) =>
        console.error(`[persistence] Save failed after technique forge:`, err),
      );

      // Emit zone event
      const zone = getOrCreateZone(zoneId);
      logZoneEvent({
        zoneId,
        type: "technique",
        tick: zone.tick,
        message: `⚒ ${player.name} forged a ${tier} technique: ${technique.name}!`,
        entityId: playerEntityId,
        entityName: player.name,
        data: {
          techniqueName: technique.name,
          techniqueId: technique.id,
          techniqueType: technique.type,
          tier,
          forged: true,
          playerDescription: trimmed,
        },
      });

      const newAvailableGold = await getAvailableGoldAsync(player.walletAddress, safeOnChainGold);

      return reply.send({
        ok: true,
        technique,
        goldSpent: constraints.goldCost,
        remainingGold: newAvailableGold,
        message: `The trainer channels your vision into reality... "${technique.name}" has been forged!`,
      });
    },
  );

  // ── View forged techniques ──────────────────────────────────────────
  server.get<{ Params: { walletAddress: string } }>(
    "/techniques/forged/:walletAddress",
    async (req, reply) => {
      const { walletAddress } = req.params;
      const techniques = getWalletForgedTechniques(walletAddress);
      return reply.send({ techniques });
    },
  );
}
