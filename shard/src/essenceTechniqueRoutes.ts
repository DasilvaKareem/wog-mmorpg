/**
 * Essence Technique API Routes
 *
 * POST /essence-technique/forge        — Forge a technique (requires NPC proximity, level gate)
 * GET  /essence-technique/:wallet      — View forged techniques for a wallet
 * GET  /essence-technique/preview/:wallet/:classId/:tier — Preview before forging
 */

import type { FastifyInstance } from "fastify";
import { getOrCreateZone } from "./zoneRuntime.js";
import { authenticateRequest } from "./auth.js";
import { saveCharacter } from "./characterStore.js";
import {
  generateEssenceTechnique,
  getWalletEssenceTechniques,
  getEssenceTechniqueId,
  type EssenceTier,
} from "./essenceTechniqueGenerator.js";

const FORGE_RANGE = 50; // Must be within 50 units of essence-forge NPC
const VALID_TIERS: EssenceTier[] = ["signature", "ultimate"];
const TIER_LEVELS: Record<EssenceTier, number> = { signature: 15, ultimate: 40 };

export function registerEssenceTechniqueRoutes(server: FastifyInstance): void {
  // ── Forge a technique ─────────────────────────────────────────────
  server.post<{
    Body: { zoneId: string; playerEntityId: string; tier: EssenceTier };
  }>(
    "/essence-technique/forge",
    { preHandler: authenticateRequest },
    async (req, reply) => {
      const { zoneId, playerEntityId, tier } = req.body ?? {};
      const authenticatedWallet = (req as any).walletAddress as string;

      if (!zoneId || !playerEntityId || !tier) {
        return reply.status(400).send({ error: "zoneId, playerEntityId, and tier are required" });
      }

      if (!VALID_TIERS.includes(tier)) {
        return reply.status(400).send({ error: `tier must be "signature" or "ultimate"` });
      }

      const zone = getOrCreateZone(zoneId);
      const player = zone.entities.get(playerEntityId);

      if (!player || player.type !== "player") {
        return reply.status(404).send({ error: "Player entity not found in zone" });
      }

      // Verify ownership
      if (!player.walletAddress || player.walletAddress.toLowerCase() !== authenticatedWallet.toLowerCase()) {
        return reply.status(403).send({ error: "Not authorized for this character" });
      }

      // Level gate
      const requiredLevel = TIER_LEVELS[tier];
      if ((player.level ?? 1) < requiredLevel) {
        return reply.status(400).send({
          error: `Level ${requiredLevel} required for ${tier} technique (current: ${player.level ?? 1})`,
        });
      }

      if (!player.classId) {
        return reply.status(400).send({ error: "Character has no class" });
      }

      // Check NPC proximity
      let nearForge = false;
      for (const entity of zone.entities.values()) {
        if (entity.type !== "essence-forge") continue;
        const dx = entity.x - player.x;
        const dy = entity.y - player.y;
        if (Math.sqrt(dx * dx + dy * dy) <= FORGE_RANGE) {
          nearForge = true;
          break;
        }
      }

      if (!nearForge) {
        return reply.status(400).send({
          error: "Must be near an Essence Forge NPC to forge a technique",
        });
      }

      // Generate (idempotent — same wallet+class+tier always returns same technique)
      const technique = generateEssenceTechnique(
        player.walletAddress,
        player.classId,
        tier,
      );

      // Add to learnedTechniques if not already present
      if (!player.learnedTechniques) player.learnedTechniques = [];
      if (!player.learnedTechniques.includes(technique.id)) {
        player.learnedTechniques.push(technique.id);
      }

      // Persist to character store
      const saveData: Record<string, string | undefined> = {
        learnedTechniques: JSON.stringify(player.learnedTechniques),
      };
      if (tier === "signature") {
        saveData.signatureTechniqueId = technique.id;
      } else {
        saveData.ultimateTechniqueId = technique.id;
      }

      await saveCharacter(player.walletAddress, player.name, saveData as any);

      return reply.send({
        ok: true,
        technique,
        message: `Forged ${tier} technique: ${technique.name}`,
      });
    },
  );

  // ── View forged techniques for a wallet ───────────────────────────
  server.get<{ Params: { walletAddress: string } }>(
    "/essence-technique/:walletAddress",
    async (req, reply) => {
      const { walletAddress } = req.params;
      const techniques = getWalletEssenceTechniques(walletAddress);
      return reply.send({ techniques });
    },
  );

  // ── Preview a technique before forging ────────────────────────────
  server.get<{
    Params: { walletAddress: string; classId: string; tier: string };
  }>(
    "/essence-technique/preview/:walletAddress/:classId/:tier",
    async (req, reply) => {
      const { walletAddress, classId, tier } = req.params;

      if (!VALID_TIERS.includes(tier as EssenceTier)) {
        return reply.status(400).send({ error: `tier must be "signature" or "ultimate"` });
      }

      // Generate (deterministic preview — same as forge result)
      const technique = generateEssenceTechnique(
        walletAddress,
        classId,
        tier as EssenceTier,
      );

      return reply.send({ technique });
    },
  );
}
