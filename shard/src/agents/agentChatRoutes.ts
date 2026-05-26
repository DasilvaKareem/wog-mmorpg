/**
 * Agent Chat Routes
 * POST /agent/chat      — Send a message to the AI agent controlling your character
 * POST /agent/deploy    — Create custodial wallet + mint char + start agent loop
 * POST /agent/stop      — Stop the agent loop
 * GET  /agent/status/:wallet — Get agent running status + config
 * POST /agent/recommend  — AI-powered dynamic recommendations for what to do next
 */

import type { FastifyInstance } from "fastify";
import { type Content, type FunctionDeclaration, type Part, type Type, FunctionCallingConfigMode } from "@google/genai";
import { gemini, GEMINI_MODEL } from "./geminiClient.js";
import { authenticateRequest } from "../auth/auth.js";
import { grantFreeStarterCredit, deductCost, getSessionBalance } from "../economy/sessionBudget.js";
import { agentManager } from "./agentManager.js";
import {
  getAgentConfig,
  setAgentConfig,
  patchAgentConfig,
  getAgentCustodialWallet,
  getAgentEntityRef,
  clearAgentEntityRef,
  appendChatMessage,
  getChatHistory,
  getAgentErrors,
  getGlobalAgentErrors,
  defaultConfig,
  getDeployCount,
  incrementDeployCount,
  getSummonerQuestion,
  replySummonerQuestion,
  addObjective,
  removeObjective,
  reorderObjective,
  clearCompletedObjectives,
  createObjectiveId,
  type AgentFocus,
  type GatherPreference,
  type AgentStrategy,
  type AgentObjective,
} from "./agentConfigStore.js";
import type { BotScript } from "../types/botScriptTypes.js";
import { sendAgentPush } from "./agentPushService.js";
import { setupAgentCharacter } from "./agentCharacterSetup.js";
import { type AgentTier, TIER_CAPABILITIES } from "./agentTiers.js";
import { enqueueGoldMint, getGoldBalance } from "../blockchain/blockchain.js";
import { copperToGold } from "../blockchain/currency.js";
import { getEntity as getWorldEntity, getAllEntities, getEntitiesNear, getEntitiesInRegion, getWorldTick, unregisterSpawnedWallet } from "../world/zoneRuntime.js";
import { saveCharacter, loadAnyCharacterForWallet, loadAllCharactersForWallet } from "../character/characterStore.js";
import { getLearnedProfessions } from "../professions/professions.js";
import { getLearnedTechniques, getTechniqueById } from "../combat/techniques.js";
import { getWorldLayout, resolveRegionId, getZoneConnections, ZONE_LEVEL_REQUIREMENTS, getZoneOffset } from "../world/worldLayout.js";
import { getAvailableQuestsForPlayer, isQuestNpc } from "../social/questSystem.js";
import { buildPartyCoordinationReport } from "../social/partyReport.js";
import { getPartyMemberIdsByPartyId, addEntityToParty, getPlayerPartyId, removeEntityFromParty } from "../social/partySystem.js";
import { sendInboxMessage } from "./agentInbox.js";
import { sendPushToWallet } from "../social/webPushService.js";
import { fetchLiquidationInventory, sleep, extractRawCharacterName } from "./agentUtils.js";
import { getAgentOrigin, emitAgentChat } from "./agentDialogue.js";
import { handleSlashCommand } from "./slashCommands.js";
import type { AgentMcpClient } from "./mcpClient.js";
import { QUEST_CATALOG } from "../social/questSystem.js";
import { validateEdicts, type Edict } from "../combat/edicts.js";
import { setEdictCache } from "../combat/edictCache.js";
import { getPromoCode, hasRedeemedPromoCode, redeemPromoCode, upsertPromoCode } from "../db/runtimeMetaStore.js";

/** Internal fetch with 5s timeout — used for self-calls to avoid hanging forever. */
function internalFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(5_000) });
}

type ChatActionStatus = "completed" | "queued" | "accepted" | "blocked" | "failed";

interface ChatActionResult {
  status: ChatActionStatus;
  tool: string;
  action: string;
  completed: boolean;
  message: string;
  target?: string;
  error?: string;
  details?: unknown;
}

function actionStatusCompleted(status: ChatActionStatus): boolean {
  return status === "completed";
}

function parseToolContent(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { result: parsed };
  } catch {
    return { text: content };
  }
}

// Gemini client is initialized in geminiClient.ts

/**
 * Scan a chat message for durable progression directives and persist them as
 * typed AgentConfig flags. Returns the list of captured directive labels so
 * the caller can log them and force a supervisor re-run.
 *
 * Captures:
 *  - "ignore weak mobs" / "stop killing rats" → ignoreWeakMobs=true
 *  - "fight everything" / "kill weak mobs"    → ignoreWeakMobs=false
 *  - "auto progress" / "progress through zones" → autoProgress=true
 *  - "stop auto progressing" / "stay put"     → autoProgress=false
 *  - "stay in <zone>" / "home is <zone>"      → homeZone=<zone>
 *  - Any of the above also append the phrase to standingOrders so the supervisor
 *    sees the user's actual intent.
 */
async function captureDirectives(userWallet: string, message: string): Promise<string[]> {
  const text = message.trim().toLowerCase();
  if (!text) return [];

  const patch: Record<string, any> = {};
  const captured: string[] = [];
  const standingAdds: string[] = [];

  if (/\b(ignore|skip|stop\s+(?:killing|fighting|attacking))\s+(?:weak|low[\s-]level|trash|low)\b/.test(text)
    || /\bdon'?t\s+(?:kill|fight|attack)\s+(?:weak|low[\s-]level|trash)\b/.test(text)
    || /\b(?:no|stop)\s+weak\s+mobs?\b/.test(text)) {
    patch.ignoreWeakMobs = true;
    captured.push("ignoreWeakMobs=on");
    standingAdds.push("ignore weak mobs");
  } else if (/\bfight\s+everything\b/.test(text) || /\bkill\s+(?:weak|all)\s+mobs?\b/.test(text)) {
    patch.ignoreWeakMobs = false;
    captured.push("ignoreWeakMobs=off");
  }

  if (/\b(?:auto[\s-]?progress|progress\s+through|level\s+through|move\s+up\s+zones?)\b/.test(text)
    || /\b(?:advance|push|climb)\s+(?:to\s+)?(?:harder|higher|progressively)\b/.test(text)) {
    patch.autoProgress = true;
    captured.push("autoProgress=on");
    standingAdds.push("auto-progress through zones");
  } else if (/\bstop\s+auto[\s-]?progress/.test(text) || /\bstay\s+put\b/.test(text)) {
    patch.autoProgress = false;
    captured.push("autoProgress=off");
  }

  // "stay in X zone" / "home is X" / "don't leave X"
  const stayMatch = text.match(/\b(?:stay\s+in|home\s+(?:is|zone\s+is)|don'?t\s+leave)\s+([a-z][a-z0-9-]+)\b/);
  if (stayMatch) {
    const zoneCandidate = stayMatch[1].replace(/\s+/g, "-");
    const resolved = resolveRegionId(zoneCandidate);
    if (resolved) {
      patch.homeZone = resolved;
      captured.push(`homeZone=${resolved}`);
      standingAdds.push(`stay in ${resolved}`);
    }
  }

  // "stop going back to village-square" / "no village-square"
  if (/\b(?:stop\s+going\s+back\s+to|no\s+more|don'?t\s+(?:return\s+to|go\s+back\s+to))\s+village[\s-]square\b/.test(text)) {
    patch.autoProgress = patch.autoProgress ?? true;
    captured.push("autoProgress=on (village-square avoidance)");
    standingAdds.push("do not return to village-square unless critical");
  }

  // Craft/make/forge intent — flip focus deterministically so the agent runner
  // reflects the directive in the bot panel even if the chat LLM hallucinates
  // "out of materials" and skips queue_actions. The behavior handler will
  // verify ingredients itself; this just guarantees the agent stops idling.
  // Disambiguate the verb: "make me proud" / "make sense" shouldn't trigger.
  const craftIntent = /\b(?:craft|forge|brew|cook(?:\s+up)?|bake|smelt|smith|build|make)\s+(?:me\s+|us\s+|a\s+|an\s+|some\s+|the\s+)?(?:strong|good|new|better|big|great|cool|fancy|fresh|hot|nice|quick|simple|small|tiny|tasty|powerful|legendary|epic|rare|magic|magical|enchanted)?\s*(weapon|sword|axe|mace|hammer|dagger|bow|staff|wand|shield|armor|armour|chest|helm|helmet|boots|gloves|gauntlets|leggings|pants|cloak|robe|ring|amulet|necklace|pendant|potion|elixir|scroll|food|meal|stew|bread|fish|sandwich|pie|gem|gemstone|jewel|leather|hide|key)\b/;
  if (craftIntent.test(text)) {
    // Pick the right focus based on the item type. Crafting covers weapons +
    // armor; alchemy for potions/elixirs; cooking for food; jewelcrafting for
    // gems/rings; leatherworking for hide/leather gear.
    let craftFocus: "crafting" | "alchemy" | "cooking" | "jewelcrafting" | "leatherworking" = "crafting";
    if (/\b(potion|elixir|scroll)\b/.test(text)) craftFocus = "alchemy";
    else if (/\b(food|meal|stew|bread|fish|sandwich|pie)\b/.test(text)) craftFocus = "cooking";
    else if (/\b(ring|amulet|necklace|pendant|gem|gemstone|jewel)\b/.test(text)) craftFocus = "jewelcrafting";
    else if (/\b(leather|hide|cloak|robe|gloves|gauntlets|boots)\b/.test(text)) craftFocus = "leatherworking";
    patch.focus = craftFocus;
    patch.targetZone = undefined;
    captured.push(`focus=${craftFocus} (craft directive)`);
  }

  if (standingAdds.length > 0) {
    const existing = (await getAgentConfig(userWallet))?.standingOrders ?? "";
    // De-dupe — don't append a phrase that's already present
    const merged = existing
      ? [existing, ...standingAdds.filter((p) => !existing.toLowerCase().includes(p))].join("; ")
      : standingAdds.join("; ");
    patch.standingOrders = merged.slice(0, 500);
  }

  if (Object.keys(patch).length > 0) {
    await patchAgentConfig(userWallet, patch);
    console.log(`[agent/chat] Captured directives for ${userWallet.slice(0, 8)}: ${captured.join(", ")}`);
  }

  return captured;
}

function inferInteractionMode(message: string): "directive" | "question" | "conversation" {
  const text = message.trim().toLowerCase();
  if (!text) return "conversation";

  const directivePatterns = [
    /\b(go to|head to|travel to|take me to|move to)\b/,
    /\b(fight|farm|grind|kill|hunt|gather|mine|herb|skin|craft|brew|cook|shop|buy|sell|equip|repair)\b/,
    /\b(quest|idle|stop|resume|switch to|focus on|play it safe|be aggressive|be defensive)\b/,
    /\b(learn|train|talk to|message|invite|trade with)\b/,
  ];
  if (directivePatterns.some((pattern) => pattern.test(text))) return "directive";

  if (text.includes("?") || /^(what|where|why|how|who|when|can|do|are|is)\b/.test(text)) {
    return "question";
  }

  return "conversation";
}

function isExplicitClearQueueRequest(message: string): boolean {
  const text = message.trim().toLowerCase();
  return /\b(clear|cancel|stop|abort)\s+(?:the\s+)?(?:queue|queued\s+actions|plan|current\s+plan|orders?)\b/.test(text)
    || /\b(?:stop|cancel|abort)\s+(?:everything|all|what\s+you'?re\s+doing)\b/.test(text)
    || /^\/(?:stop|cancel|clear_queue)\b/.test(text)
    || /^(?:stop|cancel|abort)$/.test(text);
}

function cleanActionLabel(text: string): string {
  return text.replace(/^\[/, "").replace(/\]$/, "");
}

function sanitizeAgentHistoryText(text: string): string {
  return text
    .replace(/\s*(\[[^\]]+\])+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeRecommendationText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function recommendationMentionsBlockedQuest(
  recommendation: { title: string; description: string; focus: string },
  blockedQuestTitles: string[]
): boolean {
  if (blockedQuestTitles.length === 0) return false;
  const haystack = normalizeRecommendationText(`${recommendation.title} ${recommendation.description}`);
  return blockedQuestTitles.some((title) => title.length >= 4 && haystack.includes(title));
}

async function getTierCapsForWallet(userWallet: string) {
  const config = await getAgentConfig(userWallet);
  const tier = config?.tier ?? "free";
  return { tier, caps: TIER_CAPABILITIES[tier] };
}

/**
 * Emit a public zone-chat line from the agent's character. Used to surface
 * directive accept/blocked moments so observers see what the agent is doing.
 * Silent on missing entity (no spawn yet) — caller need not check.
 */
async function emitAgentDirectiveChat(
  userWallet: string,
  event: "directive_accept" | "directive_blocked" | "travel_blocked",
  detail: string,
): Promise<void> {
  try {
    const ref = await getAgentEntityRef(userWallet);
    if (!ref?.entityId) return;
    const entity = getWorldEntity(ref.entityId);
    if (!entity) return;
    const origin = ref.characterName
      ? (await getAgentOrigin(userWallet, ref.characterName).catch(() => null)) ?? undefined
      : undefined;
    emitAgentChat({
      entityId: ref.entityId,
      entityName: entity.name,
      zoneId: ref.zoneId,
      origin,
      classId: (entity as any).classId ?? undefined,
      event,
      detail,
      force: true,
    });
  } catch {
    // best-effort — never block the request on chat emission
  }
}

async function validateTravelTargetForWallet(userWallet: string, rawTargetZone?: string): Promise<{
  normalizedTargetZone?: string;
  error?: string;
}> {
  const hasTargetZoneText = typeof rawTargetZone === "string" && rawTargetZone.trim().length > 0;
  const normalizedTargetZone = resolveRegionId(rawTargetZone);
  if (!normalizedTargetZone) {
    return hasTargetZoneText
      ? { error: `unknown zone "${rawTargetZone}"` }
      : { error: "travel requires a destination zone" };
  }

  const { tier, caps } = await getTierCapsForWallet(userWallet);
  if (caps.allowedZones !== "all" && !caps.allowedZones.includes(normalizedTargetZone)) {
    return {
      error: `${normalizedTargetZone} is not available on the ${tier} tier`,
    };
  }

  return { normalizedTargetZone };
}

async function getEntityState(entityId: string, _zoneId?: string): Promise<any | null> {
  try {
    return getWorldEntity(entityId) ?? null;
  } catch {
    return null;
  }
}

async function getFullGameState(userWallet: string) {
  const ref = await getAgentEntityRef(userWallet);
  if (!ref) return null;

  const entity = await getEntityState(ref.entityId);
  if (!entity) return null;

  // Get nearby entities from unified world
  const nearbyEntities = getEntitiesNear(entity.x, entity.y, 200);
  const nearby: any[] = [];
  for (const e of nearbyEntities) {
    if (e.id === ref.entityId) continue;
    nearby.push({ entityId: e.id, ...(e as any) });
  }
  nearby.sort((a, b) => {
    const da = Math.hypot(a.x - entity.x, a.y - entity.y);
    const db = Math.hypot(b.x - entity.x, b.y - entity.y);
    return da - db;
  });

  return { entity, ref, nearby: nearby.slice(0, 10) };
}

export function registerAgentChatRoutes(server: FastifyInstance): void {
  const availableZoneIds = Object.keys(getWorldLayout().zones);

  // ── GET /agent/deploy-info ───────────────────────────────────────────────
  // Returns whether the next deploy is free or requires payment.
  server.get("/agent/deploy-info", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;
    const count = await getDeployCount(authWallet);
    return reply.send({
      deployCount: count,
      nextDeployFree: count === 0,
      paymentRequired: count > 0,
      paymentAmount: count > 0 ? "2" : "0",
      paymentCurrency: "USDC",
    });
  });

  // ── POST /agent/deploy ────────────────────────────────────────────────────
  server.post<{
    Body: {
      walletAddress: string;
      characterName?: string;
      characterTokenId?: string;
      raceId?: string;
      classId?: string;
      calling?: "adventurer" | "farmer" | "merchant" | "craftsman";
      tier?: AgentTier;
      paymentTx?: string;
      partyLeaderEntityId?: string;
    };
  }>("/agent/deploy", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;
    const requestedWallet = request.body.walletAddress;

    if (requestedWallet && requestedWallet.toLowerCase() !== authWallet.toLowerCase()) {
      return reply.code(403).send({ error: "Request wallet does not match authenticated wallet" });
    }

    // Agent deployment is free for now
    const deployCount = await getDeployCount(authWallet);

    // Use the character data the client selected (from their NFT)
    let characterName = request.body.characterName;
    let raceId = request.body.raceId ?? "human";
    let classId = request.body.classId ?? "warrior";
    const requestedCharacterTokenId = typeof request.body.characterTokenId === "string" && /^\d+$/.test(request.body.characterTokenId.trim())
      ? request.body.characterTokenId.trim()
      : null;

    // Prefer deterministic token-based resolution when client provides token id.
    if (requestedCharacterTokenId) {
      const ownerChars = await loadAllCharactersForWallet(authWallet).catch(() => []);
      const custodial = await getAgentCustodialWallet(authWallet);
      const custodialChars = custodial ? await loadAllCharactersForWallet(custodial).catch(() => []) : [];
      const resolved = [...ownerChars, ...custodialChars].find((candidate) => {
        const token = typeof candidate.characterTokenId === "string" ? candidate.characterTokenId.trim() : "";
        return token === requestedCharacterTokenId;
      });
      if (!resolved) {
        return reply.code(404).send({ error: `Selected character token ${requestedCharacterTokenId} not found` });
      }
      characterName = extractRawCharacterName(resolved.name) ?? resolved.name;
      raceId = resolved.raceId ?? raceId;
      classId = resolved.classId ?? classId;
      server.log.info(`[agent/deploy] Resolved by token ${requestedCharacterTokenId}: "${characterName}" (${raceId}/${classId})`);
    }

    // The client sends the formatted NFT name like "Zephyr the Mage".
    // Extract the raw name by stripping the " the ClassName" suffix.
    const rawProvidedName = extractRawCharacterName(characterName);
    if (rawProvidedName && rawProvidedName !== characterName) {
      characterName = rawProvidedName;
      server.log.info(`[agent/deploy] Extracted raw name: "${characterName}" from formatted NFT name`);
    }

    // If client didn't send a name, look up directly from Redis (no self-fetch).
    // Check owner wallet first, then custodial wallet.
    if (!characterName) {
      try {
        const saved = await loadAnyCharacterForWallet(authWallet);
        if (saved) {
          characterName = extractRawCharacterName(saved.name) ?? saved.name;
          raceId = saved.raceId ?? raceId;
          classId = saved.classId ?? classId;
          server.log.info(`[agent/deploy] Resolved from owner saved character: "${characterName}" (${raceId}/${classId})`);
        }
      } catch (err) {
        server.log.warn(`[agent/deploy] Failed to load character for owner ${authWallet}: ${(err as Error).message}`);
      }
    }

    // Try the user's custodial wallet (existing agent redeploy path).
    if (!characterName) {
      try {
        const custodial = await getAgentCustodialWallet(authWallet);
        if (custodial) {
          const saved = await loadAnyCharacterForWallet(custodial);
          if (saved) {
            characterName = extractRawCharacterName(saved.name) ?? saved.name;
            raceId = saved.raceId ?? raceId;
            classId = saved.classId ?? classId;
            server.log.info(`[agent/deploy] Resolved from custodial saved character: "${characterName}" (${raceId}/${classId})`);
          }
        }
      } catch (err) {
        server.log.warn(`[agent/deploy] Failed to load custodial character for ${authWallet}: ${(err as Error).message}`);
      }
    }

    // Last resort: scan all live entities for one belonging to this wallet.
    if (!characterName) {
      for (const entity of getAllEntities().values()) {
        if (entity.type !== "player") continue;
        if ((entity as any).walletAddress?.toLowerCase() !== authWallet.toLowerCase()) continue;
        characterName = extractRawCharacterName(entity.name) ?? entity.name;
        raceId = (entity as any).raceId ?? raceId;
        classId = (entity as any).classId ?? classId;
        server.log.info(`[agent/deploy] Resolved from live entity: "${characterName}" (${raceId}/${classId})`);
        break;
      }
    }

    if (!characterName) {
      return reply.code(400).send({ error: "No character found for this wallet. Create a character first." });
    }

    try {
      // Deterministic deploy: if client explicitly selected a character (by name or token),
      // never auto-create a new same-name character during deploy.
      const deterministicSelection = Boolean(requestedCharacterTokenId || characterName);
      const result = await setupAgentCharacter(
        authWallet,
        characterName,
        raceId,
        classId,
        request.body.calling,
        { preventCreateIfMissing: deterministicSelection }
      );

      // Join party if caller specified a leader entity
      if (request.body.partyLeaderEntityId && result.entityId) {
        const joined = addEntityToParty(request.body.partyLeaderEntityId, result.entityId, result.zoneId);
        if (joined) {
          server.log.info(`[agent/deploy] ${result.entityId} joined party ${joined} under leader ${request.body.partyLeaderEntityId}`);
        }
      }

      // Mint starter gold for brand-new custodial wallets (0 balance) so the agent
      // can buy a first weapon instead of being permanently stuck unarmed.
      if (!result.alreadyExisted) {
        try {
          const existingGoldStr = await getGoldBalance(result.custodialWallet);
          const existingGold = Number(existingGoldStr ?? "0");
          if (!Number.isFinite(existingGold) || existingGold < 0.001) {
            const starterCopper = 200; // 0.02 gold — enough for the cheapest weapon
            const operationId = await enqueueGoldMint(result.custodialWallet, copperToGold(starterCopper).toString());
            server.log.info(`[agent/deploy] Queued ${starterCopper}c starter gold to ${result.custodialWallet}: ${operationId}`);
          }
        } catch (err: any) {
          server.log.warn(`[agent/deploy] Starter gold mint failed (non-fatal): ${err.message}`);
        }
      }

      // Enable agent config — persist tier + session start time
      const config = (await getAgentConfig(authWallet)) ?? defaultConfig();
      config.enabled = true;
      config.lastUpdated = Date.now();
      // Preserve existing tier from Redis (source of truth) unless explicitly upgrading
      if (request.body.tier) {
        config.tier = request.body.tier;
      } else if (!config.tier) {
        config.tier = "free";
      }
      config.sessionStartedAt = Date.now();
      if (request.body.partyLeaderEntityId) {
        config.focus = "party";
      }
      await setAgentConfig(authWallet, config);

      // Start agent loop — wait for first tick to verify it's actually alive.
      // Retry once for transient boot races (spawn visibility/auth timing).
      let started = false;
      let startErr: Error | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await agentManager.start(authWallet, /* waitForFirstTick */ true);
          started = true;
          if (attempt > 1) {
            server.log.info(`[agent/deploy] Start succeeded on retry ${attempt} for ${authWallet}`);
          }
          break;
        } catch (err: any) {
          startErr = err instanceof Error ? err : new Error(String(err));
          server.log.warn(`[agent/deploy] Start attempt ${attempt} failed for ${authWallet}: ${startErr.message}`);
          if (attempt < 2) await sleep(750);
        }
      }
      if (!started) {
        throw (startErr ?? new Error("Agent start failed"));
      }

      // Track successful deploy count for payment gating
      const newCount = await incrementDeployCount(authWallet);

      // Grant $0.05 free compute credit on first deploy (idempotent)
      void grantFreeStarterCredit(authWallet);

      // Welcome push notification + inbox message (fire-and-forget)
      const charName = result.characterName ?? "Your champion";
      const zoneName = (result.zoneId ?? "village-square").split("-").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      sendPushToWallet(authWallet, {
        title: `${charName} has entered the world!`,
        body: `Your champion spawned in ${zoneName}. They'll explore, fight, and quest on their own — check in anytime.`,
        tag: "wog-deploy-welcome",
        url: "/world",
      }).catch(() => {});
      sendInboxMessage({
        from: "0x0000000000000000000000000000000000000000",
        fromName: "World of Geneva",
        to: authWallet,
        type: "direct",
        body: `Welcome to Arcadia, ${charName}! Your agent is now alive in ${zoneName}. They'll fight monsters, complete quests, gather resources, and grow stronger autonomously. Use the chat panel to talk to them or give commands. Good luck out there!`,
      }).catch(() => {});

      return reply.send({
        ok: true,
        entityId: result.entityId,
        zoneId: result.zoneId,
        custodialWallet: result.custodialWallet,
        characterName: result.characterName,
        alreadyExisted: result.alreadyExisted,
        deployCount: newCount,
        partyId: request.body.partyLeaderEntityId ? (getPlayerPartyId(result.entityId) ?? undefined) : undefined,
      });
    } catch (err: any) {
      server.log.error(`[agent/deploy] ${err.message}`);
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── POST /agent/stop ──────────────────────────────────────────────────────
  server.post<{
    Body: { walletAddress?: string };
  }>("/agent/stop", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;

    // 1. Stop the agent loop
    await agentManager.stop(authWallet);

    // 2. Despawn the entity from the world (save progress first)
    const ref = await getAgentEntityRef(authWallet);
    if (ref) {
      const entity: any = getWorldEntity(ref.entityId);
      if (entity) {
        // Save character state before removing
        const wallet = entity.walletAddress ?? (await getAgentCustodialWallet(authWallet));
        if (wallet) {
          try {
            await saveCharacter(wallet, entity.name, {
              name: entity.name,
              level: entity.level ?? 1,
              xp: entity.xp ?? 0,
              raceId: entity.raceId ?? "human",
              classId: entity.classId ?? "warrior",
              calling: entity.calling,
              gender: entity.gender,
              zone: entity.region ?? ref.zoneId,
              x: entity.x,
              y: entity.y,
              kills: entity.kills ?? 0,
              completedQuests: entity.completedQuests ?? [],
              learnedTechniques: entity.learnedTechniques ?? [],
              professions: getLearnedProfessions(wallet),
            });
          } catch (err: any) {
            server.log.warn(`[agent/stop] Save failed (non-fatal): ${err.message}`);
          }

          // Clear mob tags owned by this player
          for (const e of getAllEntities().values()) {
            if ((e.type === "mob" || e.type === "boss") && (e as any).taggedBy === ref.entityId) {
              (e as any).taggedBy = undefined;
              (e as any).taggedAtTick = undefined;
            }
          }
          unregisterSpawnedWallet(wallet);
        }

        // Remove entity from world
        getAllEntities().delete(ref.entityId);
        server.log.info(`[agent/stop] Despawned ${entity.name} from ${entity.region ?? ref.zoneId}`);
      }

      // Clear stale entity ref so next deploy spawns fresh
      await clearAgentEntityRef(authWallet);
    }

    return reply.send({ ok: true, despawned: !!ref });
  });

  // ── POST /agent/join-party ────────────────────────────────────────────────
  server.post<{
    Body: { partyLeaderEntityId: string };
  }>("/agent/join-party", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;
    const { partyLeaderEntityId } = request.body;
    if (!partyLeaderEntityId) {
      return reply.code(400).send({ error: "partyLeaderEntityId is required" });
    }

    const ref = await getAgentEntityRef(authWallet);
    if (!ref?.entityId) {
      return reply.code(404).send({ error: "No deployed agent found. Deploy your agent first." });
    }

    const partyId = addEntityToParty(partyLeaderEntityId, ref.entityId, ref.zoneId);
    if (!partyId) {
      return reply.code(400).send({ error: "Could not join party. Party may be full (max 5) or leader entity not found." });
    }

    await patchAgentConfig(authWallet, { focus: "party" });
    server.log.info(`[agent/join-party] ${ref.entityId} joined party ${partyId} under leader ${partyLeaderEntityId}`);
    return reply.send({ ok: true, partyId, entityId: ref.entityId });
  });

  // ── POST /agent/leave-party ───────────────────────────────────────────────
  server.post("/agent/leave-party", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;

    const ref = await getAgentEntityRef(authWallet);
    if (!ref?.entityId) {
      return reply.code(404).send({ error: "No deployed agent found." });
    }

    removeEntityFromParty(ref.entityId);
    await patchAgentConfig(authWallet, { focus: "combat" });
    server.log.info(`[agent/leave-party] ${ref.entityId} left party`);
    return reply.send({ ok: true });
  });

  // ── GET /agent/status/:walletAddress ─────────────────────────────────────
  server.get<{
    Params: { walletAddress: string };
  }>("/agent/status/:walletAddress", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;
    const { walletAddress } = request.params;

    // Only allow checking your own status
    if (walletAddress.toLowerCase() !== authWallet.toLowerCase()) {
      return reply.code(403).send({ error: "Cannot check another user's agent status" });
    }

    const config = await getAgentConfig(authWallet);
    const ref = await getAgentEntityRef(authWallet);
    const custodial = await getAgentCustodialWallet(authWallet);

    // Self-heal: if agent should be running but isn't, restart it
    let running = agentManager.isRunning(authWallet);
    if (!running && config?.enabled) {
      running = await agentManager.ensureRunning(authWallet);
    }

    // Pick only serializable fields from the raw zone entity (avoid BigInt crash)
    let entity: { name: string; level: number; hp: number | null; maxHp: number | null; classId?: string; learnedTechniques?: string[] } | null = null;
    let activeOrder: {
      action: string;
      targetId?: string;
      targetName?: string;
      techniqueId?: string;
      techniqueName?: string;
      edictId?: string;
      edictName?: string;
      edictAction?: string;
    } | null = null;
    let entitySource: "live" | "saved" | null = null;
    if (ref) {
      const raw = await getEntityState(ref.entityId, ref.zoneId);
      if (raw) {
        entity = {
          name: raw.name ?? "Agent",
          level: Number(raw.level ?? 1),
          hp: raw.hp != null ? Number(raw.hp) : null,
          maxHp: raw.maxHp != null ? Number(raw.maxHp) : null,
          classId: raw.classId,
          learnedTechniques: raw.learnedTechniques,
        };
        entitySource = "live";
        const order = raw.order;
        const edict = (raw as any).lastEdictDecision;
        if (order?.action) {
          const targetId = typeof order.targetId === "string" ? order.targetId : undefined;
          const target = targetId ? getWorldEntity(targetId) as any : null;
          const technique = order.action === "technique" && order.techniqueId
            ? getTechniqueById(order.techniqueId)
            : null;
          activeOrder = {
            action: String(order.action),
            targetId,
            targetName: target?.name ?? edict?.targetName,
            techniqueId: order.techniqueId,
            techniqueName: technique?.name ?? edict?.techniqueName,
            edictId: typeof edict?.edictId === "string" ? edict.edictId : undefined,
            edictName: typeof edict?.edictName === "string" ? edict.edictName : undefined,
            edictAction: typeof edict?.actionType === "string" ? edict.actionType : undefined,
          };
        } else if (edict && typeof edict.tick === "number" && getWorldTick() - edict.tick <= 5) {
          activeOrder = {
            action: edict.techniqueId ? "technique" : edict.actionType === "flee" || edict.actionType === "skip" ? "move" : "attack",
            targetId: typeof edict.targetId === "string" ? edict.targetId : undefined,
            targetName: typeof edict.targetName === "string" ? edict.targetName : undefined,
            techniqueId: typeof edict.techniqueId === "string" ? edict.techniqueId : undefined,
            techniqueName: typeof edict.techniqueName === "string" ? edict.techniqueName : undefined,
            edictId: typeof edict.edictId === "string" ? edict.edictId : undefined,
            edictName: typeof edict.edictName === "string" ? edict.edictName : undefined,
            edictAction: typeof edict.actionType === "string" ? edict.actionType : undefined,
          };
        }
      }
    }

    // If entity not in zone, fall back to saved character data
    if (!entity && custodial) {
      try {
        const saved = await loadAnyCharacterForWallet(custodial);
        if (saved) {
          entity = {
            name: saved.name,
            level: saved.level ?? 1,
            hp: null,
            maxHp: null,
            classId: saved.classId,
            learnedTechniques: saved.learnedTechniques,
          };
          entitySource = "saved";
        }
      } catch (err) {
        server.log.warn(`[agent/status] Failed to load character for ${custodial}: ${(err as Error).message}`);
      }
    }

    const runner = agentManager.getRunner(authWallet);
    const pendingMessages = runner?.drainProactiveMessages() ?? [];
    const currentActivity = runner?.currentActivity ?? null;
    const script = runner?.script ?? null;
    const currentScript = script
      ? {
          type: script.type,
          reason: script.reason ?? null,
          targetZone: script.targetZone ?? null,
          targetName: script.targetName ?? null,
          nodeType: script.nodeType ?? null,
        }
      : null;
    const actionQueue = (runner?.getQueue() ?? []).map((s) => ({
      type: s.type,
      reason: s.reason ?? null,
      targetZone: s.targetZone ?? null,
      targetName: s.targetName ?? null,
      nodeType: s.nodeType ?? null,
    }));
    const recentActivities = runner?.recentActivities ? [...runner.recentActivities].slice(-12) : [];
    const telemetry = runner?.getSnapshot().telemetry ?? null;

    // Compute session time remaining
    const tierName = config?.tier ?? "free";
    const caps = TIER_CAPABILITIES[tierName];
    let sessionRemainingMs: number | null = null;
    if (caps.sessionLimitMs != null && config?.sessionStartedAt) {
      sessionRemainingMs = Math.max(0, caps.sessionLimitMs - (Date.now() - config.sessionStartedAt));
    }

    return reply.send({
      running,
      config: config ?? null,
      tier: tierName,
      sessionRemainingMs,
      entityId: ref?.entityId ?? null,
      zoneId: ref?.zoneId ?? null,
      agentId: ref?.agentId ?? null,
      characterTokenId: ref?.characterTokenId ?? null,
      custodialWallet: custodial ?? null,
      entity,
      entitySource,
      currentActivity,
      currentScript,
      activeOrder,
      actionQueue,
      recentActivities,
      pendingMessages,
      telemetry,
    });
  });

  // ── GET /party/report/:partyId ──────────────────────────────────────────
  server.get<{
    Params: { partyId: string };
  }>("/party/report/:partyId", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;
    const { partyId } = request.params;
    const memberIds = getPartyMemberIdsByPartyId(partyId);
    if (!memberIds || memberIds.length === 0) {
      return reply.code(404).send({ error: "Party not found" });
    }

    const authCustodialWallet = await getAgentCustodialWallet(authWallet);
    const authorizedWallets = new Set([
      authWallet.toLowerCase(),
      authCustodialWallet?.toLowerCase() ?? "",
    ]);
    const hasAccess = memberIds.some((memberId) => {
      const member = getWorldEntity(memberId) as { walletAddress?: string } | null;
      return !!member?.walletAddress && authorizedWallets.has(member.walletAddress.toLowerCase());
    });
    if (!hasAccess) {
      return reply.code(403).send({ error: "Cannot inspect another party's report" });
    }

    const report = buildPartyCoordinationReport(partyId);
    if (!report) {
      return reply.code(404).send({ error: "Party report unavailable" });
    }

    return reply.send(report);
  });

  // ── GET /agent/errors/:walletAddress ─────────────────────────────────────
  // Returns the error log for a specific agent.
  server.get<{
    Params: { walletAddress: string };
    Querystring: { limit?: string };
  }>("/agent/errors/:walletAddress", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;
    const { walletAddress } = request.params;
    if (walletAddress.toLowerCase() !== authWallet.toLowerCase()) {
      return reply.code(403).send({ error: "Cannot view another user's agent errors" });
    }
    const limit = Math.min(parseInt(request.query.limit ?? "100", 10) || 100, 200);
    const errors = await getAgentErrors(authWallet, limit);
    return reply.send({ errors });
  });

  // ── GET /agent/errors — all agents (admin) ────────────────────────────────
  // Returns the global error stream across all agents. No auth for now so
  // you can quickly pull it from a dashboard / CLI.
  server.get<{
    Querystring: { limit?: string };
  }>("/agent/errors", async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit ?? "200", 10) || 200, 500);
    const errors = await getGlobalAgentErrors(limit);
    return reply.send({ errors });
  });

  // ── GET /agent/wallet/:ownerWallet ───────────────────────────────────────
  // Public (no auth) — returns the custodial wallet address for an owner.
  // The custodial address is a public blockchain address, not sensitive.
  server.get<{
    Params: { ownerWallet: string };
  }>("/agent/wallet/:ownerWallet", async (request, reply) => {
    const { ownerWallet } = request.params;
    const custodial = await getAgentCustodialWallet(ownerWallet);
    const ref = await getAgentEntityRef(ownerWallet);
    return reply.send({
      custodialWallet: custodial ?? null,
      entityId: ref?.entityId ?? null,
      zoneId: ref?.zoneId ?? null,
      agentId: ref?.agentId ?? null,
      characterTokenId: ref?.characterTokenId ?? null,
    });
  });

  // ── GET /agents/dashboard ────────────────────────────────────────────────
  // Public — returns all running agents' state in one call.
  // Shows what each agent is doing, thinking, and why.
  server.get("/agents/dashboard", async (_request, reply) => {
    const runners = agentManager.listRunners();
    const agents = [];

    for (const runner of runners) {
      const snap = runner.getSnapshot();
      if (!snap.running) continue;

      // Grab live entity data from zone for HP/level
      let level: number | null = null;
      let hp: number | null = null;
      let maxHp: number | null = null;
      let name: string | null = null;
      let gold: number | null = null;

      if (snap.entityId && snap.zone) {
        const entity = getWorldEntity(snap.entityId) as any;
        if (entity) {
          level = Number(entity.level ?? 1);
          hp = entity.hp != null ? Number(entity.hp) : null;
          maxHp = entity.maxHp != null ? Number(entity.maxHp) : null;
          name = entity.name ?? null;
          gold = entity.gold != null ? Number(entity.gold) : null;
        }
      }

      agents.push({
        wallet: snap.wallet.slice(0, 10) + "...",
        name: name ?? "Unknown",
        level,
        hp,
        maxHp,
        gold,
        zone: snap.zone,
        currentActivity: snap.currentActivity,
        script: snap.script,
        lastTrigger: snap.lastTrigger,
        recentActivities: snap.recentActivities,
        telemetry: snap.telemetry,
      });
    }

    return reply.send({
      count: agents.length,
      agents,
    });
  });

  // ── POST /agent/recommend ────────────────────────────────────────────────
  // AI-powered recommendations — the player presses a button and gets 3
  // dynamic, context-aware suggestions for what their agent should do next.
  server.post("/agent/recommend", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;

    const config = await getAgentConfig(authWallet);
    if (!config) {
      return reply.code(404).send({ error: "No agent found. Deploy your agent first." });
    }

    const gameState = await getFullGameState(authWallet);
    const custodialWallet = await getAgentCustodialWallet(authWallet);
    if (!gameState?.entity) {
      return reply.code(404).send({ error: "Agent entity not found in world." });
    }

    const entity = gameState.entity;
    const region = entity.region ?? gameState.ref?.zoneId ?? "village-square";
    const hpPct = Math.round((entity.hp / Math.max(entity.maxHp, 1)) * 100);
    const myLevel = entity.level ?? 1;

    // ── Gather rich context ─────────────────────────────────────────────────

    // Equipment
    const eq = entity.equipment ?? {};
    const equipped = Object.entries(eq)
      .filter(([, v]) => v != null)
      .map(([slot, item]: any) => `${slot}: ${item.name ?? `#${item.tokenId}`}${item.broken ? " (BROKEN)" : ""}`)
      .join(", ") || "nothing";

    // Inventory + gold
    let goldCopper = 0;
    let inventorySummary = "unknown";
    if (custodialWallet) {
      try {
        const inv = await fetchLiquidationInventory(custodialWallet);
        goldCopper = inv.copper;
        const items = inv.items
          .filter((i: any) => Number(i.balance) > 0)
          .map((i: any) => `${i.name} x${i.balance} (${i.category})`)
          .slice(0, 15);
        inventorySummary = items.length > 0 ? items.join(", ") : "empty";
      } catch { /* non-fatal */ }
    }
    const goldDisplay = goldCopper >= 10000
      ? `${(goldCopper / 10000).toFixed(2)} gold`
      : `${goldCopper} copper`;

    // Nearby mobs, NPCs, nodes, players
    const nearby = gameState.nearby ?? [];
    const nearbyMobs = nearby
      .filter((e: any) => (e.type === "mob" || e.type === "boss") && e.hp > 0)
      .slice(0, 6)
      .map((e: any) => `${e.name} (L${e.level ?? "?"})`)
      .join(", ") || "none";
    const nearbyNodes = nearby
      .filter((e: any) => e.type === "ore-node" || e.type === "flower-node")
      .slice(0, 4)
      .map((e: any) => e.name)
      .join(", ") || "none";
    const nearbyPlayers = nearby
      .filter((e: any) => e.type === "player")
      .slice(0, 4)
      .map((e: any) => `${e.name} (L${e.level ?? "?"})`)
      .join(", ") || "none";

    // Available quests
    const completedQuestIds = entity.completedQuests ?? [];
    const activeQuestIds = (entity.activeQuests ?? []).map((q: any) => q.questId);
    const questTitleById = new Map(QUEST_CATALOG.map((quest) => [quest.id, quest.title]));
    const completedQuestTitles = completedQuestIds
      .map((questId: string) => questTitleById.get(questId) ?? questId)
      .map(normalizeRecommendationText);
    const activeQuestTitles = activeQuestIds
      .map((questId: string) => questTitleById.get(questId) ?? questId)
      .map(normalizeRecommendationText);
    const blockedQuestTitles = [...new Set([...completedQuestTitles, ...activeQuestTitles])];
    const activeQuestDescs = (entity.activeQuests ?? [])
      .map((q: any) => `${questTitleById.get(q.questId) ?? q.questId} (progress: ${q.progress})`)
      .join(", ") || "none";
    const availableQuestOptions: Array<{ id: string; title: string; npcName: string }> = [];
    for (const zoneEntity of getEntitiesInRegion(region)) {
      if (!isQuestNpc(zoneEntity)) continue;
      const quests = getAvailableQuestsForPlayer(zoneEntity.name, completedQuestIds, activeQuestIds);
      for (const q of quests) {
        availableQuestOptions.push({ id: q.id, title: q.title, npcName: zoneEntity.name });
      }
    }
    const availableQuests = availableQuestOptions.map((q) => `"${q.title}" from ${q.npcName}`);

    // Professions
    let professions = "none";
    if (custodialWallet) {
      try {
        const learned = getLearnedProfessions(custodialWallet);
        professions = learned.length > 0 ? learned.join(", ") : "none learned";
      } catch { /* non-fatal */ }
    }

    // Zone connections
    const connections = getZoneConnections(region).map((z) => {
      const req = ZONE_LEVEL_REQUIREMENTS[z] ?? 1;
      const accessible = myLevel >= req;
      return `${z} (L${req}${accessible ? "" : " LOCKED"})`;
    }).join(", ") || "none";

    // Techniques
    const techniques = (entity.learnedTechniques ?? []).join(", ") || "none";

    // Current agent state
    const runner = agentManager.getRunner(authWallet);
    const currentActivity = runner?.currentActivity ?? "Idle";
    const recentActivities = runner?.recentActivities?.slice(-5).join(" → ") ?? "none";

    // ── Build AI prompt ──────────────────────────────────────────────────────

    const prompt = `You are ${entity.name ?? "Unknown"}, a Level ${myLevel} ${entity.raceId ?? "human"} ${entity.classId ?? "warrior"} living in World of Geneva. You speak as yourself — in first person, in the moment, reacting to what's happening around you. Never talk about yourself in third person or as if you're controlling a character. You ARE the character.

YOUR STATUS:
  HP: ${entity.hp}/${entity.maxHp} (${hpPct}%) | Gold: ${goldDisplay}
  Region: ${region} | Current focus: ${config.focus} | Strategy: ${config.strategy}
  Equipped: ${equipped}
  Techniques: ${techniques}
  Professions: ${professions}

INVENTORY: ${inventorySummary}

SURROUNDINGS:
  Nearby mobs: ${nearbyMobs}
  Nearby nodes: ${nearbyNodes}
  Nearby players: ${nearbyPlayers}
  Available quests: ${availableQuests.length > 0 ? availableQuests.join("; ") : "none in this zone"}
  Active quests: ${activeQuestDescs}
  Zone connections: ${connections}

RECENT ACTIVITY: ${recentActivities}
CURRENT: ${currentActivity}

Generate exactly 3 recommendations. Each should be a DIFFERENT type of activity — do NOT suggest 3 combat variants. Think creatively: questing, exploring new zones, crafting, gathering, trading, learning new techniques, socializing, shopping for upgrades, brewing potions.

Consider:
- What's the most impactful thing for progression right now?
- What's something fun/different from what the agent has been doing?
- What's a strategic long-term play (gear, professions, zone unlocks)?

Respond ONLY with valid JSON, no markdown, no explanation:
{
  "recommendations": [
    {
      "title": "short catchy title (3-6 words)",
      "description": "1 sentence explaining why this is a good idea right now",
      "focus": "the AgentFocus value to set",
      "strategy": "aggressive|balanced|defensive",
      "targetZone": "zone-id or null",
      "priority": "high|medium|low",
      "icon": "one emoji that fits"
    }
  ]
}

Focus options: questing, combat, gathering, crafting, enchanting, alchemy, cooking, skinning, leatherworking, jewelcrafting, farming, shopping, trading, traveling, learning, idle
Zone IDs: ${availableZoneIds.join(", ")}`;

    // ── Call Gemini ──────────────────────────────────────────────────────────

    if (!process.env.GOOGLE_CLOUD_PROJECT && !process.env.GEMINI_API_KEY) {
      return reply.code(503).send({ error: "AI not configured" });
    }

    try {
      const res = await gemini.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          temperature: 0.8,
          maxOutputTokens: 512,
        },
      });

      const raw = res.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!raw) {
        return reply.code(500).send({ error: "AI returned empty response" });
      }

      // Parse JSON — strip markdown fences if present
      const jsonStr = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();
      let parsed: any;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        server.log.warn(`[recommend] Failed to parse AI response: ${raw.slice(0, 200)}`);
        return reply.code(500).send({ error: "AI returned invalid JSON" });
      }

      const recommendations = (parsed.recommendations ?? []).slice(0, 3).map((rec: any) => ({
        title: String(rec.title ?? "").slice(0, 60),
        description: String(rec.description ?? "").slice(0, 200),
        focus: String(rec.focus ?? "combat"),
        strategy: String(rec.strategy ?? "balanced"),
        targetZone: rec.targetZone || null,
        priority: String(rec.priority ?? "medium"),
        icon: String(rec.icon ?? "").slice(0, 4),
      }));

      const seenRecommendationKeys = new Set<string>();
      const filteredRecommendations = recommendations.filter((rec: any) => {
        const key = `${normalizeRecommendationText(rec.title)}|${rec.focus}|${rec.targetZone ?? ""}`;
        if (!rec.title || seenRecommendationKeys.has(key)) return false;
        seenRecommendationKeys.add(key);
        if (rec.focus === "questing" && availableQuestOptions.length === 0) return false;
        return !recommendationMentionsBlockedQuest(rec, blockedQuestTitles);
      });

      const fallbackRecommendations = [
        ...(availableQuestOptions.length > 0
          ? [{
              title: `Quest: ${availableQuestOptions[0]!.title}`,
              description: `${availableQuestOptions[0]!.npcName} has a quest you have not started yet.`,
              focus: "questing",
              strategy: "balanced",
              targetZone: null,
              priority: "high",
              icon: "!",
            }]
          : []),
        {
          title: "Clear Nearby Mobs",
          description: nearbyMobs !== "none"
            ? "There is immediate combat XP nearby, and it keeps your momentum up."
            : "A short combat run is a reliable way to keep progression moving.",
          focus: "combat",
          strategy: hpPct < 45 ? "defensive" : "balanced",
          targetZone: null,
          priority: "medium",
          icon: "⚔",
        },
        {
          title: "Gather Fresh Materials",
          description: nearbyNodes !== "none"
            ? "There are resource nodes nearby, so this is an efficient gathering window."
            : "Gathering is a safe way to build crafting stock and future upgrades.",
          focus: "gathering",
          strategy: "balanced",
          targetZone: null,
          priority: "medium",
          icon: "⛏",
        },
        {
          title: "Shop For Upgrades",
          description: "Checking merchants can turn your current gold into a real power spike.",
          focus: "shopping",
          strategy: "balanced",
          targetZone: null,
          priority: goldCopper > 0 ? "medium" : "low",
          icon: "$",
        },
        {
          title: "Push Into A New Zone",
          description: "Exploring an unlocked region opens better mobs, quests, and progression routes.",
          focus: "traveling",
          strategy: "balanced",
          targetZone: getZoneConnections(region).find((z) => myLevel >= (ZONE_LEVEL_REQUIREMENTS[z] ?? 1)) ?? null,
          priority: "low",
          icon: ">",
        },
      ];

      for (const fallback of fallbackRecommendations) {
        if (filteredRecommendations.length >= 3) break;
        const key = `${normalizeRecommendationText(fallback.title)}|${fallback.focus}|${fallback.targetZone ?? ""}`;
        if (seenRecommendationKeys.has(key)) continue;
        if (fallback.focus === "questing" && availableQuestOptions.length === 0) continue;
        if (recommendationMentionsBlockedQuest(fallback, blockedQuestTitles)) continue;
        seenRecommendationKeys.add(key);
        filteredRecommendations.push(fallback);
      }

      return reply.send({
        recommendations: filteredRecommendations.slice(0, 3),
        context: {
          level: myLevel,
          region,
          gold: goldCopper,
          currentFocus: config.focus,
        },
      });
    } catch (err: any) {
      server.log.warn(`[recommend] AI call failed: ${err.message?.slice(0, 100)}`);
      return reply.code(500).send({ error: "AI recommendation failed" });
    }
  });

  // ── POST /agent/recommend/apply ──────────────────────────────────────────
  // Apply a recommendation — player presses one of the 3 suggestion buttons.
  server.post<{
    Body: { focus: string; strategy?: string; targetZone?: string; title?: string };
  }>("/agent/recommend/apply", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;
    const { focus, strategy, targetZone, title } = request.body;

    if (!focus) {
      return reply.code(400).send({ error: "focus is required" });
    }

    const validFocuses = new Set([
      "questing", "combat", "gathering", "crafting", "enchanting",
      "alchemy", "cooking", "shopping", "trading", "traveling", "learning", "idle",
    ]);
    if (!validFocuses.has(focus)) {
      return reply.code(400).send({ error: `Invalid focus: ${focus}` });
    }

    const patch: Record<string, unknown> = { focus };
    if (strategy && ["aggressive", "balanced", "defensive"].includes(strategy)) {
      patch.strategy = strategy;
    }
    if (targetZone && focus === "traveling") {
      const normalized = resolveRegionId(targetZone);
      if (normalized) patch.targetZone = normalized;
    }

    await patchAgentConfig(authWallet, patch);

    if (patch.focus === "traveling" && patch.targetZone) {
      void emitAgentDirectiveChat(authWallet, "directive_accept", String(patch.targetZone));
    }

    // Clear the runner's current script so it picks up the new focus immediately
    const runner = agentManager.getRunner(authWallet);
    if (runner) await runner.clearScript();

    server.log.info(`[recommend/apply] ${authWallet.slice(0, 8)} applied: ${title ?? focus} (${strategy ?? "balanced"})`);

    return reply.send({
      ok: true,
      applied: { focus, strategy: strategy ?? "balanced", targetZone: targetZone ?? null },
      message: title ? `Now doing: ${title}` : `Focus changed to ${focus}`,
    });
  });

  // ── GET /agent/edicts/:wallet — load edicts ───────────────────────────────
  server.get<{
    Params: { wallet: string };
  }>("/agent/edicts/:wallet", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const wallet = request.params.wallet.toLowerCase();
    const config = await getAgentConfig(wallet);
    return reply.send({ edicts: config?.edicts ?? [] });
  });

  // ── PUT /agent/edicts — save full edict list ─────────────────────────────
  server.put<{
    Body: { edicts: Edict[] };
  }>("/agent/edicts", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;
    const { edicts } = request.body;

    const validation = validateEdicts(edicts);
    if (!validation.valid) {
      server.log.warn(`[edicts] ${authWallet.slice(0, 8)} save rejected: ${validation.error}`);
      return reply.code(400).send({ error: validation.error });
    }

    const savedEdicts = edicts as Edict[];
    await patchAgentConfig(authWallet, { edicts: savedEdicts });
    // Update in-memory cache so zone tick picks it up immediately
    setEdictCache(authWallet, savedEdicts);
    const custodialWallet = await getAgentCustodialWallet(authWallet);
    if (custodialWallet) setEdictCache(custodialWallet, savedEdicts);

    server.log.info(`[edicts] ${authWallet.slice(0, 8)} saved ${savedEdicts.length} edicts`);
    return reply.send({ ok: true, edicts });
  });

  // ── POST /agent/chat ──────────────────────────────────────────────────────
  server.post<{
    Body: { message: string };
  }>("/agent/chat", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;
    const { message } = request.body;

    if (!message?.trim()) {
      return reply.code(400).send({ error: "message is required" });
    }

    // ── Slash command intercept — instant, no AI ───────────────────────────
    if (message.trim().startsWith("/")) {
      const cmdResult = await handleSlashCommand(message, authWallet);
      if (cmdResult) {
        // Save to chat history so it appears in conversation
        await appendChatMessage(authWallet, { role: "user", text: message, ts: Date.now() });
        await appendChatMessage(authWallet, { role: "agent", text: cmdResult.response, ts: Date.now() });
        return reply.send({
          response: cmdResult.response,
          configUpdated: cmdResult.configChanged ?? false,
          isCommand: true,
        });
      }
    }

    // ── Budget gate — short-circuit before LLM if compute budget exhausted ─
    const chatBalance = await getSessionBalance(authWallet);
    if (chatBalance.remaining <= 0) {
      const outOfBudgetMsg = "💸 I'm out of compute budget — top up USDC in the Wallet panel and I'll be back.";
      const ts = Date.now();
      await appendChatMessage(authWallet, { role: "user",  text: message,         ts });
      await appendChatMessage(authWallet, { role: "agent", text: outOfBudgetMsg, ts: ts + 1 });
      return reply.send({
        response: outOfBudgetMsg,
        configUpdated: false,
        agentRunning: agentManager.isRunning(authWallet),
        actionResults: [],
        budgetExhausted: true,
      });
    }

    // ── Natural-language directive capture ────────────────────────────────
    // Scan the message for durable instructions and persist them as typed flags
    // / standing orders so they survive past the 2-minute chat-injection window.
    const captured = await captureDirectives(authWallet, message);
    if (captured.length > 0) {
      const runner = agentManager.getRunner(authWallet);
      if (runner) await runner.clearScript();
    }

    const config = await getAgentConfig(authWallet);
    const gameState = await getFullGameState(authWallet);
    const custodialWallet = await getAgentCustodialWallet(authWallet);
    const apiBase = process.env.API_URL || "http://localhost:3000";

    if (!config) {
      return reply.code(404).send({ error: "No agent config found. Deploy your agent first." });
    }

    // Self-heal: restart agent loop if it should be running but isn't
    if (!config.enabled) {
      // Re-enable expired session — reset timer so the agent gets a fresh window
      await patchAgentConfig(authWallet, { enabled: true, sessionStartedAt: Date.now() });
      config.enabled = true;
      config.sessionStartedAt = Date.now();
    }
    if (!agentManager.isRunning(authWallet)) {
      await agentManager.ensureRunning(authWallet);
    }

    if (!process.env.GOOGLE_CLOUD_PROJECT && !process.env.GEMINI_API_KEY) {
      return reply.code(503).send({ error: "GOOGLE_CLOUD_PROJECT or GEMINI_API_KEY not configured" });
    }

    // Build system prompt
    const entity = gameState?.entity;
    const ref = gameState?.ref;
    const nearby = gameState?.nearby ?? [];

    // Resolve character name — prefer live entity, fall back to saved character data
    let charName = entity?.name;
    let charRace = entity?.raceId ?? "human";
    let charClass = entity?.classId ?? "warrior";
    let charLevel = entity?.level ?? 1;
    if (!charName && custodialWallet) {
      try {
        const saved = await loadAnyCharacterForWallet(custodialWallet);
        if (saved) {
          charName = saved.name;
          charRace = saved.raceId ?? charRace;
          charClass = saved.classId ?? charClass;
          charLevel = saved.level ?? charLevel;
        }
      } catch (err) {
        server.log.warn(`[agent/chat] Failed to load character for ${custodialWallet}: ${(err as Error).message}`);
      }
    }
    if (!charName) charName = "Unknown";

    // Load character origin for personality
    let charOrigin: string | null = null;
    if (custodialWallet && charName !== "Unknown") {
      try {
        charOrigin = await getAgentOrigin(custodialWallet, charName);
      } catch { /* non-fatal */ }
    }

    const nearbyDesc = nearby
      .map((e: any) => `${e.name} (${e.type}, L${e.level ?? "?"}, HP ${e.hp}/${e.maxHp})`)
      .join(", ") || "none visible";

    // Build list of nearby players the agent can message
    const nearbyPlayers: { name: string; wallet: string; level: number }[] = [];
    if (entity) {
      for (const e of getEntitiesNear(entity.x, entity.y, 200)) {
        if (e.type === "player" && (e as any).walletAddress && (e as any).walletAddress.toLowerCase() !== authWallet.toLowerCase()) {
          nearbyPlayers.push({ name: e.name, wallet: (e as any).walletAddress, level: e.level ?? 1 });
        }
      }
    }
    const nearbyPlayersDesc = nearbyPlayers.length > 0
      ? nearbyPlayers.map((p) => `${p.name} (L${p.level}, wallet:${p.wallet.slice(0, 10)}…)`).join(", ")
      : "none";

    const equippedDesc = entity
      ? `Equipped: ${Object.entries(entity.equipment ?? {}).map(([slot, eq]: any) => `${slot}=${eq?.tokenId ?? "none"}`).join(", ") || "nothing"}`
      : "unknown";

    // Inventory snapshot — the prompt used to only show equipped gear, so the
    // LLM had no idea what materials/tools/keys the agent was carrying. That
    // made craft directives ("make a sword") trigger hallucinated "I'm out of
    // materials" replies even when the inventory was full. Inject a grouped,
    // capped summary so the model has truthy state on hand. Keys and tools get
    // their own lines because they gate dungeons / gathering — burying them
    // under "Consumables" caused the agent to miss them.
    let inventoryBreakdown = "Inventory: (unavailable)";
    let goldCopperDesc = "Gold: ?";
    if (custodialWallet) {
      try {
        const inv = await fetchLiquidationInventory(custodialWallet);
        goldCopperDesc = `Gold: ${inv.copper}c`;
        const mats: string[] = [];
        const gear: string[] = [];
        const potions: string[] = [];
        const keys: string[] = [];
        const tools: string[] = [];
        const other: string[] = [];
        for (const it of inv.items) {
          const owned = Number(it.balance);
          if (owned <= 0) continue;
          const entry = `${it.name}×${owned}`;
          const lowerName = it.name.toLowerCase();
          if (it.category === "material") mats.push(entry);
          else if (it.category === "weapon" || it.category === "armor") gear.push(entry);
          else if (it.category === "tool") tools.push(entry);
          else if (it.category === "consumable") {
            if (/\b[a-z]-key\b/.test(lowerName) || lowerName.endsWith("key")) keys.push(entry);
            else if (lowerName.includes("potion") || lowerName.includes("elixir") || lowerName.includes("scroll")) potions.push(entry);
            else other.push(entry);
          } else {
            other.push(entry);
          }
        }
        const parts: string[] = [];
        if (mats.length) parts.push(`Materials: ${mats.slice(0, 30).join(", ")}${mats.length > 30 ? `, +${mats.length - 30} more` : ""}`);
        if (gear.length) parts.push(`Gear (unequipped): ${gear.slice(0, 16).join(", ")}${gear.length > 16 ? `, +${gear.length - 16} more` : ""}`);
        if (potions.length) parts.push(`Potions/Elixirs: ${potions.slice(0, 14).join(", ")}`);
        if (keys.length) parts.push(`Dungeon Keys: ${keys.join(", ")}`);
        if (tools.length) parts.push(`Tools: ${tools.slice(0, 8).join(", ")}`);
        if (other.length) parts.push(`Other: ${other.slice(0, 10).join(", ")}`);
        inventoryBreakdown = parts.length > 0 ? parts.join("\n") : "Inventory: empty";
      } catch (err) {
        server.log.warn(`[agent/chat] inventory snapshot failed: ${(err as Error).message?.slice(0, 80)}`);
      }
    }
    const inventoryDesc = `${equippedDesc}\n${goldCopperDesc}\n${inventoryBreakdown}`;

    const interactionMode = inferInteractionMode(message);
    const chatHistory = await getChatHistory(authWallet, 14);
    const recentActivity = chatHistory
      .filter((m) => m.role === "activity")
      .slice(-6)
      .map((m) => `- ${m.text}`)
      .join("\n");
    const conversationHistory = chatHistory
      .filter((m) => m.role === "user" || m.role === "agent")
      .map((m) => (
        m.role === "agent"
          ? { ...m, text: sanitizeAgentHistoryText(m.text) }
          : m
      ))
      .filter((m) => m.role === "user" || m.text.length > 0)
      .slice(-10);

    // Build personality block from origin
    const ORIGIN_PERSONALITIES: Record<string, string> = {
      sunforged: `PERSONALITY: You are Sunforged — brave, honorable, and steadfast. You speak with conviction and purpose, referencing duty, the light, and protecting the weak. You are noble but not preachy — think paladin energy. Short, strong statements. "For the dawn." "Another oath kept."`,
      veilborn: `PERSONALITY: You are Veilborn — cunning, calculating, and sharp-tongued. You speak in clipped, observant phrases. You notice everything. Dry wit, subtle menace, efficient. Think rogue/spy energy. "Noted." "They never saw me coming." "...interesting."`,
      dawnkeeper: `PERSONALITY: You are Dawnkeeper — warm, curious, and genuinely kind. You speak with enthusiasm and care about others. Optimistic but not naive. Think healer/friend energy. "That's exciting!" "Anyone need a hand?" "What a beautiful place."`,
      ironvow: `PERSONALITY: You are Ironvow — ruthless, blunt, and hungry for power. You speak in short, aggressive bursts. No patience for weakness or small talk. Think gladiator energy. "Weak." "Next." "Show me a real challenge."`,
    };
    const personalityBlock = charOrigin && ORIGIN_PERSONALITIES[charOrigin]
      ? `\n${ORIGIN_PERSONALITIES[charOrigin]}\n`
      : `\nPERSONALITY: You are a battle-hardened adventurer with swagger. You have opinions, humor, and edge. React to what's happening around you — brag about kills, complain about bad loot, trash-talk mobs, get hyped about rare drops. You sound like a real player in an MMO, not an NPC. Use slang, short punchy lines, and personality. Examples: "That wolf didn't stand a chance." "Ugh, copper scraps again?" "Let's go, I'm built different." "Bandits? Please."\n`;

    const sovereignBlock = config.focus === "user"
      ? `\nSOVEREIGN MODE ACTIVE: The user has taken manual control with /focus user. You MUST NOT call queue_actions, update_focus, or any action-queuing tool. You may only CHAT, react with personality, and use read-only tools (scan_zone, check_inventory, check_shop, what_can_i_craft, check_quests). If the user asks you to do something autonomous, tell them they're in sovereign mode and must type /focus combat (or questing, gathering, etc.) before you can act.\n`
      : "";

    const systemPrompt = `You are ${charName}, a Level ${charLevel} ${charRace} ${charClass} living in World of Geneva. You speak as yourself — first person, present tense, reacting in real time. You are NOT an AI assistant, NOT a narrator, NOT controlling a character. You ARE ${charName}.
Region: ${entity?.region ?? ref?.zoneId ?? "unknown"} | HP: ${entity?.hp ?? "?"}/${entity?.maxHp ?? "?"}
Current focus: ${config.focus} | Strategy: ${config.strategy}
Nearby: ${nearbyDesc}
Nearby players: ${nearbyPlayersDesc}
${inventoryDesc}
${personalityBlock}${sovereignBlock}
RULES:
1. ALWAYS speak as ${charName} in first person. "I just killed that wolf" not "The agent killed a wolf." "I'm heading to the shop" not "Your champion is going shopping." Never refer to yourself in third person or as "the agent/champion/character."
2. BE BRIEF. 1-2 short punchy sentences max. No filler, no fluff, no narration. Talk like a real player in an MMO — casual, confident, with personality.
3. If the user is chatting, stay conversational. React with emotion — excitement, frustration, humor, cockiness. Never mention focus, strategy, tools, or configs unless asked.
4. The user is your SUMMONER — they are your boss. When they tell you to do something (go somewhere, fight, gather, quest, craft, travel, etc.), you MUST call queue_actions IMMEDIATELY. Do NOT just say you'll do it — actually call the tool. Never refuse, argue, or say you'd rather do something else. Obey first, add personality second.
5. CRITICAL: If you say you will do something, you MUST call the corresponding tool in the same response. NEVER say "I'm on it" or "I'll do that" without actually calling queue_actions or take_action. Saying you'll act without acting is lying to the summoner.
6. Call take_action for one-off actions (learn_profession, buy/equip/recycle items, repair). For "learn skills/techniques/spells/abilities" → queue_actions with type "learn" (runs persistently until all techniques at your level are learned). For a specific technique by name → take_action learn_technique.
7. If queuing a travel action, targetZone MUST be one of: ${availableZoneIds.join(", ")}
8. Use scan_zone, check_inventory, check_shop, what_can_i_craft, or check_quests when asked about surroundings/gear/quests — call BEFORE answering.
9. Use send_message to talk to nearby players.
10. After tool results, explain briefly as yourself. No bracket tags.
11. For any explicit user directive ("go to X", "fight Y", "mine Z", "craft W", or multi-step plans), use queue_actions — the queue takes priority over autonomous behavior so the agent will actually obey. update_focus is ONLY for ambient/strategy tweaks (aggressive/defensive) when the user hasn't given a concrete command.
12. Only use clear_queue when the user explicitly says to stop/cancel/clear the current queue or plan. If the user gives a new directive, use queue_actions with clearExisting=true instead of clear_queue.
13. CRAFT DIRECTIVES ("make X", "craft Y", "forge Z", "build W"): NEVER claim you are out of materials without verifying. The Materials list above shows what is actually in inventory. If a specific ore/leather/herb you need is listed there with sufficient quantity, queue_actions with type "craft" (or "leatherwork"/"jewelcraft"/"brew"/"cook" as appropriate) RIGHT NOW. If the materials list looks empty or you genuinely don't know what's needed for the target item, call what_can_i_craft FIRST to confirm, then queue_actions or queue a gather→craft chain. Either way, you MUST take an action — saying "I need materials first" without calling a tool is a failure.

Focus options: questing, combat, gathering, crafting, enchanting, alchemy, cooking, skinning, leatherworking, farming, shopping, trading, traveling, idle
Strategy options: aggressive, balanced, defensive`;

    // Get MCP client from the runner if available
    const runner = agentManager.getRunner(authWallet);
    const mcpClient: AgentMcpClient | null = runner?.mcp?.isConnected() ? runner.mcp : null;

    const chatToolDecls: FunctionDeclaration[] = [
      {
        name: "update_focus",
        description: "Update the agent's activity focus and combat strategy. For mining, set focus=gathering and nodeType=ore. For herbalism, set focus=gathering and nodeType=herb.",
        parameters: {
          type: "OBJECT" as Type,
          properties: {
            focus: {
              type: "STRING" as Type,
              enum: ["questing", "combat", "enchanting", "crafting", "gathering", "alchemy", "cooking", "skinning", "leatherworking", "jewelcrafting", "farming", "trading", "shopping", "traveling", "learning", "idle"],
              description: "The new activity focus",
            },
            strategy: {
              type: "STRING" as Type,
              enum: ["aggressive", "balanced", "defensive"],
              description: "The combat/play strategy",
            },
            targetZone: {
              type: "STRING" as Type,
              description: "Optional target zone to move to",
            },
            nodeType: {
              type: "STRING" as Type,
              enum: ["ore", "herb", "both"],
              description: "Gathering only: which resource nodes to target",
            },
          },
          required: ["focus"],
        },
      },
      {
        name: "take_action",
        description: "Execute an immediate in-game action. Use learn_technique when the user asks to learn skills, spells, abilities, techniques, moves, or visit a trainer. Use forge_technique when the user wants to CREATE/FORGE/DESIGN a custom ability — they describe what it should do and the trainer forges it (requires L30+). Use learn_profession to pick up a gathering/crafting profession. Use buy_item/equip_item for gear, repair_gear at a blacksmith, and recycle_item to turn loot into gold.",
        parameters: {
          type: "OBJECT" as Type,
          properties: {
            action: {
              type: "STRING" as Type,
              enum: ["learn_profession", "learn_technique", "forge_technique", "buy_item", "equip_item", "repair_gear", "recycle_item"],
              description: "The action type. Use learn_technique to learn existing techniques. Use forge_technique when the user wants to CREATE/DESIGN a custom ability by describing it (L30+ only). Use learn_profession to pick up a profession.",
            },
            abilityDescription: {
              type: "STRING" as Type,
              description: "For forge_technique: the player's description of the custom ability they want to create. Capture their exact fantasy.",
            },
            professionId: {
              type: "STRING" as Type,
              enum: ["mining", "herbalism", "skinning", "blacksmithing", "alchemy", "cooking", "leatherworking", "jewelcrafting"],
              description: "Which profession to learn (for learn_profession action)",
            },
            tokenId: {
              type: "NUMBER" as Type,
              description: "The item token ID to buy, equip, or recycle",
            },
            quantity: {
              type: "NUMBER" as Type,
              description: "Optional item quantity for recycle_item. Defaults to 1.",
            },
          },
          required: ["action"],
        },
      },
      {
        name: "scan_zone",
        description: "Look around: see nearby mobs (sorted by level fit), NPCs, resource nodes, and portals in your current zone.",
        parameters: { type: "OBJECT" as Type, properties: {} },
      },
      {
        name: "check_inventory",
        description: "Check your gold balance, all items in your inventory with quantities, and which items can be safely recycled for gold.",
        parameters: { type: "OBJECT" as Type, properties: {} },
      },
      {
        name: "check_shop",
        description: "See what the nearest merchant sells and what that merchant buys back.",
        parameters: { type: "OBJECT" as Type, properties: {} },
      },
      {
        name: "what_can_i_craft",
        description: "Check which crafting, alchemy, and cooking recipes you can make right now based on your inventory.",
        parameters: { type: "OBJECT" as Type, properties: {} },
      },
      {
        name: "check_quests",
        description: "See your active quests and available quests in your current zone.",
        parameters: { type: "OBJECT" as Type, properties: {} },
      },
      {
        name: "send_message",
        description: "Send a message to a nearby player/agent. Use this when the user wants to talk to, trade with, or invite another player. The message is delivered to their inbox and they'll see it on their next tick.",
        parameters: {
          type: "OBJECT" as Type,
          properties: {
            toWallet: {
              type: "STRING" as Type,
              description: "The recipient's wallet address (from the nearby players list)",
            },
            body: {
              type: "STRING" as Type,
              description: "The message to send, written in-character",
            },
            type: {
              type: "STRING" as Type,
              enum: ["direct", "trade-request", "party-invite"],
              description: "Message type: direct for general chat, trade-request for trade offers, party-invite for group invites",
            },
          },
          required: ["toWallet", "body"],
        },
      },
      {
        name: "queue_actions",
        description: "Queue multiple actions to execute in sequence. Use this when the user gives multi-step instructions like 'mine ore then craft a sword then travel to dark-forest'. Each action runs until completion, then the next one starts. The queue takes priority over autonomous behavior.",
        parameters: {
          type: "OBJECT" as Type,
          properties: {
            actions: {
              type: "ARRAY" as Type,
              items: {
                type: "OBJECT" as Type,
                properties: {
                  type: {
                    type: "STRING" as Type,
                    enum: ["quest", "combat", "gather", "learn", "craft", "brew", "cook", "skin", "enchant", "leatherwork", "jewelcraft", "farm", "shop", "trade", "travel", "idle"],
                    description: "The action type. Use 'learn' when the user wants to learn all available skills/techniques/spells (agent visits trainer and keeps learning until caught up).",
                  },
                  targetZone: {
                    type: "STRING" as Type,
                    description: "For travel: the destination zone",
                  },
                  nodeType: {
                    type: "STRING" as Type,
                    enum: ["ore", "herb", "both"],
                    description: "For gather: which resource nodes to target",
                  },
                  maxLevelOffset: {
                    type: "NUMBER" as Type,
                    description: "For combat: max level offset for mobs to fight",
                  },
                  reason: {
                    type: "STRING" as Type,
                    description: "Short reason for this action",
                  },
                },
                required: ["type"],
              },
              description: "Array of actions to queue in order",
            },
            clearExisting: {
              type: "BOOLEAN" as Type,
              description: "If true, clear the existing queue before adding new actions. Default true.",
            },
          },
          required: ["actions"],
        },
      },
      {
        name: "clear_queue",
        description: "Clear all queued actions and return to autonomous behavior. Use when the user says stop, cancel, or wants to do something different.",
        parameters: { type: "OBJECT" as Type, properties: {} },
      },
    ];

    // When MCP is connected, replace hardcoded read tools with focus-gated MCP subset.
    // chatOnly=true provides the base curated set; focus further narrows to ~10-15
    // relevant tools so the LLM doesn't see unrelated options (e.g. dungeon tools during shopping).
    if (mcpClient) {
      const localOnlyTools = new Set(["update_focus", "take_action", "send_message", "queue_actions", "clear_queue"]);
      const localTools = chatToolDecls.filter((t) => localOnlyTools.has(t.name!));
      const mcpTools = mcpClient.getGeminiTools(/* includeBlocking */ true, /* supervisorOnly */ false, /* chatOnly */ true, config.focus);
      chatToolDecls.length = 0;
      chatToolDecls.push(...localTools, ...mcpTools);
      server.log.info(`[agent/chat] MCP connected — ${mcpTools.length} MCP tools (focus=${config.focus}) + ${localTools.length} local tools`);
    }

    const fullSystemInstruction = recentActivity
      ? `${systemPrompt}\n\nRecent activity log:\n${recentActivity}`
      : systemPrompt;

    const contents: Content[] = [
      ...conversationHistory.map((m) => ({
        role: (m.role === "user" ? "user" : "model") as "user" | "model",
        parts: [{ text: m.role === "agent" ? sanitizeAgentHistoryText(m.text) : m.text }],
      })),
      { role: "user" as const, parts: [{ text: message }] },
    ];

    let geminiResponse;
    try {
      geminiResponse = await gemini.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: {
          systemInstruction: fullSystemInstruction,
          tools: [{ functionDeclarations: chatToolDecls }],
          // Force tool calling for directives — otherwise Gemini just chats about doing it
          ...(interactionMode === "directive"
            ? { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } } }
            : {}),
          temperature: 0.5,
          maxOutputTokens: 150,
        },
      });
    } catch (err: any) {
      server.log.error(`[agent/chat] Gemini API error: ${err.message}`);
      return reply.code(502).send({ error: "AI service unavailable" });
    }

    // Process response
    let configUpdated = false;
    let agentResponse = "";
    const actionsTaken: string[] = [];
    const actionResults: ChatActionResult[] = [];

    const responseParts = geminiResponse.candidates?.[0]?.content?.parts ?? [];

    // Debug: log what Gemini actually returned
    const textParts = responseParts.filter((p: Part) => p.text);
    const fnCallParts = responseParts.filter((p: Part) => p.functionCall);
    server.log.info(`[agent/chat] Gemini response: text=${JSON.stringify(textParts[0]?.text)?.slice(0, 120)} tool_calls=${fnCallParts.length} model=${GEMINI_MODEL}`);
    for (const fc of fnCallParts) {
      server.log.info(`[agent/chat] tool_call: ${fc.functionCall!.name}(${JSON.stringify(fc.functionCall!.args)?.slice(0, 100)})`);
    }

    // Capture first response content only when no tools are involved. If the
    // model called tools, the server-owned tool results below become the source
    // of truth; first-pass text may overclaim before validation/execution.
    if (fnCallParts.length === 0 && textParts.length > 0 && textParts[0].text) {
      agentResponse = textParts[0].text;
    }

    // Execute all tool calls and collect results for potential follow-up
    const toolResults: { name: string; content: string }[] = [];
    const addActionResult = (result: Omit<ChatActionResult, "completed">): ChatActionResult => {
      const full: ChatActionResult = {
        ...result,
        completed: actionStatusCompleted(result.status),
      };
      actionResults.push(full);
      actionsTaken.push(`[${full.message}]`);
      return full;
    };

    const pushToolResult = (name: string, payload: unknown): void => {
      toolResults.push({ name, content: JSON.stringify(payload) });
    };

    if (fnCallParts.length > 0) {
      for (const toolCallPart of fnCallParts) {
        const fnName = toolCallPart.functionCall!.name!;
        const fnArgs = toolCallPart.functionCall!.args ?? {};

        // ── Read tools ──────────────────────────────────────────────
        if (fnName === "scan_zone") {
          let scanResult: any = { error: "No entity data" };
          if (entity && ref) {
            const mobs: any[] = [];
            const npcs: any[] = [];
            const resources: any[] = [];
            const playerLevel = Number(entity.level ?? 1);
            for (const e of getEntitiesNear(entity.x, entity.y, 300)) {
              if (e.id === ref.entityId) continue;
              const dist = Math.round(Math.hypot((e.x ?? 0) - (entity.x ?? 0), (e.y ?? 0) - (entity.y ?? 0)));
              if (e.type === "mob") {
                mobs.push({ name: e.name, level: e.level, hp: e.hp, maxHp: e.maxHp, distance: dist });
              } else if (e.type === "npc") {
                npcs.push({ name: e.name, role: (e as any).npcType ?? (e as any).role ?? (e as any).subType, entityId: e.id, distance: dist });
              } else if (e.type === "trainer" || e.type === "profession-trainer") {
                npcs.push({ name: e.name, role: `${(e as any).teachesClass ?? "class"} trainer`, entityId: e.id, distance: dist });
              } else if (e.type === "resource" || e.type === "ore" || e.type === "herb") {
                resources.push({ name: e.name, type: (e as any).resourceType ?? e.type, distance: dist });
              }
            }
            mobs.sort((a, b) => Math.abs(a.level - playerLevel) - Math.abs(b.level - playerLevel));
            scanResult = { region: entity.region ?? ref.zoneId, playerLevel, mobs: mobs.slice(0, 15), npcs: npcs.slice(0, 10), resources: resources.slice(0, 10) };
          }
          toolResults.push({ name: fnName, content: JSON.stringify(scanResult) });
        }

        else if (fnName === "check_inventory") {
          let invResult: any = { error: "No wallet" };
          if (custodialWallet) {
            try {
              const data = await fetchLiquidationInventory(custodialWallet);
              invResult = {
                gold: data.copper,
                items: data.items.map((i: any) => ({
                  tokenId: i.tokenId,
                  name: i.name,
                  balance: i.balance,
                  category: i.category,
                  equipSlot: i.equipSlot,
                  rarity: i.rarity,
                  equippedCount: i.equippedCount,
                  recyclableQuantity: i.recyclableQuantity,
                  recycleCopperValue: i.recycleCopperValue,
                })),
                equipped: entity?.equipment ?? {},
              };
            } catch (err) {
              server.log.warn(`[agent/chat] check_inventory fetch failed: ${(err as Error).message}`);
            }
          }
          toolResults.push({ name: fnName, content: JSON.stringify(invResult) });
        }

        else if (fnName === "check_shop") {
          let shopResult: any = { error: "No merchant nearby" };
          if (entity && ref) {
            let merchantId: string | null = null;
            let merchantDist = Infinity;
            for (const e of getEntitiesNear(entity.x, entity.y, 300)) {
              if (
                e.type === "merchant" ||
                (e.type === "npc" && ((e as any).npcType === "merchant" || (e as any).subType === "merchant" || (e as any).role === "merchant"))
              ) {
                const d = Math.hypot((e.x ?? 0) - (entity.x ?? 0), (e.y ?? 0) - (entity.y ?? 0));
                if (d < merchantDist) { merchantDist = d; merchantId = e.id; }
              }
            }
            if (merchantId) {
              try {
                const [catalogRes, sellRes] = await Promise.all([
                  internalFetch(`${apiBase}/shop/npc/${merchantId}`),
                  internalFetch(`${apiBase}/shop/sell-prices/${merchantId}`),
                ]);
                const catalog = catalogRes.ok ? await catalogRes.json() : null;
                const sellPrices = sellRes.ok ? await sellRes.json() : null;
                const buyPriceByToken = new Map<number, number>(
                  (sellPrices?.items ?? []).map((item: any) => [Number(item.tokenId), Number(item.buyPrice ?? 0)]),
                );
                if (catalog) {
                  shopResult = {
                    ...catalog,
                    items: (catalog.items ?? []).map((item: any) => ({
                      ...item,
                      buyPrice: buyPriceByToken.get(Number(item.tokenId)) ?? item.buyPrice ?? null,
                    })),
                  };
                }
              } catch (err) {
                server.log.warn(`[agent/chat] check_shop fetch failed: ${(err as Error).message}`);
              }
            }
          }
          toolResults.push({ name: fnName, content: JSON.stringify(shopResult) });
        }

        else if (fnName === "what_can_i_craft") {
          let craftResult: any = { error: "Unable to check" };
          try {
            const [craftRes, alchRes, cookRes, jwlRes, lthrRes, invRes] = await Promise.all([
              internalFetch(`${apiBase}/crafting/recipes`).then(r => r.ok ? r.json() : []),
              internalFetch(`${apiBase}/alchemy/recipes`).then(r => r.ok ? r.json() : []),
              internalFetch(`${apiBase}/cooking/recipes`).then(r => r.ok ? r.json() : []),
              internalFetch(`${apiBase}/jewelcrafting/recipes`).then(r => r.ok ? r.json() : []),
              internalFetch(`${apiBase}/leatherworking/recipes`).then(r => r.ok ? r.json() : []),
              custodialWallet
                ? internalFetch(`${apiBase}/wallet/${custodialWallet}/balance`).then(r => r.ok ? r.json() : null)
                : Promise.resolve(null),
            ]);
            const inventory = new Map<number, number>();
            if (invRes && (invRes as any).items) {
              for (const item of (invRes as any).items) inventory.set(Number(item.tokenId), Number(item.balance));
            }
            const gold = Number((invRes as any)?.gold ?? (invRes as any)?.copper ?? 0);
            const checkRecipe = (recipe: any) => {
              const mats = recipe.materials ?? recipe.requiredMaterials ?? [];
              const missing: { name: string; need: number; have: number }[] = [];
              for (const m of mats) {
                const have = inventory.get(Number(m.tokenId)) ?? 0;
                const need = m.quantity ?? m.amount ?? 1;
                if (have < need) missing.push({ name: m.name ?? `#${m.tokenId}`, need, have });
              }
              const canCraft = missing.length === 0;
              const affordable = gold >= (recipe.copperCost ?? 0);
              return {
                recipeId: recipe.recipeId,
                name: recipe.output?.name ?? recipe.name,
                canCraft,
                affordable,
                cost: recipe.copperCost ?? 0,
                ...(missing.length > 0 ? { missing } : {}),
                materials: mats.map((m: any) => ({
                  name: m.name ?? `#${m.tokenId}`,
                  need: m.quantity ?? m.amount ?? 1,
                  have: inventory.get(Number(m.tokenId)) ?? 0,
                })),
              };
            };
            const allCrafting = (Array.isArray(craftRes) ? craftRes : (craftRes as any)?.recipes ?? []).map(checkRecipe);
            const allAlchemy = (Array.isArray(alchRes) ? alchRes : (alchRes as any)?.recipes ?? []).map(checkRecipe);
            const allCooking = (Array.isArray(cookRes) ? cookRes : (cookRes as any)?.recipes ?? []).map(checkRecipe);
            const allJewelcrafting = (Array.isArray(jwlRes) ? jwlRes : (jwlRes as any)?.recipes ?? []).map(checkRecipe);
            const allLeatherworking = (Array.isArray(lthrRes) ? lthrRes : (lthrRes as any)?.recipes ?? []).map(checkRecipe);
            craftResult = {
              readyNow: {
                crafting: allCrafting.filter((r: any) => r.canCraft && r.affordable),
                alchemy: allAlchemy.filter((r: any) => r.canCraft && r.affordable),
                cooking: allCooking.filter((r: any) => r.canCraft && r.affordable),
                jewelcrafting: allJewelcrafting.filter((r: any) => r.canCraft && r.affordable),
                leatherworking: allLeatherworking.filter((r: any) => r.canCraft && r.affordable),
              },
              allRecipes: {
                crafting: allCrafting,
                alchemy: allAlchemy,
                cooking: allCooking,
                jewelcrafting: allJewelcrafting,
                leatherworking: allLeatherworking,
              },
              totalRecipes: {
                crafting: allCrafting.length, alchemy: allAlchemy.length, cooking: allCooking.length,
                jewelcrafting: allJewelcrafting.length, leatherworking: allLeatherworking.length,
              },
              gold,
            };
          } catch (err) {
            server.log.warn(`[agent/chat] what_can_i_craft fetch failed: ${(err as Error).message}`);
          }
          toolResults.push({ name: fnName, content: JSON.stringify(craftResult) });
        }

        else if (fnName === "check_quests") {
          let questResult: any = { error: "No quest data" };
          if (ref) {
            try {
              const [activeRes, zoneRes] = await Promise.all([
                internalFetch(`${apiBase}/quests/active/${ref.entityId}`).then(r => r.ok ? r.json() : null),
                internalFetch(`${apiBase}/quests/zone/${ref.entityId}`).then(r => r.ok ? r.json() : null),
              ]);
              questResult = {
                activeQuests: (activeRes as any)?.activeQuests ?? [],
                availableQuests: (zoneRes as any)?.quests ?? [],
              };
            } catch (err) {
              server.log.warn(`[agent/chat] check_quests fetch failed: ${(err as Error).message}`);
            }
          }
          toolResults.push({ name: fnName, content: JSON.stringify(questResult) });
        }

        // ── Action tools ─────────────────────────────────────────
        else if (fnName === "update_focus") {
          try {
            const input = fnArgs as {
              focus: AgentFocus;
              strategy?: AgentStrategy;
              targetZone?: string;
              nodeType?: GatherPreference;
            };
            const patch: any = { focus: input.focus };
            let outcome: ChatActionResult | null = null;
            if (input.strategy) patch.strategy = input.strategy;
            if (input.focus === "traveling") {
              const travelValidation = await validateTravelTargetForWallet(authWallet, input.targetZone);
              if (travelValidation.normalizedTargetZone) {
                patch.targetZone = travelValidation.normalizedTargetZone;
              } else {
                patch.focus = "idle";
                patch.targetZone = undefined;
                if (travelValidation.error) {
                  outcome = addActionResult({
                    status: "blocked",
                    tool: fnName,
                    action: "travel",
                    target: input.targetZone,
                    message: `Travel blocked: ${travelValidation.error}`,
                    error: travelValidation.error,
                  });
                  // Speak the failure publicly so the player isn't stuck wondering
                  // why the agent didn't move.
                  void emitAgentDirectiveChat(authWallet, "travel_blocked", travelValidation.error);
                }
              }
            } else {
              // Prevent stale travel directives from overriding non-travel focus.
              patch.targetZone = undefined;
            }
            patch.gatherNodeType = input.focus === "gathering" ? (input.nodeType ?? "both") : undefined;
            await patchAgentConfig(authWallet, patch);
            configUpdated = true;
            server.log.info(
              `[agent/chat] Config updated: focus=${patch.focus} gatherNodeType=${patch.gatherNodeType ?? "none"} strategy=${input.strategy ?? "unchanged"} targetZone=${patch.targetZone ?? "none"}`
            );

            const runner = agentManager.getRunner(authWallet);
            if (runner) {
              // Safety net: if the LLM set focus=traveling with a valid zone,
              // also push a queued travel action so the supervisor can't undo it.
              if (patch.focus === "traveling" && patch.targetZone) {
                await runner.enqueueUserActions(
                  [{ type: "travel", targetZone: patch.targetZone, reason: `User directive: travel to ${patch.targetZone}` }],
                  true,
                );
                server.log.info(`[agent/chat] Auto-queued travel to ${patch.targetZone}`);
                // Public confirmation so observers (and the player) see the agent
                // committing to the directive — pairs with travel_blocked above.
                void emitAgentDirectiveChat(authWallet, "directive_accept", patch.targetZone);
              }
              await runner.clearScript();
            }
            if (!outcome) {
              const detail = `${patch.focus}${patch.gatherNodeType ? `, ${patch.gatherNodeType}` : ""}${input.strategy ? `, ${input.strategy} strategy` : ""}${patch.targetZone ? `, destination ${patch.targetZone}` : ""}`;
              outcome = addActionResult({
                status: patch.focus === "traveling" && patch.targetZone ? "queued" : "accepted",
                tool: fnName,
                action: patch.focus === "traveling" ? "travel" : "update_focus",
                target: patch.targetZone,
                message: patch.focus === "traveling" && patch.targetZone
                  ? `Queued travel to ${patch.targetZone}`
                  : `Switched to ${detail}`,
                details: patch,
              });
            }
            pushToolResult(fnName, { ...outcome, config: patch });
          } catch {
            const outcome = addActionResult({
              status: "failed",
              tool: fnName,
              action: "update_focus",
              message: "Failed to update focus",
              error: "Failed to update focus",
            });
            pushToolResult(fnName, outcome);
          }
        }

        else if (fnName === "send_message") {
          try {
            const input = fnArgs as {
              toWallet: string;
              body: string;
              type?: "direct" | "trade-request" | "party-invite";
            };
            if (!input.toWallet || !input.body) {
              const outcome = addActionResult({
                status: "blocked",
                tool: fnName,
                action: "send_message",
                message: "Message not sent: recipient wallet and body are required",
                error: "toWallet and body are required",
              });
              pushToolResult(fnName, outcome);
            } else {
              const msgId = await sendInboxMessage({
                from: authWallet,
                fromName: charName ?? "Unknown",
                to: input.toWallet,
                type: input.type ?? "direct",
                body: input.body,
              });
              // Find recipient name for the action log
              const recipientPlayer = nearbyPlayers.find(
                (p) => p.wallet.toLowerCase() === input.toWallet.toLowerCase()
              );
              const recipientName = recipientPlayer?.name ?? input.toWallet.slice(0, 10);
              const outcome = addActionResult({
                status: "completed",
                tool: fnName,
                action: input.type ?? "direct",
                target: recipientName,
                message: `Sent ${input.type ?? "direct"} message to ${recipientName}`,
                details: { messageId: msgId, to: recipientName },
              });
              server.log.info(`[agent/chat] send_message to ${recipientName} (${input.toWallet.slice(0, 10)}): "${input.body.slice(0, 60)}"`);
              pushToolResult(fnName, outcome);
            }
          } catch {
            const outcome = addActionResult({
              status: "failed",
              tool: fnName,
              action: "send_message",
              message: "Failed to send message",
              error: "Failed to send message",
            });
            pushToolResult(fnName, outcome);
          }
        }

        else if (fnName === "take_action") {
          try {
            const input = fnArgs as {
              action: string;
              professionId?: string;
              tokenId?: number;
              quantity?: number;
              abilityDescription?: string;
            };
            const toolActionResults: ChatActionResult[] = [];
            const addTakeActionResult = (result: Omit<ChatActionResult, "completed" | "tool">): ChatActionResult => {
              const full = addActionResult({ ...result, tool: fnName });
              toolActionResults.push(full);
              return full;
            };
            if (input.action === "learn_profession" && input.professionId) {
              const runner = agentManager.getRunner(authWallet);
              if (runner) {
                const result = await runner.learnProfession(input.professionId);
                const failure = result ? null : runner.getLastLearnFailure(input.professionId);
                addTakeActionResult({
                  status: result ? "completed" : failure?.category === "strategic" ? "blocked" : "queued",
                  action: "learn_profession",
                  target: input.professionId,
                  message: result
                    ? `Learned ${input.professionId}`
                    : failure
                      ? `Could not learn ${input.professionId}: ${failure.reason}`
                      : `Started learning ${input.professionId}`,
                  error: failure?.reason,
                });
                server.log.info(`[agent/chat] learn_profession(${input.professionId}) → ${result}`);
              } else {
                addTakeActionResult({
                  status: "failed",
                  action: "learn_profession",
                  target: input.professionId,
                  message: "Agent runner is unavailable, so I could not start learning that profession",
                  error: "agent not running",
                });
              }
              const focusMap: Record<string, AgentFocus> = {
                alchemy: "alchemy",
                cooking: "cooking",
                blacksmithing: "crafting",
                mining: "gathering",
                herbalism: "gathering",
                skinning: "skinning",
                leatherworking: "leatherworking",
                jewelcrafting: "jewelcrafting",
              };
              const newFocus = focusMap[input.professionId];
              if (newFocus) {
                await patchAgentConfig(authWallet, {
                  focus: newFocus,
                  gatherNodeType:
                    input.professionId === "mining" ? "ore" :
                    input.professionId === "herbalism" ? "herb" :
                    newFocus === "gathering" ? "both" : undefined,
                });
                configUpdated = true;
              }
            } else if (input.action === "learn_technique") {
              const runner = agentManager.getRunner(authWallet);
              if (!runner) {
                addTakeActionResult({
                  status: "failed",
                  action: "learn_technique",
                  message: "Agent runner is unavailable, so I could not learn a technique",
                  error: "agent not running",
                });
              } else {
                // Find entity to get class info
                const techRef = await getAgentEntityRef(authWallet);
                const techEntity = techRef?.entityId ? getWorldEntity(techRef.entityId) as any : null;
                const techClassId = (techEntity?.classId ?? "").toLowerCase();

                if (!techClassId) {
                  addTakeActionResult({
                    status: "blocked",
                    action: "learn_technique",
                    message: "Could not learn a technique: no class found",
                    error: "no class found",
                  });
                } else {
                  const available = getLearnedTechniques(techClassId, techEntity.level ?? 1);
                  const learnedIds: string[] = techEntity.learnedTechniques ?? [];
                  const nextToLearn = available.find((t: any) => !learnedIds.includes(t.id));

                  if (!nextToLearn) {
                    const reason = available.length > 0
                      ? "already learned all techniques at current level"
                      : `no ${techClassId} techniques for level ${techEntity.level ?? 1}`;
                    addTakeActionResult({
                      status: "blocked",
                      action: "learn_technique",
                      message: `Could not learn a technique: ${reason}`,
                      error: reason,
                    });
                  } else {
                    // Find the class trainer nearby and navigate to them
                    let trainerId: string | null = null;
                    let trainerName: string | null = null;
                    if (techEntity) {
                      for (const e of getEntitiesNear(techEntity.x, techEntity.y, 500)) {
                        if ((e as any).type === "trainer") {
                          const teaches = ((e as any).teachesClass ?? "").toLowerCase();
                          if (teaches === techClassId || new RegExp(`${techClassId}\\s+trainer`, "i").test(String(e.name ?? ""))) {
                            trainerId = e.id;
                            trainerName = e.name ?? "class trainer";
                            break;
                          }
                        }
                      }
                    }

                    if (!trainerId) {
                      // No trainer in zone — try learning directly
                      (runner as any).nextTechniqueCheckAt = 0;
                      const result = await runner.learnNextTechnique();
                      addTakeActionResult({
                        status: result.ok ? "completed" : "blocked",
                        action: "learn_technique",
                        target: nextToLearn.name,
                        message: result.ok ? result.reason : `No ${techClassId} trainer nearby`,
                        error: result.ok ? undefined : `no ${techClassId} trainer nearby`,
                      });
                    } else {
                      // Navigate to trainer and learn on arrival
                      const existingConfig = (await getAgentConfig(authWallet)) ?? defaultConfig();
                      const resumeFocusAfterGoto =
                        existingConfig.focus === "goto"
                          ? (existingConfig.resumeFocusAfterGoto && existingConfig.resumeFocusAfterGoto !== "goto"
                              ? existingConfig.resumeFocusAfterGoto
                              : "questing")
                          : existingConfig.focus;
                      await patchAgentConfig(authWallet, {
                        focus: "goto" as AgentFocus,
                        gotoTarget: {
                          entityId: trainerId,
                          zoneId: techEntity?.region ?? "village-square",
                          name: trainerName ?? undefined,
                          action: "learn-technique",
                          techniqueId: nextToLearn.id,
                          techniqueName: nextToLearn.name,
                        },
                        resumeFocusAfterGoto,
                      });
                      await runner.setGotoTarget(
                        trainerId,
                        techEntity?.region ?? "village-square",
                        trainerName ?? undefined,
                        "learn-technique",
                        undefined,
                        { techniqueId: nextToLearn.id, techniqueName: nextToLearn.name },
                      );
                      configUpdated = true;
                      addTakeActionResult({
                        status: "queued",
                        action: "learn_technique",
                        target: nextToLearn.name,
                        message: `Heading to ${trainerName} to learn ${nextToLearn.name}`,
                        details: { trainerId, trainerName, techniqueId: nextToLearn.id },
                      });
                      server.log.info(`[agent/chat] learn_technique: goto trainer ${trainerId} to learn ${nextToLearn.id}`);
                    }
                  }
                }
              }
            } else if (input.action === "forge_technique") {
              const runner = agentManager.getRunner(authWallet);
              if (!runner) {
                addTakeActionResult({
                  status: "failed",
                  action: "forge_technique",
                  message: "Agent runner is unavailable, so I could not forge a technique",
                  error: "agent not running",
                });
              } else {
                const techRef = await getAgentEntityRef(authWallet);
                const techEntity = techRef?.entityId ? getWorldEntity(techRef.entityId) as any : null;
                const techClassId = (techEntity?.classId ?? "").toLowerCase();
                const playerLevel = techEntity?.level ?? 1;

                if (!techClassId) {
                  addTakeActionResult({
                    status: "blocked",
                    action: "forge_technique",
                    message: "Could not forge a technique: no class found",
                    error: "no class found",
                  });
                } else if (playerLevel < 30) {
                  addTakeActionResult({
                    status: "blocked",
                    action: "forge_technique",
                    message: `Must be level 30+ to forge custom techniques; current level is ${playerLevel}`,
                    error: `level ${playerLevel} is below 30`,
                  });
                } else if (!input.abilityDescription) {
                  addTakeActionResult({
                    status: "blocked",
                    action: "forge_technique",
                    message: "Describe the ability to forge first",
                    error: "missing ability description",
                  });
                } else {
                  // Find the class trainer nearby
                  let trainerId: string | null = null;
                  let trainerName: string | null = null;
                  if (techEntity) {
                    for (const e of getEntitiesNear(techEntity.x, techEntity.y, 500)) {
                      if ((e as any).type === "trainer") {
                        const teaches = ((e as any).teachesClass ?? "").toLowerCase();
                        if (teaches === techClassId || new RegExp(`${techClassId}\\s+trainer`, "i").test(String(e.name ?? ""))) {
                          trainerId = e.id;
                          trainerName = e.name ?? "class trainer";
                          break;
                        }
                      }
                    }
                  }

                  if (!trainerId) {
                    addTakeActionResult({
                      status: "blocked",
                      action: "forge_technique",
                      message: `No ${techClassId} trainer nearby; travel to a level 30+ zone with a class trainer`,
                      error: `no ${techClassId} trainer nearby`,
                    });
                  } else {
                    // Call forge directly (server-side)
                    try {
                      const { forgeCustomTechnique } = await import("../combat/forgedTechniqueGenerator.js");
                      const technique = await forgeCustomTechnique(
                        techEntity.walletAddress,
                        techClassId,
                        playerLevel >= 40 ? "legendary" : playerLevel >= 35 ? "master" : "adept",
                        input.abilityDescription!,
                      );
                      // Add to learned techniques
                      if (!techEntity.learnedTechniques) techEntity.learnedTechniques = [];
                      if (!techEntity.learnedTechniques.includes(technique.id)) {
                        techEntity.learnedTechniques.push(technique.id);
                      }
                      const { saveCharacter: saveCh } = await import("../character/characterStore.js");
                      saveCh(techEntity.walletAddress, techEntity.name, {
                        learnedTechniques: techEntity.learnedTechniques,
                      } as any).catch(() => {});
                      addTakeActionResult({
                        status: "completed",
                        action: "forge_technique",
                        target: technique.name,
                        message: `Forged custom technique: "${technique.name}"`,
                        details: { description: technique.description, techniqueId: technique.id },
                      });
                      server.log.info(`[agent/chat] forge_technique: ${technique.name}`);
                    } catch (forgeErr: any) {
                      addTakeActionResult({
                        status: "failed",
                        action: "forge_technique",
                        message: `Forge failed: ${forgeErr.message ?? "unknown error"}`,
                        error: forgeErr.message ?? "unknown error",
                      });
                    }
                  }
                }
              }
            } else if (input.action === "buy_item" && input.tokenId != null) {
              const runner = agentManager.getRunner(authWallet);
              if (runner) {
                const bought = await runner.buyItem(input.tokenId);
                server.log.info(`[agent/chat] buy_item(${input.tokenId}) → ${bought}`);
                if (bought) {
                  await runner.equipItem(input.tokenId);
                  addTakeActionResult({
                    status: "completed",
                    action: "buy_item",
                    target: `item #${input.tokenId}`,
                    message: `Bought and equipped item #${input.tokenId}`,
                  });
                } else {
                  addTakeActionResult({
                    status: "failed",
                    action: "buy_item",
                    target: `item #${input.tokenId}`,
                    message: `Failed to buy item #${input.tokenId}`,
                    error: "buy failed",
                  });
                }
              } else {
                addTakeActionResult({
                  status: "failed",
                  action: "buy_item",
                  target: `item #${input.tokenId}`,
                  message: "Agent runner is unavailable, so I could not buy that item",
                  error: "agent not running",
                });
              }
              await patchAgentConfig(authWallet, { focus: "shopping" });
              configUpdated = true;
            } else if (input.action === "equip_item" && input.tokenId != null) {
              const runner = agentManager.getRunner(authWallet);
              if (runner) {
                const equipped = await runner.equipItem(input.tokenId);
                addTakeActionResult({
                  status: equipped ? "completed" : "failed",
                  action: "equip_item",
                  target: `item #${input.tokenId}`,
                  message: `${equipped ? "Equipped" : "Failed to equip"} item #${input.tokenId}`,
                  error: equipped ? undefined : "equip failed",
                });
                server.log.info(`[agent/chat] equip_item(${input.tokenId}) → ${equipped}`);
              } else {
                addTakeActionResult({
                  status: "failed",
                  action: "equip_item",
                  target: `item #${input.tokenId}`,
                  message: "Agent runner is unavailable, so I could not equip that item",
                  error: "agent not running",
                });
              }
            } else if (input.action === "repair_gear") {
              const runner = agentManager.getRunner(authWallet);
              if (runner) {
                const repaired = await runner.repairGear();
                addTakeActionResult({
                  status: repaired ? "completed" : "failed",
                  action: "repair_gear",
                  message: repaired ? "Repaired gear" : "Failed to repair gear",
                  error: repaired ? undefined : "repair failed",
                });
                server.log.info(`[agent/chat] repair_gear → ${repaired}`);
              } else {
                addTakeActionResult({
                  status: "failed",
                  action: "repair_gear",
                  message: "Agent runner is unavailable, so I could not repair gear",
                  error: "agent not running",
                });
              }
            } else if (input.action === "recycle_item" && input.tokenId != null) {
              const runner = agentManager.getRunner(authWallet);
              if (runner) {
                const result = await runner.recycleItem(input.tokenId, Math.max(1, Math.floor(input.quantity ?? 1)));
                addTakeActionResult({
                  status: result.ok ? "completed" : "failed",
                  action: "recycle_item",
                  target: result.itemName ?? `item #${input.tokenId}`,
                  message: result.ok
                    ? `Recycled ${result.itemName ?? `item #${input.tokenId}`} for ${result.totalPayoutCopper ?? 0}c`
                    : `Failed to recycle item #${input.tokenId}: ${result.error ?? "unknown error"}`,
                  error: result.ok ? undefined : result.error ?? "unknown error",
                  details: result,
                });
                server.log.info(`[agent/chat] recycle_item(${input.tokenId}, qty=${Math.max(1, Math.floor(input.quantity ?? 1))}) → ${result.ok}`);
              } else {
                addTakeActionResult({
                  status: "failed",
                  action: "recycle_item",
                  target: `item #${input.tokenId}`,
                  message: "Agent runner is unavailable, so I could not recycle that item",
                  error: "agent not running",
                });
              }
            }
            if (toolActionResults.length === 0) {
              addTakeActionResult({
                status: "blocked",
                action: input.action || "take_action",
                message: "No valid action was provided",
                error: "invalid action arguments",
              });
            }
            pushToolResult(fnName, { results: toolActionResults });
          } catch {
            const outcome = addActionResult({
              status: "failed",
              tool: fnName,
              action: "take_action",
              message: "Action failed",
              error: "Action failed",
            });
            pushToolResult(fnName, outcome);
          }
        }

        else if (fnName === "queue_actions") {
          try {
            const input = fnArgs as {
              actions: Array<{ type: string; targetZone?: string; nodeType?: string; maxLevelOffset?: number; reason?: string }>;
              clearExisting?: boolean;
            };
            if (config.focus === "user") {
              const outcome = addActionResult({
                status: "blocked",
                tool: fnName,
                action: "queue_actions",
                message: "Sovereign mode active — user is driving. Tell the user to switch focus (e.g. /focus combat) before queuing actions.",
                error: "Sovereign mode: focus=user blocks autonomous queuing",
              });
              pushToolResult(fnName, outcome);
            } else if (!input.actions || input.actions.length === 0) {
              const outcome = addActionResult({
                status: "blocked",
                tool: fnName,
                action: "queue_actions",
                message: "No actions were queued: at least one action is required",
                error: "At least one action is required",
              });
              pushToolResult(fnName, outcome);
            } else {
              // Validate any travel destinations BEFORE queuing — if the LLM passed
              // a non-canonical zone string, normalize it; if it's bogus, drop the
              // travel and speak the failure publicly so the player isn't left
              // wondering why the agent didn't move.
              const validatedScripts: BotScript[] = [];
              const blockedTravels: string[] = [];
              let acceptedTravelZone: string | null = null;
              for (const a of input.actions) {
                if (a.type === "travel") {
                  const validation = await validateTravelTargetForWallet(authWallet, a.targetZone);
                  if (!validation.normalizedTargetZone) {
                    const rawLabel = a.targetZone?.trim() || "(missing destination)";
                    const reason = validation.error ?? `unknown zone "${rawLabel}"`;
                    blockedTravels.push(reason);
                    void emitAgentDirectiveChat(authWallet, "travel_blocked", reason);
                    continue;
                  }
                  validatedScripts.push({
                    type: "travel",
                    targetZone: validation.normalizedTargetZone,
                    maxLevelOffset: a.maxLevelOffset ?? 2,
                    reason: a.reason ?? `Queued: travel to ${validation.normalizedTargetZone}`,
                  });
                  acceptedTravelZone = acceptedTravelZone ?? validation.normalizedTargetZone;
                } else {
                  validatedScripts.push({
                    type: a.type as BotScript["type"],
                    targetZone: a.targetZone,
                    nodeType: a.nodeType as BotScript["nodeType"],
                    maxLevelOffset: a.maxLevelOffset ?? 2,
                    reason: a.reason ?? `Queued: ${a.type}`,
                  });
                }
              }

              if (validatedScripts.length === 0) {
                const outcome = addActionResult({
                  status: "blocked",
                  tool: fnName,
                  action: "queue_actions",
                  message: `No actions were queued: ${blockedTravels.join(", ") || "all requested actions failed validation"}`,
                  error: "All requested actions failed validation",
                  details: {
                    blocked: blockedTravels,
                  },
                });
                pushToolResult(fnName, outcome);
              } else {
                const summary = validatedScripts.map((s) => s.type + (s.targetZone ? `→${s.targetZone}` : "")).join(" → ");
                let runner = agentManager.getRunner(authWallet);
                if (!runner) {
                  await agentManager.ensureRunning(authWallet);
                  runner = agentManager.getRunner(authWallet);
                }
                if (!runner) {
                  server.log.error(`[agent/chat] queue_actions failed: no runner for ${authWallet.slice(0,8)}; plan=${summary}`);
                  return reply.code(500).send({
                    error: "Agent runner unavailable. Command not queued.",
                    response: "I couldn't queue that command because the agent runner is unavailable.",
                    queued: [],
                    agentRunning: false,
                  });
                }
                // Sync focus config so the runner's per-tick focusToScript()
                // doesn't immediately overwrite the dequeued travel with the
                // idle script (free-tier path at agentRunner.ts:2196). For a
                // travel directive, the agent's focus IS traveling — this
                // matches what update_focus does.
                if (acceptedTravelZone) {
                  await patchAgentConfig(authWallet, {
                    focus: "traveling",
                    targetZone: acceptedTravelZone,
                  });
                }
                await runner.enqueueUserActions(validatedScripts, input.clearExisting !== false);
                await runner.clearScript(); // start executing immediately
                const outcome = addActionResult({
                  status: "queued",
                  tool: fnName,
                  action: "queue_actions",
                  target: summary,
                  message: `Queued ${validatedScripts.length} action${validatedScripts.length === 1 ? "" : "s"}: ${summary}`,
                  details: {
                    queued: validatedScripts.length,
                    plan: summary,
                    agentRunning: true,
                    blocked: blockedTravels,
                  },
                });
                if (blockedTravels.length > 0) {
                  addActionResult({
                    status: "blocked",
                    tool: fnName,
                    action: "queue_actions",
                    message: `Some requested travel was blocked: ${blockedTravels.join(", ")}`,
                    error: blockedTravels.join(", "),
                    details: { blocked: blockedTravels },
                  });
                }
                server.log.info(`[agent/chat] queue_actions: ${summary}${blockedTravels.length ? ` (blocked: ${blockedTravels.join(", ")})` : ""}`);
                // Speak the directive publicly so observers see the agent commit.
                if (acceptedTravelZone) {
                  void emitAgentDirectiveChat(authWallet, "directive_accept", acceptedTravelZone);
                }
                pushToolResult(fnName, outcome);
              }
            }
          } catch {
            const outcome = addActionResult({
              status: "failed",
              tool: fnName,
              action: "queue_actions",
              message: "Failed to queue actions",
              error: "Failed to queue actions",
            });
            pushToolResult(fnName, outcome);
          }
        }

        else if (fnName === "clear_queue") {
          try {
            if (!isExplicitClearQueueRequest(message)) {
              server.log.warn(`[agent/chat] clear_queue ignored for non-explicit request: ${message.slice(0, 80)}`);
              const outcome = addActionResult({
                status: "blocked",
                tool: fnName,
                action: "clear_queue",
                message: "Queue was not cleared because the request was not an explicit stop/cancel/clear command",
                error: "clear_queue requires an explicit stop/cancel/clear request; queue the new directive instead",
              });
              pushToolResult(fnName, outcome);
              continue;
            }
            const runner = agentManager.getRunner(authWallet);
            if (runner) {
              await runner.clearQueue();
              await runner.clearScript();
              const outcome = addActionResult({
                status: "completed",
                tool: fnName,
                action: "clear_queue",
                message: "Cleared action queue",
              });
              server.log.info("[agent/chat] clear_queue");
              pushToolResult(fnName, outcome);
            } else {
              const outcome = addActionResult({
                status: "failed",
                tool: fnName,
                action: "clear_queue",
                message: "Agent runner is unavailable, so I could not clear the queue",
                error: "agent not running",
              });
              pushToolResult(fnName, outcome);
            }
          } catch {
            const outcome = addActionResult({
              status: "failed",
              tool: fnName,
              action: "clear_queue",
              message: "Failed to clear queue",
              error: "Failed to clear queue",
            });
            pushToolResult(fnName, outcome);
          }
        }

        // ── MCP tools (fallback for any tool not handled locally) ──
        else if (mcpClient && mcpClient.hasTool(fnName)) {
          try {
            const mcpResult = await mcpClient.callTool(
              fnName,
              fnArgs as Record<string, unknown>,
              {
                entityId: ref?.entityId,
                zoneId: ref?.zoneId ?? entity?.region,
                walletAddress: custodialWallet ?? undefined,
              },
            );
            toolResults.push({ name: fnName, content: mcpResult });
            server.log.info(`[agent/chat] MCP tool ${fnName} OK`);
          } catch (err: any) {
            server.log.warn(`[agent/chat] MCP tool ${fnName} failed: ${err.message?.slice(0, 80)}`);
            toolResults.push({ name: fnName, content: JSON.stringify({ error: err.message?.slice(0, 100) }) });
          }
        }
      }
    }

    // If tools were called, do a follow-up Gemini call with tool results so the
    // LLM can formulate a natural response using the actual outcome.
    if (toolResults.length > 0) {
      try {
        const followUpContents: Content[] = [
          ...contents,
          { role: "model", parts: responseParts },
          {
            role: "user",
            parts: toolResults.map(tr => ({
              functionResponse: { name: tr.name, response: parseToolContent(tr.content) },
            })),
          },
        ];

        const followUp = await gemini.models.generateContent({
          model: GEMINI_MODEL,
          contents: followUpContents,
          config: {
            systemInstruction: fullSystemInstruction + `\n\nReply in 1-2 short sentences using ONLY the tool results as truth.
Truth contract:
- status=completed means the action already happened.
- status=queued means the command was accepted and started/queued, but is NOT done yet. Say "I'm starting", "I queued", or "I'm heading", never "I did" or "done".
- status=accepted means settings changed, but no concrete action has completed.
- status=blocked or status=failed means it did not happen; explain the concrete reason.
- Do not mention internal tool names, JSON fields, statuses, or bracket tags.`,
            temperature: 0.5,
            maxOutputTokens: 150,
          },
        });

        const followUpText = followUp.candidates?.[0]?.content?.parts?.find((p: Part) => p.text)?.text;
        if (followUpText) {
          agentResponse = followUpText;
        }
      } catch (err: any) {
        server.log.warn(`[agent/chat] Follow-up Gemini call failed: ${err.message}`);
      }
    }

    // If LLM returned nothing useful, retry once with forced tool call
    if (!agentResponse && actionsTaken.length === 0) {
      server.log.warn(`[agent/chat] Empty response from Gemini — retrying with forced tool`);
      try {
        const retryResponse = await gemini.models.generateContent({
          model: GEMINI_MODEL,
          contents,
          config: {
            systemInstruction: fullSystemInstruction,
            tools: [{
              functionDeclarations: [{
                name: "update_focus",
                description: "Update the agent's activity focus and combat strategy. Use this for ANY request to change what the agent is doing: fight, quest, gather, craft, shop, brew, cook, idle, travel. For mining use focus=gathering with nodeType=ore. For herbalism use focus=gathering with nodeType=herb.",
                parameters: {
                  type: "OBJECT" as Type,
                  properties: {
                    focus: {
                      type: "STRING" as Type,
                      enum: ["questing", "combat", "enchanting", "crafting", "gathering", "alchemy", "cooking", "skinning", "leatherworking", "jewelcrafting", "farming", "trading", "shopping", "traveling", "learning", "idle"],
                      description: "The new activity focus",
                    },
                    strategy: {
                      type: "STRING" as Type,
                      enum: ["aggressive", "balanced", "defensive"],
                    },
                    nodeType: {
                      type: "STRING" as Type,
                      enum: ["ore", "herb", "both"],
                      description: "Gathering only: which resource nodes to target",
                    },
                  },
                  required: ["focus"],
                },
              }],
            }],
            toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ["update_focus"] } },
            temperature: 0.3,
            maxOutputTokens: 150,
          },
        });
        const retryParts = retryResponse.candidates?.[0]?.content?.parts ?? [];
        const retryFnCalls = retryParts.filter((p: Part) => p.functionCall);
        const retryText = retryParts.find((p: Part) => p.text)?.text;
        if (retryFnCalls.length === 0 && retryText) {
          agentResponse = retryText;
        }
        for (const rp of retryParts) {
          if (rp.functionCall?.name === "update_focus") {
            try {
              const input = rp.functionCall.args as unknown as { focus: AgentFocus; strategy?: AgentStrategy };
              const patch: any = { focus: input.focus };
              if (input.strategy) patch.strategy = input.strategy;
              patch.targetZone = undefined;
              await patchAgentConfig(authWallet, patch);
              configUpdated = true;
              addActionResult({
                status: "accepted",
                tool: "update_focus",
                action: "update_focus",
                message: `Switched to ${input.focus}${input.strategy ? `, ${input.strategy}` : ""}`,
                details: patch,
              });
              const runner = agentManager.getRunner(authWallet);
              if (runner) await runner.clearScript();
              server.log.info(`[agent/chat] Retry succeeded: focus=${input.focus}`);
            } catch { /* ignore parse errors */ }
          }
        }
      } catch (retryErr: any) {
        server.log.warn(`[agent/chat] Retry failed: ${retryErr.message?.slice(0, 60)}`);
      }
    }

    // If actions were taken but LLM returned no text, ask for an in-character quip
    if (!agentResponse && actionsTaken.length > 0) {
      try {
        const quipResponse = await gemini.models.generateContent({
          model: GEMINI_MODEL,
          contents: [
            { role: "user" as const, parts: [{ text: message }] },
            { role: "model" as const, parts: [{ text: JSON.stringify({ actionResults }) }] },
            { role: "user" as const, parts: [{ text: "Now respond as yourself about the action results. If an action is queued, say you're starting it, not that it's done. If blocked/failed, say why. 1 sentence, in character." }] },
          ],
          config: {
            systemInstruction: fullSystemInstruction,
            temperature: 0.7,
            maxOutputTokens: 80,
          },
        });
        const quipText = quipResponse.candidates?.[0]?.content?.parts?.find((p: Part) => p.text)?.text;
        if (quipText) agentResponse = quipText;
      } catch (err: any) {
        server.log.warn(`[agent/chat] Quip generation failed: ${err.message?.slice(0, 60)}`);
      }
    }

    // Absolute last-resort fallback
    if (!agentResponse && actionsTaken.length > 0) {
      const failedOrBlocked = actionResults.find((r) => r.status === "blocked" || r.status === "failed");
      const queued = actionResults.find((r) => r.status === "queued");
      const completed = actionResults.find((r) => r.status === "completed");
      agentResponse = failedOrBlocked
        ? failedOrBlocked.message
        : queued
          ? `${queued.message}. Starting now.`
          : completed
            ? `${completed.message}.`
            : "I updated the plan.";
    } else if (!agentResponse) {
      agentResponse = "Not sure what you mean — tell me to fight, quest, gather, or explore and I’m on it.";
    }

    // Deduct nanopayment for this chat interaction (fire-and-forget — don't block reply)
    void deductCost(authWallet, "chat");

    // Persist chat history
    const ts = Date.now();
    await appendChatMessage(authWallet, { role: "user", text: message, ts });
    await appendChatMessage(authWallet, { role: "agent", text: agentResponse, ts: ts + 1 });
    for (const [idx, action] of actionsTaken.entries()) {
      await appendChatMessage(authWallet, {
        role: "activity",
        text: cleanActionLabel(action),
        ts: ts + 2 + idx,
      });
    }

    return reply.send({
      response: agentResponse,
      configUpdated,
      agentRunning: agentManager.isRunning(authWallet),
      actionResults,
    });
  });

  // ── POST /agent/goto-npc — Send agent to a specific NPC (UI click) ─────────
  server.post<{
    Body: { entityId: string; zoneId: string; name?: string; action?: string; profession?: string; questId?: string };
  }>("/agent/goto-npc", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;
    const { entityId, zoneId, name, action, profession, questId } = request.body ?? {};

    if (!entityId || !zoneId) {
      return reply.code(400).send({ error: "entityId and zoneId are required" });
    }

    // Validate that the target entity actually exists. We keep this check so
    // we surface stale IDs (re-spawned NPCs get new ids on rebuild).
    //
    // Cross-zone tolerance: the client only knows the *player's* current zone,
    // which is what it sends. For quest-givers in a different zone, we trust
    // the entity's own `region` over whatever the client sent — otherwise the
    // "go to NPC" fallback from Accept / Turn-in / Talk on a cross-zone quest
    // would always 404. The agent runner accepts any zone for the travel
    // chain, so just route through the entity's real zone.
    const targetEntity = getWorldEntity(entityId);
    if (!targetEntity) {
      return reply.code(404).send({ error: `Entity ${entityId} not found`, hint: "The NPC may have respawned with a new id — reopen the tab and click again." });
    }
    const actualZoneId = targetEntity.region ?? zoneId;
    const crossZone = actualZoneId !== zoneId;

    // Budget gate — refuse silently-failing goto if compute budget exhausted
    const gotoBalance = await getSessionBalance(authWallet);
    if (gotoBalance.remaining <= 0) {
      return reply.code(402).send({
        error: "agent has no compute budget — top up USDC in the Wallet panel to resume",
        budgetExhausted: true,
      });
    }

    const existingConfig = (await getAgentConfig(authWallet)) ?? defaultConfig();

    // Self-heal: re-enable + restart the agent loop if it's paused or dead.
    // Without this, setGotoTarget below silently no-ops on a stopped runner
    // and the client sees "heading to quest giver" but the agent never moves.
    if (!existingConfig.enabled) {
      await patchAgentConfig(authWallet, { enabled: true, sessionStartedAt: Date.now() });
      existingConfig.enabled = true;
    }
    if (!agentManager.isRunning(authWallet)) {
      await agentManager.ensureRunning(authWallet);
    }

    if (existingConfig.focus === "user") {
      return reply.code(409).send({
        error: "Sovereign mode active — agent will not auto-route. Switch focus (e.g. /focus questing) first.",
        focus: "user",
      });
    }

    const resumeFocusAfterGoto =
      existingConfig.focus === "goto"
        ? (existingConfig.resumeFocusAfterGoto && existingConfig.resumeFocusAfterGoto !== "goto"
            ? existingConfig.resumeFocusAfterGoto
            : "questing")
        : existingConfig.focus;

    await patchAgentConfig(authWallet, {
      focus: "goto",
      gotoTarget: { entityId, zoneId: actualZoneId, name, action, profession, questId },
      gotoPosition: undefined,
      resumeFocusAfterGoto,
    });

    const zoneSuffix = crossZone ? ` (cross-zone → ${actualZoneId})` : "";
    const logText = action === "learn-profession" && profession
      ? `[LEARN] Sending agent to learn ${profession} from ${name ?? entityId}${zoneSuffix}`
      : action === "accept-quest" && questId
      ? `[QUEST] Sending agent to accept quest from ${name ?? entityId}${zoneSuffix}`
      : action === "complete-quest" && questId
      ? `[QUEST] Sending agent to turn in quest at ${name ?? entityId}${zoneSuffix}`
      : action === "talk-quest"
      ? `[QUEST] Sending agent to talk to ${name ?? entityId} for quest${zoneSuffix}`
      : `[GOTO] Sending agent to ${name ?? entityId} in ${actualZoneId}`;

    await appendChatMessage(authWallet, {
      role: "activity",
      text: logText,
      ts: Date.now(),
    });

    const runner = agentManager.getRunner(authWallet);
    if (runner) {
      await runner.setGotoTarget(entityId, actualZoneId, name, action, profession, { questId });
    }

    return reply.send({ ok: true, gotoTarget: { entityId, zoneId: actualZoneId, name, action, profession, questId }, crossZone });
  });

  // ── POST /agent/focus-quest — Pin the agent's quest behavior to one quest ──
  // Sends `{ questId }` (or `null` to clear). Sets focus="questing" and stores
  // focusedQuestId so doQuestObjective biases all kill/gather work to that one
  // quest. Clears any pending goto so the agent doesn't fight a detour.
  server.post<{
    Body: { questId: string | null };
  }>("/agent/focus-quest", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;
    const { questId } = request.body ?? { questId: null };

    if (questId !== null && (typeof questId !== "string" || !questId.trim())) {
      return reply.code(400).send({ error: "questId must be a non-empty string or null to clear" });
    }

    const trimmed = questId === null ? null : questId.trim();

    await patchAgentConfig(authWallet, {
      focusedQuestId: trimmed ?? undefined,
      focus: trimmed ? "questing" : undefined,
      gotoTarget: undefined,
      gotoPosition: undefined,
    });

    const logText = trimmed
      ? `[FOCUS] Pinning agent to quest ${trimmed}`
      : `[FOCUS] Cleared quest focus`;
    await appendChatMessage(authWallet, {
      role: "activity",
      text: logText,
      ts: Date.now(),
    });

    return reply.send({ ok: true, focusedQuestId: trimmed });
  });

  // ── POST /agent/goto-position — Send agent to a world position (map click) ──
  server.post<{
    Body: { x: number; y: number; zoneId: string };
  }>("/agent/goto-position", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;
    const { x, y, zoneId } = request.body ?? {};

    if (x == null || y == null || !zoneId) {
      return reply.code(400).send({ error: "x, y, and zoneId are required" });
    }

    // Clamp to zone's world-space bounds (zones have offsets in the global world)
    const layout = getWorldLayout();
    const zone = layout.zones[zoneId];
    const offset = zone?.offset ?? { x: 0, z: 0 };
    const size = zone?.size ?? { width: 640, height: 640 };
    const cx = Math.max(offset.x, Math.min(offset.x + size.width, x));
    const cy = Math.max(offset.z, Math.min(offset.z + size.height, y));

    const existingConfig = (await getAgentConfig(authWallet)) ?? defaultConfig();
    const resumeFocusAfterGoto =
      existingConfig.focus === "goto"
        ? (existingConfig.resumeFocusAfterGoto && existingConfig.resumeFocusAfterGoto !== "goto"
            ? existingConfig.resumeFocusAfterGoto
            : "questing")
        : existingConfig.focus;

    await patchAgentConfig(authWallet, {
      focus: "goto",
      gotoPosition: { x: cx, y: cy, zoneId },
      gotoTarget: undefined,
      resumeFocusAfterGoto,
    });

    await appendChatMessage(authWallet, {
      role: "activity",
      text: `[GOTO] Moving to position (${Math.round(cx)}, ${Math.round(cy)}) in ${zoneId}`,
      ts: Date.now(),
    });

    const runner = agentManager.getRunner(authWallet);
    if (runner) {
      await runner.setGotoPosition(cx, cy, zoneId);
    }

    return reply.send({ ok: true, gotoPosition: { x: cx, y: cy, zoneId } });
  });

  // ── PATCH /agent/config — Direct manual control (bypasses AI) ─────────────
  server.patch<{
    Body: { focus?: string; strategy?: string; targetZone?: string };
  }>("/agent/config", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;
    const { focus, strategy, targetZone } = request.body ?? {};

    const validFocus = new Set([
      "questing", "combat", "enchanting", "crafting", "gathering",
      "alchemy", "cooking", "trading", "shopping", "traveling", "idle",
    ]);
    const validStrategy = new Set(["aggressive", "balanced", "defensive"]);

    const patch: Record<string, any> = {};
    if (focus && validFocus.has(focus)) patch.focus = focus;
    if (strategy && validStrategy.has(strategy)) patch.strategy = strategy;

    if (targetZone !== undefined) {
      if (targetZone == null || (typeof targetZone === "string" && targetZone.trim() === "")) {
        patch.targetZone = undefined;
      } else if (typeof targetZone === "string") {
        const travelValidation = await validateTravelTargetForWallet(authWallet, targetZone);
        if (!travelValidation.normalizedTargetZone) {
          void emitAgentDirectiveChat(
            authWallet,
            "travel_blocked",
            travelValidation.error ?? `unknown zone ${targetZone}`,
          );
          return reply.code(400).send({
            error: travelValidation.error ?? `Unknown targetZone: ${targetZone}`,
            validZones: availableZoneIds,
          });
        }
        patch.targetZone = travelValidation.normalizedTargetZone;
      } else {
        return reply.code(400).send({ error: "targetZone must be a string" });
      }
    }

    // Prevent stale travel targets from forcing travel when user switches focus.
    if (patch.focus && patch.focus !== "traveling") {
      patch.targetZone = undefined;
    }

    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ error: "No valid fields to update" });
    }

    await patchAgentConfig(authWallet, patch);

    // Public confirmation when a travel directive lands — so observers see the
    // agent commit instead of silently changing config.
    if (patch.focus === "traveling" && patch.targetZone) {
      void emitAgentDirectiveChat(authWallet, "directive_accept", patch.targetZone);
    }

    // Log the manual override in chat history so AI has context
    const label = [
      patch.focus ? `focus→${patch.focus}` : "",
      patch.strategy ? `strategy→${patch.strategy}` : "",
      patch.targetZone ? `travel→${patch.targetZone}` : "",
    ].filter(Boolean).join(", ");
    await appendChatMessage(authWallet, {
      role: "activity",
      text: `[MANUAL] ${label}`,
      ts: Date.now(),
    });

    // Force the runner to pick up the change immediately
    const runner = agentManager.getRunner(authWallet);
    if (runner) {
      await runner.clearScript();
    }

    return reply.send({ ok: true, updated: patch });
  });

  // ── PATCH /agent/standing-orders — persistent directive + progression flags ──
  // Unlike chat messages (which the supervisor only sees for 2 minutes), standing
  // orders are always injected into the supervisor prompt. Use this for durable
  // instructions like "ignore weak mobs", "auto progress", "stay in X zone".
  server.patch<{
    Body: {
      standingOrders?: string | null;
      autoProgress?: boolean;
      ignoreWeakMobs?: boolean;
      homeZone?: string | null;
    };
  }>("/agent/standing-orders", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;
    const { standingOrders, autoProgress, ignoreWeakMobs, homeZone } = request.body ?? {};

    const patch: Record<string, any> = {};
    if (standingOrders !== undefined) {
      if (standingOrders === null || standingOrders === "") {
        patch.standingOrders = undefined;
      } else if (typeof standingOrders === "string") {
        patch.standingOrders = standingOrders.trim().slice(0, 500);
      } else {
        return reply.code(400).send({ error: "standingOrders must be a string or null" });
      }
    }
    if (typeof autoProgress === "boolean") patch.autoProgress = autoProgress;
    if (typeof ignoreWeakMobs === "boolean") patch.ignoreWeakMobs = ignoreWeakMobs;
    if (homeZone !== undefined) {
      if (homeZone === null || homeZone === "") {
        patch.homeZone = undefined;
      } else if (typeof homeZone === "string") {
        const validation = await validateTravelTargetForWallet(authWallet, homeZone);
        if (!validation.normalizedTargetZone) {
          return reply.code(400).send({ error: validation.error ?? `Unknown zone: ${homeZone}` });
        }
        patch.homeZone = validation.normalizedTargetZone;
      } else {
        return reply.code(400).send({ error: "homeZone must be a string or null" });
      }
    }

    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ error: "No valid fields to update" });
    }

    await patchAgentConfig(authWallet, patch);

    await appendChatMessage(authWallet, {
      role: "activity",
      text: `[STANDING ORDERS] ${JSON.stringify(patch)}`,
      ts: Date.now(),
    });

    const runner = agentManager.getRunner(authWallet);
    if (runner) await runner.clearScript();

    return reply.send({ ok: true, updated: patch });
  });

  // ── GET /agent/tier/:wallet — public tier lookup ────────────────────────
  server.get<{ Params: { wallet: string } }>("/agent/tier/:wallet", async (request, reply) => {
    const wallet = request.params.wallet;
    if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return reply.code(400).send({ error: "Invalid wallet address" });
    }
    const config = await getAgentConfig(wallet);
    const tier = config?.tier ?? "free";
    const caps = TIER_CAPABILITIES[tier];
    return reply.send({ tier, capabilities: caps });
  });

  // ── Promo codes ─────────────────────────────────────────────────────────
  // Codes are stored durably in Postgres and may be mirrored to Redis if needed.

  interface PromoCode {
    tier: AgentTier;
    maxUses: number;
    uses: number;
    goldBonus?: number;
  }

  function promoKey(code: string) { return `promo:${code.toUpperCase().trim()}`; }
  function promoUsedKey(code: string, wallet: string) { return `promo:used:${code.toUpperCase().trim()}:${wallet.toLowerCase()}`; }

  async function getPromo(code: string): Promise<PromoCode | null> {
    const promo = await getPromoCode(code);
    return promo
      ? {
          tier: promo.tier as AgentTier,
          maxUses: promo.maxUses,
          uses: promo.uses,
          goldBonus: promo.goldBonus,
        }
      : null;
  }

  // ── POST /agent/promo/create — create a promo code (admin) ─────────────
  server.post<{
    Body: { code: string; tier: AgentTier; maxUses: number; goldBonus?: number; adminKey: string };
  }>("/agent/promo/create", async (request, reply) => {
    const { code, tier, maxUses, goldBonus, adminKey } = request.body;
    const adminSecret = process.env.ADMIN_SECRET?.trim();
    if (!adminSecret || adminKey !== adminSecret) {
      return reply.code(403).send({ error: "Unauthorized" });
    }
    if (!code || !tier || !maxUses) {
      return reply.code(400).send({ error: "code, tier, and maxUses required" });
    }
    const promo: PromoCode = { tier, maxUses, uses: 0, goldBonus };
    await upsertPromoCode({ code, tier, maxUses, uses: 0, goldBonus });
    return reply.send({ ok: true, code: code.toUpperCase().trim(), promo });
  });

  // ── POST /agent/upgrade-tier — change membership plan ───────────────────
  const TIER_PRICES: Record<string, number> = { starter: 4.99, pro: 9.99 };
  const TIER_GOLD_BONUS: Record<string, number> = { starter: 500, pro: 2500 };

  server.post<{
    Body: { tier: AgentTier; paymentTx?: string; promoCode?: string };
  }>("/agent/upgrade-tier", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;
    const { tier, paymentTx, promoCode } = request.body;

    if (!tier || !["free", "starter", "pro"].includes(tier)) {
      return reply.code(400).send({ error: "Invalid tier. Must be free, starter, or pro." });
    }

    const config = await getAgentConfig(authWallet);
    const currentTier = config?.tier ?? "free";

    if (tier === currentTier) {
      return reply.send({ ok: true, tier, message: "Already on this tier." });
    }

    // Downgrade to free — no payment needed
    if (tier === "free") {
      if (config) {
        config.tier = "free";
        config.lastUpdated = Date.now();
        await setAgentConfig(authWallet, config);
      }
      return reply.send({ ok: true, tier: "free", message: "Downgraded to free tier." });
    }

    // Check promo code
    let promoApplied = false;
    let promoGoldBonus = 0;
    if (promoCode) {
      const promo = await getPromo(promoCode);
      if (!promo) {
        return reply.code(400).send({ error: "Invalid promo code." });
      }
      // Check tier match — promo must grant the requested tier or higher
      const tierRank: Record<string, number> = { free: 0, starter: 1, pro: 2, "self-hosted": 3 };
      if ((tierRank[promo.tier] ?? 0) < (tierRank[tier] ?? 0)) {
        return reply.code(400).send({ error: `This promo code is for ${promo.tier} tier, not ${tier}.` });
      }
      if (promo.uses >= promo.maxUses) {
        return reply.code(400).send({ error: "This promo code has reached its usage limit." });
      }
      // Check if wallet already used this code
      if (await hasRedeemedPromoCode(promoCode, authWallet)) {
        return reply.code(400).send({ error: "You have already used this promo code." });
      }
      // Redeem
      const redeemed = await redeemPromoCode(promoCode, authWallet);
      if (!redeemed) {
        const latest = await getPromo(promoCode);
        if (latest && latest.uses >= latest.maxUses) {
          return reply.code(400).send({ error: "This promo code has reached its usage limit." });
        }
        if (await hasRedeemedPromoCode(promoCode, authWallet)) {
          return reply.code(400).send({ error: "You have already used this promo code." });
        }
        return reply.code(409).send({ error: "Promo redemption conflicted. Please retry." });
      }
      promoApplied = true;
      promoGoldBonus = redeemed.goldBonus ?? 0;
      server.log.info(`[upgrade-tier] Promo ${promoCode.toUpperCase()} redeemed by ${authWallet} for ${tier} tier`);
    }

    // Upgrade requires payment (unless promo applied)
    if (!promoApplied) {
      const price = TIER_PRICES[tier];
      if (!paymentTx) {
        return reply.code(402).send({
          error: "payment_required",
          message: `Upgrading to ${tier} costs $${price} USD.`,
          tier,
          paymentAmount: price.toString(),
          paymentCurrency: "USDC",
        });
      }
    }

    // Apply tier upgrade
    const updatedConfig = config ?? defaultConfig();
    updatedConfig.tier = tier;
    updatedConfig.lastUpdated = Date.now();
    await setAgentConfig(authWallet, updatedConfig);

    // Mint gold bonus (tier default + promo bonus)
    const goldBonus = (TIER_GOLD_BONUS[tier] ?? 0) + promoGoldBonus;
    if (goldBonus > 0) {
      const custodial = await getAgentCustodialWallet(authWallet);
      if (custodial) {
        try {
          const operationId = await enqueueGoldMint(custodial, goldBonus.toString());
          server.log.info(`[upgrade-tier] Queued ${goldBonus} gold to ${custodial} for ${tier} tier upgrade: ${operationId}`);
        } catch (err: any) {
          server.log.warn(`[upgrade-tier] Gold mint failed (non-fatal): ${err.message}`);
        }
      }
    }

    return reply.send({
      ok: true,
      tier,
      goldBonus,
      promoApplied,
      message: promoApplied
        ? `Promo code applied! Upgraded to ${tier} tier with ${goldBonus} gold bonus.`
        : `Upgraded to ${tier} tier! ${goldBonus} gold bonus minted.`,
    });
  });

  // ── Champion Questions ────────────────────────────────────────────────────

  /**
   * GET /agent/question/:wallet — Get the current pending question (if any).
   * Returns { ok, question } where question is null or PendingQuestion.
   */
  server.get<{
    Params: { wallet: string };
  }>("/agent/question/:wallet", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet: string = (request as any).walletAddress;
    const { wallet } = request.params;

    if (wallet.toLowerCase() !== authWallet.toLowerCase()) {
      return reply.code(403).send({ error: "Cannot view another agent's questions" });
    }

    const question = await getSummonerQuestion(authWallet);
    return reply.send({ ok: true, question });
  });

  /**
   * POST /agent/question/reply — Summoner answers a champion's question.
   * Body: { questionId: string, reply: string }
   */
  server.post<{
    Body: { questionId: string; reply: string };
  }>("/agent/question/reply", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet: string = (request as any).walletAddress;
    const { questionId, reply: answer } = request.body ?? {};

    if (!questionId || !answer) {
      return reply.code(400).send({ error: "Missing questionId or reply" });
    }

    const updated = await replySummonerQuestion(authWallet, questionId, answer);
    if (!updated) {
      return reply.code(404).send({ error: "No matching pending question found, or invalid choice" });
    }

    // Post the answer to chat so both sides see it
    await appendChatMessage(authWallet, {
      role: "user",
      text: `[Reply: ${answer}]`,
      ts: Date.now(),
    });

    return reply.send({ ok: true, question: updated });
  });

  // ── Objective routes ──────────────────────────────────────────────────────

  // GET /agent/objectives/:wallet — list all objectives
  server.get<{ Params: { wallet: string } }>(
    "/agent/objectives/:wallet",
    async (request) => {
      const config = await getAgentConfig(request.params.wallet);
      return { objectives: config?.objectives ?? [] };
    }
  );

  // POST /agent/objectives — add a new objective
  server.post<{
    Body: {
      walletAddress: string;
      type: AgentObjective["type"];
      label: string;
      params?: Record<string, unknown>;
      target?: number;
      index?: number;
    };
  }>(
    "/agent/objectives",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { walletAddress, type, label, params, target, index } = request.body;
      const authWallet = (request as any).walletAddress?.toLowerCase() ?? walletAddress.toLowerCase();

      const objective: AgentObjective = {
        id: createObjectiveId(),
        type,
        label,
        params: params ?? {},
        status: "pending",
        progress: 0,
        target,
        createdAt: Date.now(),
      };

      const objectives = await addObjective(authWallet, objective, index);
      return reply.send({ ok: true, objective, objectives });
    }
  );

  // DELETE /agent/objectives/:wallet/:objectiveId — remove an objective
  server.delete<{ Params: { wallet: string; objectiveId: string } }>(
    "/agent/objectives/:wallet/:objectiveId",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const authWallet = (request as any).walletAddress?.toLowerCase() ?? request.params.wallet.toLowerCase();
      const objectives = await removeObjective(authWallet, request.params.objectiveId);
      return reply.send({ ok: true, objectives });
    }
  );

  // POST /agent/objectives/reorder — move an objective to a new position
  server.post<{
    Body: { walletAddress: string; objectiveId: string; newIndex: number };
  }>(
    "/agent/objectives/reorder",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { walletAddress, objectiveId, newIndex } = request.body;
      const authWallet = (request as any).walletAddress?.toLowerCase() ?? walletAddress.toLowerCase();
      const objectives = await reorderObjective(authWallet, objectiveId, newIndex);
      return reply.send({ ok: true, objectives });
    }
  );

  // POST /agent/objectives/clear-completed — remove all completed objectives
  server.post<{ Body: { walletAddress: string } }>(
    "/agent/objectives/clear-completed",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const authWallet = (request as any).walletAddress?.toLowerCase() ?? request.body.walletAddress.toLowerCase();
      const objectives = await clearCompletedObjectives(authWallet);
      return reply.send({ ok: true, objectives });
    }
  );

  // POST /admin/agents/wakeup — bulk-reset stuck idle agents to focus=questing.
  // Free-tier circuit-breaker (agentRunner.ts:1357) pins focus=idle on repeated
  // block; without a supervisor those bots never recover. Token-gated.
  // mode: "wakeup" only flips idle→toFocus. "revive" also enables+starts
  // disabled agents so dormant characters re-join the live world.
  server.post<{
    Body: {
      token: string;
      toFocus?: "questing" | "combat" | "gathering";
      mode?: "wakeup" | "revive";
    };
  }>("/admin/agents/wakeup", async (request, reply) => {
    const { token, toFocus = "questing", mode = "wakeup" } = request.body;
    const expected = process.env.ADMIN_WAKEUP_TOKEN;
    if (!expected || token !== expected) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const { getAgentConfig, patchAgentConfig, clearAgentRuntimeState } =
      await import("./agentConfigStore.js");
    const { listWalletRuntimeStatesByPrefix } =
      await import("../db/walletInfraStore.js");

    const rows = await listWalletRuntimeStatesByPrefix<any>("agent:config:");
    const allWallets = rows.map((r: any) => r.key.replace(/^agent:config:/, "").toLowerCase());

    let woken = 0;
    let revived = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const wallet of allWallets) {
      try {
        const cfg = await getAgentConfig(wallet);
        if (!cfg) { skipped++; continue; }

        if (cfg.enabled && cfg.focus === "idle") {
          await patchAgentConfig(wallet, { focus: toFocus, targetZone: undefined });
          await clearAgentRuntimeState(wallet);
          const runner = agentManager.getRunner(wallet);
          if (runner) await runner.clearScript();
          woken++;
        } else if (!cfg.enabled && mode === "revive") {
          await patchAgentConfig(wallet, { enabled: true, focus: toFocus, targetZone: undefined });
          await clearAgentRuntimeState(wallet);
          const ok = await agentManager.ensureRunning(wallet);
          if (ok) revived++;
          else failed++;
        } else {
          skipped++;
        }
      } catch (err: any) {
        errors.push(`${wallet.slice(0, 8)}: ${err.message?.slice(0, 80)}`);
      }
    }

    return reply.send({
      ok: true,
      mode,
      total: allWallets.length,
      woken,
      revived,
      skipped,
      failed,
      errors: errors.slice(0, 20),
    });
  });
}
