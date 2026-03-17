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
  type AgentStrategy,
  type AgentObjective,
} from "./agentConfigStore.js";
import { sendAgentPush } from "./agentPushService.js";
import { setupAgentCharacter } from "./agentCharacterSetup.js";
import { type AgentTier, TIER_CAPABILITIES } from "./agentTiers.js";
import { mintGold, getGoldBalance } from "../blockchain/blockchain.js";
import { copperToGold } from "../blockchain/currency.js";
import { getRedis } from "../redis.js";
import { getEntity as getWorldEntity, getAllEntities, getEntitiesNear, getEntitiesInRegion, unregisterSpawnedWallet } from "../world/zoneRuntime.js";
import { saveCharacter, loadAnyCharacterForWallet, loadAllCharactersForWallet } from "../character/characterStore.js";
import { getLearnedProfessions } from "../professions/professions.js";
import { getLearnedTechniques } from "../combat/techniques.js";
import { getWorldLayout, resolveRegionId, getZoneConnections, ZONE_LEVEL_REQUIREMENTS } from "../world/worldLayout.js";
import { getAvailableQuestsForPlayer, isQuestNpc } from "../social/questSystem.js";
import { sendInboxMessage } from "./agentInbox.js";
import { sendPushToWallet } from "../social/webPushService.js";
import { fetchLiquidationInventory, sleep, extractRawCharacterName } from "./agentUtils.js";
import { getAgentOrigin } from "./agentDialogue.js";
import { handleSlashCommand } from "./slashCommands.js";
import type { AgentMcpClient } from "./mcpClient.js";

/** Internal fetch with 5s timeout — used for self-calls to avoid hanging forever. */
function internalFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(5_000) });
}

// Gemini client is initialized in geminiClient.ts

function inferInteractionMode(message: string): "directive" | "question" | "conversation" {
  const text = message.trim().toLowerCase();
  if (!text) return "conversation";

  const directivePatterns = [
    /\b(go to|head to|travel to|take me to|move to)\b/,
    /\b(fight|farm|grind|kill|hunt|gather|mine|herb|craft|brew|cook|shop|buy|sell|equip|repair)\b/,
    /\b(quest|idle|stop|resume|switch to|focus on|play it safe|be aggressive|be defensive)\b/,
    /\b(learn|train|talk to|message|invite|trade with)\b/,
  ];
  if (directivePatterns.some((pattern) => pattern.test(text))) return "directive";

  if (text.includes("?") || /^(what|where|why|how|who|when|can|do|are|is)\b/.test(text)) {
    return "question";
  }

  return "conversation";
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

async function getTierCapsForWallet(userWallet: string) {
  const config = await getAgentConfig(userWallet);
  const tier = config?.tier ?? "free";
  return { tier, caps: TIER_CAPABILITIES[tier] };
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
      raceId?: string;
      classId?: string;
      calling?: "adventurer" | "farmer" | "merchant" | "craftsman";
      tier?: AgentTier;
      paymentTx?: string;
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
      const result = await setupAgentCharacter(
        authWallet,
        characterName,
        raceId,
        classId,
        request.body.calling
      );

      // Mint starter gold for brand-new custodial wallets (0 balance) so the agent
      // can buy a first weapon instead of being permanently stuck unarmed.
      if (!result.alreadyExisted) {
        try {
          const existingGoldStr = await getGoldBalance(result.custodialWallet);
          const existingGold = Number(existingGoldStr ?? "0");
          if (!Number.isFinite(existingGold) || existingGold < 0.001) {
            const starterCopper = 200; // 0.02 gold — enough for the cheapest weapon
            await mintGold(result.custodialWallet, copperToGold(starterCopper).toString());
            server.log.info(`[agent/deploy] Minted ${starterCopper}c starter gold to ${result.custodialWallet}`);
          }
        } catch (err: any) {
          server.log.warn(`[agent/deploy] Starter gold mint failed (non-fatal): ${err.message}`);
        }
      }

      // Enable agent config — persist tier + session start time
      const config = (await getAgentConfig(authWallet)) ?? defaultConfig();
      config.enabled = true;
      config.lastUpdated = Date.now();
      const tier = request.body.tier ?? "free";
      config.tier = tier;
      config.sessionStartedAt = Date.now();
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
    let entity: { name: string; level: number; hp: number | null; maxHp: number | null } | null = null;
    if (ref) {
      const raw = await getEntityState(ref.entityId, ref.zoneId);
      if (raw) {
        entity = {
          name: raw.name ?? "Agent",
          level: Number(raw.level ?? 1),
          hp: raw.hp != null ? Number(raw.hp) : null,
          maxHp: raw.maxHp != null ? Number(raw.maxHp) : null,
        };
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
          };
        }
      } catch (err) {
        server.log.warn(`[agent/status] Failed to load character for ${custodial}: ${(err as Error).message}`);
      }
    }

    const runner = agentManager.getRunner(authWallet);
    const currentActivity = runner?.currentActivity ?? null;
    const script = runner?.script ?? null;
    const currentScript = script ? { type: script.type, reason: script.reason ?? null } : null;
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
      custodialWallet: custodial ?? null,
      entity,
      currentActivity,
      currentScript,
      telemetry,
    });
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
    const activeQuestDescs = (entity.activeQuests ?? [])
      .map((q: any) => `${q.questId} (progress: ${q.progress})`)
      .join(", ") || "none";
    const availableQuests: string[] = [];
    for (const zoneEntity of getEntitiesInRegion(region)) {
      if (!isQuestNpc(zoneEntity)) continue;
      const quests = getAvailableQuestsForPlayer(zoneEntity.name, completedQuestIds, activeQuestIds);
      for (const q of quests) {
        availableQuests.push(`"${q.title}" from ${zoneEntity.name}`);
      }
    }

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

Focus options: questing, combat, gathering, crafting, enchanting, alchemy, cooking, shopping, trading, traveling, learning, idle
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

      return reply.send({
        recommendations,
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

    // Clear the runner's current script so it picks up the new focus immediately
    const runner = agentManager.getRunner(authWallet);
    if (runner) runner.clearScript();

    server.log.info(`[recommend/apply] ${authWallet.slice(0, 8)} applied: ${title ?? focus} (${strategy ?? "balanced"})`);

    return reply.send({
      ok: true,
      applied: { focus, strategy: strategy ?? "balanced", targetZone: targetZone ?? null },
      message: title ? `Now doing: ${title}` : `Focus changed to ${focus}`,
    });
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

    const config = await getAgentConfig(authWallet);
    const gameState = await getFullGameState(authWallet);
    const custodialWallet = await getAgentCustodialWallet(authWallet);
    const apiBase = process.env.API_URL || "http://localhost:3000";

    if (!config) {
      return reply.code(404).send({ error: "No agent config found. Deploy your agent first." });
    }

    // Self-heal: restart agent loop if it should be running but isn't
    if (config.enabled && !agentManager.isRunning(authWallet)) {
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

    const inventoryDesc = entity
      ? `Equipped: ${Object.entries(entity.equipment ?? {}).map(([slot, eq]: any) => `${slot}=${eq?.tokenId ?? "none"}`).join(", ") || "nothing"}`
      : "unknown";

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

    const systemPrompt = `You are ${charName}, a Level ${charLevel} ${charRace} ${charClass} living in World of Geneva. You speak as yourself — first person, present tense, reacting in real time. You are NOT an AI assistant, NOT a narrator, NOT controlling a character. You ARE ${charName}.
Region: ${entity?.region ?? ref?.zoneId ?? "unknown"} | HP: ${entity?.hp ?? "?"}/${entity?.maxHp ?? "?"}
Current focus: ${config.focus} | Strategy: ${config.strategy}
Nearby: ${nearbyDesc}
Nearby players: ${nearbyPlayersDesc}
${inventoryDesc}
${personalityBlock}
RULES:
1. ALWAYS speak as ${charName} in first person. "I just killed that wolf" not "The agent killed a wolf." "I'm heading to the shop" not "Your champion is going shopping." Never refer to yourself in third person or as "the agent/champion/character."
2. BE BRIEF. 1-2 short punchy sentences max. No filler, no fluff, no narration. Talk like a real player in an MMO — casual, confident, with personality.
3. If the user is chatting, stay conversational. React with emotion — excitement, frustration, humor, cockiness. Never mention focus, strategy, tools, or configs unless asked.
4. Only call update_focus when the user clearly wants to change behavior. Casual chat is NOT a command.
5. Call take_action for one-off actions (learn profession/technique, buy/equip/recycle items, repair).
6. If focus is traveling, targetZone MUST be one of: ${availableZoneIds.join(", ")}
7. Use scan_zone, check_inventory, check_shop, what_can_i_craft, or check_quests when asked about surroundings/gear/quests — call BEFORE answering.
8. Use send_message to talk to nearby players.
9. After tool results, explain briefly as yourself. No bracket tags.

Focus options: questing, combat, gathering, crafting, enchanting, alchemy, cooking, shopping, trading, traveling, idle
Strategy options: aggressive, balanced, defensive`;

    // Get MCP client from the runner if available
    const runner = agentManager.getRunner(authWallet);
    const mcpClient: AgentMcpClient | null = runner?.mcp?.isConnected() ? runner.mcp : null;

    const chatToolDecls: FunctionDeclaration[] = [
      {
        name: "update_focus",
        description: "Update the agent's activity focus and combat strategy",
        parameters: {
          type: "OBJECT" as Type,
          properties: {
            focus: {
              type: "STRING" as Type,
              enum: ["questing", "combat", "enchanting", "crafting", "gathering", "alchemy", "cooking", "trading", "shopping", "traveling", "learning", "idle"],
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
          },
          required: ["focus"],
        },
      },
      {
        name: "take_action",
        description: "Execute an immediate in-game action. Use learn_technique when the user asks to learn skills, spells, abilities, techniques, moves, or visit a trainer. Use learn_profession to pick up a gathering/crafting profession. Use buy_item/equip_item for gear, repair_gear at a blacksmith, and recycle_item to turn loot into gold.",
        parameters: {
          type: "OBJECT" as Type,
          properties: {
            action: {
              type: "STRING" as Type,
              enum: ["learn_profession", "learn_technique", "buy_item", "equip_item", "repair_gear", "recycle_item"],
              description: "The action type. Use learn_technique when the user asks to learn skills, spells, abilities, techniques, moves, or go to a trainer.",
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
    ];

    // When MCP is connected, replace hardcoded read tools with curated MCP subset
    // Using chatOnly=true to keep tool count low (~13 MCP + 3 local = ~16 total)
    // instead of dumping all ~60 MCP tools which bloats token count and confuses the LLM
    if (mcpClient) {
      const localOnlyTools = new Set(["update_focus", "take_action", "send_message"]);
      const localTools = chatToolDecls.filter((t) => localOnlyTools.has(t.name!));
      const mcpTools = mcpClient.getGeminiTools(/* includeBlocking */ true, /* supervisorOnly */ false, /* chatOnly */ true);
      chatToolDecls.length = 0;
      chatToolDecls.push(...localTools, ...mcpTools);
      server.log.info(`[agent/chat] MCP connected — ${mcpTools.length} MCP tools + ${localTools.length} local tools (curated)`);
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

    const responseParts = geminiResponse.candidates?.[0]?.content?.parts ?? [];

    // Debug: log what Gemini actually returned
    const textParts = responseParts.filter((p: Part) => p.text);
    const fnCallParts = responseParts.filter((p: Part) => p.functionCall);
    server.log.info(`[agent/chat] Gemini response: text=${JSON.stringify(textParts[0]?.text)?.slice(0, 120)} tool_calls=${fnCallParts.length} model=${GEMINI_MODEL}`);
    for (const fc of fnCallParts) {
      server.log.info(`[agent/chat] tool_call: ${fc.functionCall!.name}(${JSON.stringify(fc.functionCall!.args)?.slice(0, 100)})`);
    }

    // Capture first response content
    if (textParts.length > 0 && textParts[0].text) {
      agentResponse = textParts[0].text;
    }

    // Execute all tool calls and collect results for potential follow-up
    const toolResults: { name: string; content: string }[] = [];
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
            const [craftRes, alchRes, cookRes, invRes] = await Promise.all([
              internalFetch(`${apiBase}/crafting/recipes`).then(r => r.ok ? r.json() : []),
              internalFetch(`${apiBase}/alchemy/recipes`).then(r => r.ok ? r.json() : []),
              internalFetch(`${apiBase}/cooking/recipes`).then(r => r.ok ? r.json() : []),
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
              const canCraft = mats.every((m: any) => (inventory.get(Number(m.tokenId)) ?? 0) >= (m.quantity ?? m.amount ?? 1));
              return { recipeId: recipe.recipeId, name: recipe.output?.name ?? recipe.name, canCraft, affordable: gold >= (recipe.copperCost ?? 0) };
            };
            const allCrafting = (Array.isArray(craftRes) ? craftRes : (craftRes as any)?.recipes ?? []).map(checkRecipe);
            const allAlchemy = (Array.isArray(alchRes) ? alchRes : (alchRes as any)?.recipes ?? []).map(checkRecipe);
            const allCooking = (Array.isArray(cookRes) ? cookRes : (cookRes as any)?.recipes ?? []).map(checkRecipe);
            craftResult = {
              craftable: allCrafting.filter((r: any) => r.canCraft && r.affordable),
              brewable: allAlchemy.filter((r: any) => r.canCraft && r.affordable),
              cookable: allCooking.filter((r: any) => r.canCraft && r.affordable),
              totalRecipes: { crafting: allCrafting.length, alchemy: allAlchemy.length, cooking: allCooking.length },
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
            };
            const patch: any = { focus: input.focus };
            if (input.strategy) patch.strategy = input.strategy;
            if (input.focus === "traveling") {
              const travelValidation = await validateTravelTargetForWallet(authWallet, input.targetZone);
              if (travelValidation.normalizedTargetZone) {
                patch.targetZone = travelValidation.normalizedTargetZone;
              } else {
                patch.focus = "idle";
                patch.targetZone = undefined;
                if (travelValidation.error) actionsTaken.push(`[${travelValidation.error}]`);
              }
            } else {
              // Prevent stale travel directives from overriding non-travel focus.
              patch.targetZone = undefined;
            }
            await patchAgentConfig(authWallet, patch);
            configUpdated = true;
            actionsTaken.push(
              `[switched to ${patch.focus}${input.strategy ? `, ${input.strategy} strategy` : ""}${patch.targetZone ? `, destination ${patch.targetZone}` : ""}]`
            );
            server.log.info(
              `[agent/chat] Config updated: focus=${patch.focus} strategy=${input.strategy ?? "unchanged"} targetZone=${patch.targetZone ?? "none"}`
            );

            const runner = agentManager.getRunner(authWallet);
            if (runner) runner.clearScript();
            toolResults.push({ name: fnName, content: JSON.stringify({ ok: true, ...patch }) });
          } catch {
            toolResults.push({ name: fnName, content: JSON.stringify({ error: "Failed to update focus" }) });
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
              toolResults.push({ name: fnName, content: JSON.stringify({ error: "toWallet and body are required" }) });
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
              actionsTaken.push(`[sent ${input.type ?? "direct"} message to ${recipientName}]`);
              server.log.info(`[agent/chat] send_message to ${recipientName} (${input.toWallet.slice(0, 10)}): "${input.body.slice(0, 60)}"`);
              toolResults.push({ name: fnName, content: JSON.stringify({ ok: true, messageId: msgId, to: recipientName }) });
            }
          } catch {
            toolResults.push({ name: fnName, content: JSON.stringify({ error: "Failed to send message" }) });
          }
        }

        else if (fnName === "take_action") {
          try {
            const input = fnArgs as {
              action: string;
              professionId?: string;
              tokenId?: number;
              quantity?: number;
            };
            if (input.action === "learn_profession" && input.professionId) {
              const runner = agentManager.getRunner(authWallet);
              if (runner) {
                const result = await runner.learnProfession(input.professionId);
                actionsTaken.push(`[${result ? "learned" : "learning"} ${input.professionId}]`);
                server.log.info(`[agent/chat] learn_profession(${input.professionId}) → ${result}`);
              }
              const focusMap: Record<string, AgentFocus> = {
                alchemy: "alchemy",
                cooking: "cooking",
                blacksmithing: "crafting",
                mining: "gathering",
                herbalism: "gathering",
                skinning: "gathering",
              };
              const newFocus = focusMap[input.professionId];
              if (newFocus) {
                await patchAgentConfig(authWallet, { focus: newFocus });
                configUpdated = true;
              }
            } else if (input.action === "learn_technique") {
              const runner = agentManager.getRunner(authWallet);
              if (!runner) {
                actionsTaken.push("[agent not running]");
              } else {
                // Find entity to get class info
                const techRef = await getAgentEntityRef(authWallet);
                const techEntity = techRef?.entityId ? getWorldEntity(techRef.entityId) as any : null;
                const techClassId = (techEntity?.classId ?? "").toLowerCase();

                if (!techClassId) {
                  actionsTaken.push("[no class found]");
                } else {
                  const available = getLearnedTechniques(techClassId, techEntity.level ?? 1);
                  const learnedIds: string[] = techEntity.learnedTechniques ?? [];
                  const nextToLearn = available.find((t: any) => !learnedIds.includes(t.id));

                  if (!nextToLearn) {
                    actionsTaken.push(available.length > 0
                      ? "[already learned all techniques at current level]"
                      : `[no ${techClassId} techniques for level ${techEntity.level ?? 1}]`);
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
                      actionsTaken.push(result.ok ? `[${result.reason}]` : `[no ${techClassId} trainer nearby]`);
                    } else {
                      // Navigate to trainer and learn on arrival
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
                      });
                      runner.setGotoTarget(trainerId, techEntity?.region ?? "village-square", trainerName ?? undefined, "learn-technique");
                      configUpdated = true;
                      actionsTaken.push(`[heading to ${trainerName} to learn ${nextToLearn.name}]`);
                      server.log.info(`[agent/chat] learn_technique: goto trainer ${trainerId} to learn ${nextToLearn.id}`);
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
                  actionsTaken.push(`[bought & equipped item #${input.tokenId}]`);
                } else {
                  actionsTaken.push(`[failed to buy item #${input.tokenId}]`);
                }
              }
              await patchAgentConfig(authWallet, { focus: "shopping" });
              configUpdated = true;
            } else if (input.action === "equip_item" && input.tokenId != null) {
              const runner = agentManager.getRunner(authWallet);
              if (runner) {
                const equipped = await runner.equipItem(input.tokenId);
                actionsTaken.push(`[${equipped ? "equipped" : "failed to equip"} item #${input.tokenId}]`);
                server.log.info(`[agent/chat] equip_item(${input.tokenId}) → ${equipped}`);
              }
            } else if (input.action === "repair_gear") {
              const runner = agentManager.getRunner(authWallet);
              if (runner) {
                const repaired = await runner.repairGear();
                actionsTaken.push(`[${repaired ? "repaired gear" : "failed to repair gear"}]`);
                server.log.info(`[agent/chat] repair_gear → ${repaired}`);
              }
            } else if (input.action === "recycle_item" && input.tokenId != null) {
              const runner = agentManager.getRunner(authWallet);
              if (runner) {
                const result = await runner.recycleItem(input.tokenId, Math.max(1, Math.floor(input.quantity ?? 1)));
                actionsTaken.push(result.ok
                  ? `[recycled ${result.itemName ?? `item #${input.tokenId}`} for ${result.totalPayoutCopper ?? 0}c]`
                  : `[failed to recycle item #${input.tokenId}: ${result.error ?? "unknown error"}]`);
                server.log.info(`[agent/chat] recycle_item(${input.tokenId}, qty=${Math.max(1, Math.floor(input.quantity ?? 1))}) → ${result.ok}`);
              }
            }
            toolResults.push({ name: fnName, content: JSON.stringify({ ok: true, actions: actionsTaken }) });
          } catch {
            toolResults.push({ name: fnName, content: JSON.stringify({ error: "Action failed" }) });
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
              functionResponse: { name: tr.name, response: JSON.parse(tr.content) },
            })),
          },
        ];

        const followUp = await gemini.models.generateContent({
          model: GEMINI_MODEL,
          contents: followUpContents,
          config: {
            systemInstruction: fullSystemInstruction + "\n\nReply in 1-2 short sentences using the tool results. Be natural, specific, and brief. No internal tool names or bracket tags.",
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
                description: "Update the agent's activity focus and combat strategy. Use this for ANY request to change what the agent is doing: fight, quest, gather, craft, shop, brew, cook, idle, travel.",
                parameters: {
                  type: "OBJECT" as Type,
                  properties: {
                    focus: {
                      type: "STRING" as Type,
                      enum: ["questing", "combat", "enchanting", "crafting", "gathering", "alchemy", "cooking", "trading", "shopping", "traveling", "learning", "idle"],
                      description: "The new activity focus",
                    },
                    strategy: {
                      type: "STRING" as Type,
                      enum: ["aggressive", "balanced", "defensive"],
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
        const retryText = retryParts.find((p: Part) => p.text)?.text;
        if (retryText) {
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
              actionsTaken.push(`[switched to ${input.focus}${input.strategy ? `, ${input.strategy}` : ""}]`);
              const runner = agentManager.getRunner(authWallet);
              if (runner) runner.clearScript();
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
            { role: "model" as const, parts: [{ text: `[actions taken: ${actionsTaken.join(", ")}]` }] },
            { role: "user" as const, parts: [{ text: "Now respond as yourself about what you just did. 1 sentence, in character, with personality. You ARE the character speaking in real time." }] },
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
      agentResponse = "Done. What’s next?";
    } else if (!agentResponse) {
      agentResponse = "Not sure what you mean — tell me to fight, quest, gather, or explore and I’m on it.";
    }

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
    });
  });

  // ── POST /agent/goto-npc — Send agent to a specific NPC (UI click) ─────────
  server.post<{
    Body: { entityId: string; zoneId: string; name?: string; action?: string; profession?: string };
  }>("/agent/goto-npc", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;
    const { entityId, zoneId, name, action, profession } = request.body ?? {};

    if (!entityId || !zoneId) {
      return reply.code(400).send({ error: "entityId and zoneId are required" });
    }

    await patchAgentConfig(authWallet, {
      focus: "goto",
      gotoTarget: { entityId, zoneId, name, action, profession },
    });

    const logText = action === "learn-profession" && profession
      ? `[LEARN] Sending agent to learn ${profession} from ${name ?? entityId}`
      : `[GOTO] Sending agent to ${name ?? entityId} in ${zoneId}`;

    await appendChatMessage(authWallet, {
      role: "activity",
      text: logText,
      ts: Date.now(),
    });

    const runner = agentManager.getRunner(authWallet);
    if (runner) {
      runner.setGotoTarget(entityId, zoneId, name, action, profession);
    }

    return reply.send({ ok: true, gotoTarget: { entityId, zoneId, name, action, profession } });
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
      runner.clearScript();
    }

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
  // Codes stored in Redis: promo:{CODE} → JSON { tier, maxUses, uses, goldBonus? }
  // Seed codes via POST /agent/promo/create (admin) or manually in Redis.

  interface PromoCode {
    tier: AgentTier;
    maxUses: number;
    uses: number;
    goldBonus?: number;
  }

  function promoKey(code: string) { return `promo:${code.toUpperCase().trim()}`; }
  function promoUsedKey(code: string, wallet: string) { return `promo:used:${code.toUpperCase().trim()}:${wallet.toLowerCase()}`; }

  async function getPromo(code: string): Promise<PromoCode | null> {
    const redis = getRedis();
    if (!redis) return null;
    const raw = await redis.get(promoKey(code));
    return raw ? (JSON.parse(raw) as PromoCode) : null;
  }

  // ── POST /agent/promo/create — create a promo code (admin) ─────────────
  server.post<{
    Body: { code: string; tier: AgentTier; maxUses: number; goldBonus?: number; adminKey: string };
  }>("/agent/promo/create", async (request, reply) => {
    const { code, tier, maxUses, goldBonus, adminKey } = request.body;
    if (adminKey !== process.env.ADMIN_KEY) {
      return reply.code(403).send({ error: "Unauthorized" });
    }
    if (!code || !tier || !maxUses) {
      return reply.code(400).send({ error: "code, tier, and maxUses required" });
    }
    const redis = getRedis();
    if (!redis) return reply.code(500).send({ error: "Redis unavailable" });
    const promo: PromoCode = { tier, maxUses, uses: 0, goldBonus };
    await redis.set(promoKey(code), JSON.stringify(promo));
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
      const redis = getRedis();
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
      if (redis) {
        const alreadyUsed = await redis.get(promoUsedKey(promoCode, authWallet));
        if (alreadyUsed) {
          return reply.code(400).send({ error: "You have already used this promo code." });
        }
      }
      // Redeem
      promo.uses += 1;
      if (redis) {
        await redis.set(promoKey(promoCode), JSON.stringify(promo));
        await redis.set(promoUsedKey(promoCode, authWallet), "1");
      }
      promoApplied = true;
      promoGoldBonus = promo.goldBonus ?? 0;
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
          await mintGold(custodial, goldBonus.toString());
          server.log.info(`[upgrade-tier] Minted ${goldBonus} gold to ${custodial} for ${tier} tier upgrade`);
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
}
