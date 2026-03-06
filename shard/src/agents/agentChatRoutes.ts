/**
 * Agent Chat Routes
 * POST /agent/chat      — Send a message to the AI agent controlling your character
 * POST /agent/deploy    — Create custodial wallet + mint char + start agent loop
 * POST /agent/stop      — Stop the agent loop
 * GET  /agent/status/:wallet — Get agent running status + config
 */

import type { FastifyInstance } from "fastify";
import Groq from "groq-sdk";
import { authenticateRequest } from "../auth/auth.js";
import { agentManager } from "./agentManager.js";
import {
  getAgentConfig,
  setAgentConfig,
  patchAgentConfig,
  getAgentCustodialWallet,
  getAgentEntityRef,
  appendChatMessage,
  getChatHistory,
  defaultConfig,
  getDeployCount,
  incrementDeployCount,
  type AgentFocus,
  type AgentStrategy,
} from "./agentConfigStore.js";
import { setupAgentCharacter } from "./agentCharacterSetup.js";
import { type AgentTier, TIER_CAPABILITIES } from "./agentTiers.js";
import { mintGold, getGoldBalance } from "../blockchain/blockchain.js";
import { copperToGold } from "../blockchain/currency.js";
import { getEntity as getWorldEntity, getAllEntities, getEntitiesNear } from "../world/zoneRuntime.js";
import { getLearnedTechniques } from "../combat/techniques.js";
import { getWorldLayout, resolveRegionId } from "../world/worldLayout.js";
import { loadAnyCharacterForWallet, loadAllCharactersForWallet } from "../character/characterStore.js";
import { sendInboxMessage } from "./agentInbox.js";
import { sleep, extractRawCharacterName } from "./agentUtils.js";

/** Internal fetch with 5s timeout — used for self-calls to avoid hanging forever. */
function internalFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(5_000) });
}

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

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

    // ── 1 free agent per account, then $2 USDC ────────────────────────────
    const deployCount = await getDeployCount(authWallet);
    if (deployCount > 0 && !request.body.paymentTx) {
      return reply.code(402).send({
        error: "payment_required",
        message: "First agent is free. Additional agents cost $2 USDC.",
        deployCount,
        paymentAmount: "2",
        paymentCurrency: "USDC",
      });
    }

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
        classId
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

    await agentManager.stop(authWallet);

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

    if (!process.env.GROQ_API_KEY) {
      return reply.code(503).send({ error: "GROQ_API_KEY not configured" });
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

    const systemPrompt = `You are ${charName}, a Level ${charLevel} ${charRace} ${charClass} in World of Geneva.
Region: ${entity?.region ?? ref?.zoneId ?? "unknown"} | HP: ${entity?.hp ?? "?"}/${entity?.maxHp ?? "?"}
Current focus: ${config.focus} | Strategy: ${config.strategy}
Nearby: ${nearbyDesc}
Nearby players: ${nearbyPlayersDesc}
${inventoryDesc}
Interaction mode: ${interactionMode}

RULES:
1. Respond in character as ${charName}. Sound like a person in the world, not an operator panel.
2. If the user is chatting, joking, asking how things are going, or otherwise being social, stay conversational. Do NOT mention focus, strategy, tools, configs, or internal mechanics unless the user asked.
3. Only call update_focus when the user is clearly asking you to change your ongoing behavior. Do NOT treat casual banter as a control command.
4. Call take_action for one-off actions: learning a profession, learning a spell/technique from a class trainer (use learn_technique), buying a specific item, equipping gear.
5. You can call BOTH tools in one response if needed (e.g., learn alchemy AND switch focus to alchemy).
6. If focus is traveling, targetZone MUST be a canonical zone ID from this list: ${availableZoneIds.join(", ")}
7. Use scan_zone, check_inventory, check_shop, what_can_i_craft, or check_quests when the user asks about surroundings, gear, items, recipes, or quests. Call these tools BEFORE answering — don't guess from the system prompt snapshot.
8. Use send_message when the user wants to communicate with another player/agent. Match the player by name from the nearby players list and use their wallet address as the recipient.
9. After any tool result, explain what happened in natural language. Never answer with bracket tags, canned acknowledgements, or control-panel phrasing.

Focus options: questing, combat, gathering, crafting, enchanting, alchemy, cooking, shopping, trading, traveling, idle
Strategy options: aggressive (fight higher-level mobs), balanced (default), defensive (fight lower, flee early)`;

    const history: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...(recentActivity
        ? [{ role: "system" as const, content: `Recent activity log:\n${recentActivity}` }]
        : []),
      ...conversationHistory.map((m) => ({
        role: m.role === "user" ? "user" as const : "assistant" as const,
        content: m.text,
      })),
      { role: "user", content: message },
    ];

    // Groq API call with tools (OpenAI-compatible format)
    let groqResponse: Groq.Chat.ChatCompletion;
    try {
      groqResponse = await groq.chat.completions.create({
        model: "openai/gpt-oss-120b",
        max_tokens: 300,
        temperature: 0.5,
        messages: history,
        tools: [
          {
            type: "function",
            function: {
              name: "update_focus",
              description: "Update the agent's activity focus and combat strategy",
              parameters: {
                type: "object",
                properties: {
                  focus: {
                    type: "string",
                    enum: ["questing", "combat", "enchanting", "crafting", "gathering", "alchemy", "cooking", "trading", "shopping", "traveling", "idle"],
                    description: "The new activity focus",
                  },
                  strategy: {
                    type: "string",
                    enum: ["aggressive", "balanced", "defensive"],
                    description: "The combat/play strategy",
                  },
                  targetZone: {
                    type: "string",
                    description: "Optional target zone to move to",
                  },
                },
                required: ["focus"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "take_action",
              description: "Execute an immediate in-game action. Use learn_technique when the user asks to learn skills, spells, abilities, techniques, moves, or visit a trainer. Use learn_profession to pick up a gathering/crafting profession. Use buy_item/equip_item for gear, repair_gear at a blacksmith.",
              parameters: {
                type: "object",
                properties: {
                  action: {
                    type: "string",
                    enum: ["learn_profession", "learn_technique", "buy_item", "equip_item", "repair_gear"],
                    description: "The action type. Use learn_technique when the user asks to learn skills, spells, abilities, techniques, moves, or go to a trainer.",
                  },
                  professionId: {
                    type: "string",
                    enum: ["mining", "herbalism", "skinning", "blacksmithing", "alchemy", "cooking", "leatherworking", "jewelcrafting"],
                    description: "Which profession to learn (for learn_profession action)",
                  },
                  tokenId: {
                    type: "number",
                    description: "The item token ID to buy or equip (for buy_item / equip_item actions)",
                  },
                },
                required: ["action"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "scan_zone",
              description: "Look around: see nearby mobs (sorted by level fit), NPCs, resource nodes, and portals in your current zone.",
              parameters: { type: "object", properties: {} },
            },
          },
          {
            type: "function",
            function: {
              name: "check_inventory",
              description: "Check your gold balance, all items in your inventory with quantities, and currently equipped gear.",
              parameters: { type: "object", properties: {} },
            },
          },
          {
            type: "function",
            function: {
              name: "check_shop",
              description: "See what the nearest merchant sells and what you can afford.",
              parameters: { type: "object", properties: {} },
            },
          },
          {
            type: "function",
            function: {
              name: "what_can_i_craft",
              description: "Check which crafting, alchemy, and cooking recipes you can make right now based on your inventory.",
              parameters: { type: "object", properties: {} },
            },
          },
          {
            type: "function",
            function: {
              name: "check_quests",
              description: "See your active quests and available quests in your current zone.",
              parameters: { type: "object", properties: {} },
            },
          },
          {
            type: "function",
            function: {
              name: "send_message",
              description: "Send a message to a nearby player/agent. Use this when the user wants to talk to, trade with, or invite another player. The message is delivered to their inbox and they'll see it on their next tick.",
              parameters: {
                type: "object",
                properties: {
                  toWallet: {
                    type: "string",
                    description: "The recipient's wallet address (from the nearby players list)",
                  },
                  body: {
                    type: "string",
                    description: "The message to send, written in-character",
                  },
                  type: {
                    type: "string",
                    enum: ["direct", "trade-request", "party-invite"],
                    description: "Message type: direct for general chat, trade-request for trade offers, party-invite for group invites",
                  },
                },
                required: ["toWallet", "body"],
              },
            },
          },
        ],
        tool_choice: "auto",
      });
    } catch (err: any) {
      server.log.error(`[agent/chat] Groq API error: ${err.message}`);
      return reply.code(502).send({ error: "AI service unavailable" });
    }

    // Process response
    let configUpdated = false;
    let agentResponse = "";
    const actionsTaken: string[] = [];

    const choice = groqResponse.choices[0];

    // Debug: log what Groq actually returned
    server.log.info(`[agent/chat] Groq response: finish_reason=${choice?.finish_reason} content=${JSON.stringify(choice?.message?.content)?.slice(0, 120)} tool_calls=${choice?.message?.tool_calls?.length ?? 0} model=${groqResponse.model}`);
    if (choice?.message?.tool_calls?.length) {
      for (const tc of choice.message.tool_calls) {
        server.log.info(`[agent/chat] tool_call: ${tc.function.name}(${tc.function.arguments?.slice(0, 100)})`);
      }
    }

    // Capture first response content
    if (choice?.message?.content) {
      agentResponse = choice.message.content;
    }

    // Execute all tool calls and collect results for potential follow-up
    const toolResults: { tool_call_id: string; content: string }[] = [];
    if (choice?.message?.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        const fnName = toolCall.function.name;

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
              } else if (e.type === "resource" || e.type === "ore" || e.type === "herb") {
                resources.push({ name: e.name, type: (e as any).resourceType ?? e.type, distance: dist });
              }
            }
            mobs.sort((a, b) => Math.abs(a.level - playerLevel) - Math.abs(b.level - playerLevel));
            scanResult = { region: entity.region ?? ref.zoneId, playerLevel, mobs: mobs.slice(0, 15), npcs: npcs.slice(0, 10), resources: resources.slice(0, 10) };
          }
          toolResults.push({ tool_call_id: toolCall.id, content: JSON.stringify(scanResult) });
        }

        else if (fnName === "check_inventory") {
          let invResult: any = { error: "No wallet" };
          if (custodialWallet) {
            try {
              const res = await internalFetch(`${apiBase}/wallet/${custodialWallet}/balance`);
              if (res.ok) {
                const data = await res.json() as any;
                invResult = {
                  gold: data.gold ?? data.copper ?? 0,
                  items: (data.items ?? []).map((i: any) => ({
                    tokenId: i.tokenId, name: i.name, balance: i.balance,
                    category: i.category, equipSlot: i.equipSlot, rarity: i.rarity,
                  })),
                  equipped: entity?.equipment ?? {},
                };
              }
            } catch (err) {
              server.log.warn(`[agent/chat] check_inventory fetch failed: ${(err as Error).message}`);
            }
          }
          toolResults.push({ tool_call_id: toolCall.id, content: JSON.stringify(invResult) });
        }

        else if (fnName === "check_shop") {
          let shopResult: any = { error: "No merchant nearby" };
          if (entity && ref) {
            let merchantId: string | null = null;
            let merchantDist = Infinity;
            for (const e of getEntitiesNear(entity.x, entity.y, 300)) {
              if (e.type === "npc" && ((e as any).npcType === "merchant" || (e as any).subType === "merchant" || (e as any).role === "merchant")) {
                const d = Math.hypot((e.x ?? 0) - (entity.x ?? 0), (e.y ?? 0) - (entity.y ?? 0));
                if (d < merchantDist) { merchantDist = d; merchantId = e.id; }
              }
            }
            if (merchantId) {
              try {
                const res = await internalFetch(`${apiBase}/shop/npc/${merchantId}`);
                if (res.ok) shopResult = await res.json();
              } catch (err) {
                server.log.warn(`[agent/chat] check_shop fetch failed: ${(err as Error).message}`);
              }
            }
          }
          toolResults.push({ tool_call_id: toolCall.id, content: JSON.stringify(shopResult) });
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
          toolResults.push({ tool_call_id: toolCall.id, content: JSON.stringify(craftResult) });
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
          toolResults.push({ tool_call_id: toolCall.id, content: JSON.stringify(questResult) });
        }

        // ── Action tools ─────────────────────────────────────────
        else if (fnName === "update_focus") {
          try {
            const input = JSON.parse(toolCall.function.arguments) as {
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
            toolResults.push({ tool_call_id: toolCall.id, content: JSON.stringify({ ok: true, ...patch }) });
          } catch {
            toolResults.push({ tool_call_id: toolCall.id, content: JSON.stringify({ error: "Failed to update focus" }) });
          }
        }

        else if (fnName === "send_message") {
          try {
            const input = JSON.parse(toolCall.function.arguments) as {
              toWallet: string;
              body: string;
              type?: "direct" | "trade-request" | "party-invite";
            };
            if (!input.toWallet || !input.body) {
              toolResults.push({ tool_call_id: toolCall.id, content: JSON.stringify({ error: "toWallet and body are required" }) });
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
              toolResults.push({ tool_call_id: toolCall.id, content: JSON.stringify({ ok: true, messageId: msgId, to: recipientName }) });
            }
          } catch {
            toolResults.push({ tool_call_id: toolCall.id, content: JSON.stringify({ error: "Failed to send message" }) });
          }
        }

        else if (fnName === "take_action") {
          try {
            const input = JSON.parse(toolCall.function.arguments) as {
              action: string;
              professionId?: string;
              tokenId?: number;
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
            }
            toolResults.push({ tool_call_id: toolCall.id, content: JSON.stringify({ ok: true, actions: actionsTaken }) });
          } catch {
            toolResults.push({ tool_call_id: toolCall.id, content: JSON.stringify({ error: "Action failed" }) });
          }
        }
      }
    }

    // If tools were called, do a follow-up Groq call with tool results so the
    // LLM can formulate a natural response using the actual outcome.
    if (toolResults.length > 0) {
      try {
        const followUpMessages: Groq.Chat.ChatCompletionMessageParam[] = [
          ...history,
          {
            role: "assistant" as const,
            content: choice?.message?.content ?? "",
            tool_calls: choice?.message?.tool_calls?.map(tc => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.function.name, arguments: tc.function.arguments },
            })),
          },
          ...toolResults.map(tr => ({
            role: "tool" as const,
            tool_call_id: tr.tool_call_id,
            content: tr.content,
          })),
          {
            role: "system" as const,
            content: "Reply to the user in character using the tool results. Be natural and specific. Do not mention internal tool names, config fields, or bracket tags.",
          },
        ];

        const followUp = await groq.chat.completions.create({
          model: "openai/gpt-oss-120b",
          max_tokens: 300,
          temperature: 0.5,
          messages: followUpMessages,
        });

        if (followUp.choices[0]?.message?.content) {
          agentResponse = followUp.choices[0].message.content;
        }
      } catch (err: any) {
        server.log.warn(`[agent/chat] Follow-up Groq call failed: ${err.message}`);
      }
    }

    // If LLM returned nothing useful, retry once with tool_choice: "required"
    if (!agentResponse && actionsTaken.length === 0) {
      server.log.warn(`[agent/chat] Empty response from Groq — retrying with tool_choice=required`);
      try {
        const retryResponse = await groq.chat.completions.create({
          model: "openai/gpt-oss-120b",
          max_tokens: 300,
          temperature: 0.3,
          messages: history,
          tools: [
            {
              type: "function",
              function: {
                name: "update_focus",
                description: "Update the agent's activity focus and combat strategy. Use this for ANY request to change what the agent is doing: fight, quest, gather, craft, shop, brew, cook, idle, travel.",
                parameters: {
                  type: "object",
                  properties: {
                    focus: {
                      type: "string",
                      enum: ["questing", "combat", "enchanting", "crafting", "gathering", "alchemy", "cooking", "trading", "shopping", "traveling", "idle"],
                      description: "The new activity focus",
                    },
                    strategy: {
                      type: "string",
                      enum: ["aggressive", "balanced", "defensive"],
                    },
                  },
                  required: ["focus"],
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "update_focus" } },
        });
        const retryChoice = retryResponse.choices[0];
        if (retryChoice?.message?.content) {
          agentResponse = retryChoice.message.content;
        }
        if (retryChoice?.message?.tool_calls) {
          for (const tc of retryChoice.message.tool_calls) {
            if (tc.function.name === "update_focus") {
              try {
                const input = JSON.parse(tc.function.arguments) as { focus: AgentFocus; strategy?: AgentStrategy };
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
        }
      } catch (retryErr: any) {
        server.log.warn(`[agent/chat] Retry failed: ${retryErr.message?.slice(0, 60)}`);
      }
    }

    // Final fallback if still empty
    if (!agentResponse && actionsTaken.length > 0) {
      agentResponse = "Right. I’ve set about it.";
    } else if (!agentResponse) {
      agentResponse = "I heard ye, but I'm not quite sure how to act on that. Tell me what you'd like — anything from fighting to crafting to exploring, I'll figure it out.";
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
}
