/**
 * Agent Chat Routes
 * POST /agent/chat      — Send a message to the AI agent controlling your character
 * POST /agent/deploy    — Create custodial wallet + mint char + start agent loop
 * POST /agent/stop      — Stop the agent loop
 * GET  /agent/status/:wallet — Get agent running status + config
 */

import type { FastifyInstance } from "fastify";
import Groq from "groq-sdk";
import { authenticateRequest } from "./auth.js";
import { agentManager } from "./agentManager.js";
import {
  getAgentConfig,
  setAgentConfig,
  patchAgentConfig,
  getAgentCustodialWallet,
  getAgentEntityRef,
  appendChatMessage,
  defaultConfig,
  type AgentFocus,
  type AgentStrategy,
} from "./agentConfigStore.js";
import { setupAgentCharacter } from "./agentCharacterSetup.js";
import { getAllZones } from "./zoneRuntime.js";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

async function getEntityState(entityId: string, zoneId: string): Promise<any | null> {
  try {
    const zone = getAllZones().get(zoneId);
    if (!zone) return null;
    return zone.entities.get(entityId) ?? null;
  } catch {
    return null;
  }
}

async function getFullGameState(userWallet: string) {
  const ref = await getAgentEntityRef(userWallet);
  if (!ref) return null;

  const entity = await getEntityState(ref.entityId, ref.zoneId);
  if (!entity) return null;

  // Get nearby entities
  const zone = getAllZones().get(ref.zoneId);
  const nearby: any[] = [];
  if (zone) {
    for (const [id, e] of zone.entities) {
      if (id === ref.entityId) continue;
      const dist = Math.hypot((e as any).x - entity.x, (e as any).y - entity.y);
      if (dist < 200) nearby.push({ entityId: id, ...(e as any) });
    }
    nearby.sort((a, b) => {
      const da = Math.hypot(a.x - entity.x, a.y - entity.y);
      const db = Math.hypot(b.x - entity.x, b.y - entity.y);
      return da - db;
    });
  }

  return { entity, ref, nearby: nearby.slice(0, 10) };
}

export function registerAgentChatRoutes(server: FastifyInstance): void {

  // ── POST /agent/deploy ────────────────────────────────────────────────────
  server.post<{
    Body: {
      walletAddress: string;
      characterName?: string;
      raceId?: string;
      classId?: string;
    };
  }>("/agent/deploy", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authWallet = (request as any).walletAddress as string;

    // Use the character data the client selected (from their NFT)
    let characterName = request.body.characterName;
    let raceId = request.body.raceId ?? "human";
    let classId = request.body.classId ?? "warrior";

    // The client sends the formatted NFT name like "Zephyr the Mage".
    // Extract the raw name by stripping the " the ClassName" suffix,
    // since the character mint will re-add it.
    if (characterName) {
      const suffixMatch = characterName.match(/^(.+?)\s+the\s+\w+$/i);
      if (suffixMatch) {
        characterName = suffixMatch[1];
        server.log.info(`[agent/deploy] Extracted raw name: "${characterName}" from formatted NFT name`);
      }
    }

    // Fallback: if client didn't send a name, try to look it up from their wallet's NFTs
    if (!characterName) {
      try {
        const charRes = await fetch(`${process.env.API_URL || "http://localhost:3000"}/character/${authWallet}`);
        if (charRes.ok) {
          const charData = await charRes.json() as { characters?: any[] };
          const nft = charData.characters?.[0];
          if (nft) {
            // NFT name is formatted as "Name the Class" — extract raw name
            const rawMatch = (nft.name as string)?.match(/^(.+?)\s+the\s+\w+$/i);
            characterName = rawMatch ? rawMatch[1] : nft.name;
            raceId = nft.properties?.race ?? raceId;
            classId = nft.properties?.class ?? classId;
            server.log.info(`[agent/deploy] Resolved from wallet NFT: "${characterName}" (${raceId}/${classId})`);
          }
        }
      } catch {}
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

      // Enable agent config
      const config = (await getAgentConfig(authWallet)) ?? defaultConfig();
      config.enabled = true;
      config.lastUpdated = Date.now();
      await setAgentConfig(authWallet, config);

      // Start agent loop — wait for first tick to verify it's actually alive
      await agentManager.start(authWallet, /* waitForFirstTick */ true);

      return reply.send({
        ok: true,
        entityId: result.entityId,
        zoneId: result.zoneId,
        custodialWallet: result.custodialWallet,
        characterName: result.characterName,
        alreadyExisted: result.alreadyExisted,
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
    const running = agentManager.isRunning(authWallet);

    let entity: any = null;
    if (ref) {
      entity = await getEntityState(ref.entityId, ref.zoneId);
    }

    // If entity not in zone, fall back to NFT metadata for name
    if (!entity && custodial) {
      try {
        const charRes = await fetch(`${process.env.API_URL || "http://localhost:3000"}/character/${custodial}`);
        if (charRes.ok) {
          const charData = await charRes.json() as { characters?: any[] };
          const nft = charData.characters?.[0];
          if (nft) {
            entity = {
              name: nft.name,
              level: nft.properties?.level ?? 1,
              hp: null,
              maxHp: null,
            };
          }
        }
      } catch {}
    }

    return reply.send({
      running,
      config: config ?? null,
      entityId: ref?.entityId ?? null,
      zoneId: ref?.zoneId ?? null,
      custodialWallet: custodial ?? null,
      entity: entity ?? null,
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

    if (!config) {
      return reply.code(404).send({ error: "No agent config found. Deploy your agent first." });
    }

    if (!process.env.GROQ_API_KEY) {
      return reply.code(503).send({ error: "GROQ_API_KEY not configured" });
    }

    // Build system prompt
    const entity = gameState?.entity;
    const ref = gameState?.ref;
    const nearby = gameState?.nearby ?? [];

    // Resolve character name — prefer live entity, fall back to NFT metadata
    let charName = entity?.name;
    let charRace = entity?.raceId ?? "human";
    let charClass = entity?.classId ?? "warrior";
    let charLevel = entity?.level ?? 1;
    if (!charName) {
      try {
        const custodial = await getAgentCustodialWallet(authWallet);
        if (custodial) {
          const charRes = await fetch(`${process.env.API_URL || "http://localhost:3000"}/character/${custodial}`);
          if (charRes.ok) {
            const charData = await charRes.json() as { characters?: any[] };
            const nft = charData.characters?.[0];
            if (nft) {
              charName = nft.name;
              charRace = nft.properties?.race ?? charRace;
              charClass = nft.properties?.class ?? charClass;
              charLevel = nft.properties?.level ?? charLevel;
            }
          }
        }
      } catch {}
    }
    if (!charName) charName = "Unknown";

    const nearbyDesc = nearby
      .map((e: any) => `${e.name} (${e.type}, L${e.level ?? "?"}, HP ${e.hp}/${e.maxHp})`)
      .join(", ") || "none visible";

    const inventoryDesc = entity
      ? `Equipped: ${Object.entries(entity.equipment ?? {}).map(([slot, eq]: any) => `${slot}=${eq?.tokenId ?? "none"}`).join(", ") || "nothing"}`
      : "unknown";

    const systemPrompt = `You are ${charName}, a character in World of Geneva (WoG MMORPG).
Character: ${charName}, Level ${charLevel} ${charRace} ${charClass}
Zone: ${ref?.zoneId ?? "unknown"}
HP: ${entity?.hp ?? "?"}/${entity?.maxHp ?? "?"}
Current focus: ${config.focus}
Strategy: ${config.strategy}
Nearby entities: ${nearbyDesc}
${inventoryDesc}

You respond in character as ${charName} — short, direct, in-world responses (1-3 sentences max).
When the user asks you to change behavior, use the update_focus tool.
When they ask for an immediate action, use the take_action tool.
Always stay in character as ${charName} and keep responses under 100 words.`;

    // Build message history from config
    const history: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...config.chatHistory.slice(-10).map((m) => ({
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
                    enum: ["questing", "combat", "enchanting", "crafting", "gathering", "alchemy", "cooking", "trading", "idle"],
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
              description: "Execute an immediate in-game action: learn a profession, brew a potion, etc. The agent loop will handle the details (walking to NPCs, finding materials).",
              parameters: {
                type: "object",
                properties: {
                  action: {
                    type: "string",
                    enum: ["learn_profession"],
                    description: "The action type",
                  },
                  professionId: {
                    type: "string",
                    enum: ["mining", "herbalism", "skinning", "blacksmithing", "alchemy", "cooking", "leatherworking", "jewelcrafting"],
                    description: "Which profession to learn (for learn_profession action)",
                  },
                },
                required: ["action"],
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

    const choice = groqResponse.choices[0];
    if (choice?.message?.content) {
      agentResponse = choice.message.content;
    }

    // Process tool calls
    if (choice?.message?.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.function.name === "update_focus") {
          try {
            const input = JSON.parse(toolCall.function.arguments) as {
              focus: AgentFocus;
              strategy?: AgentStrategy;
              targetZone?: string;
            };
            const patch: any = { focus: input.focus };
            if (input.strategy) patch.strategy = input.strategy;
            if (input.targetZone) patch.targetZone = input.targetZone;
            await patchAgentConfig(authWallet, patch);
            configUpdated = true;
            server.log.info(`[agent/chat] Config updated: focus=${input.focus} strategy=${input.strategy ?? "unchanged"}`);
          } catch {}
        }
        if (toolCall.function.name === "take_action") {
          try {
            const input = JSON.parse(toolCall.function.arguments) as {
              action: string;
              professionId?: string;
            };
            if (input.action === "learn_profession" && input.professionId) {
              // Get the running agent and tell it to learn
              const runner = agentManager.getRunner(authWallet);
              if (runner) {
                const result = await runner.learnProfession(input.professionId);
                server.log.info(`[agent/chat] learn_profession(${input.professionId}) → ${result}`);
              }
              // Also switch focus to match the profession
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
            }
          } catch {}
        }
      }
    }

    if (!agentResponse) {
      agentResponse = "Got it. I'll adjust my strategy accordingly.";
    }

    // Persist chat history
    const ts = Date.now();
    await appendChatMessage(authWallet, { role: "user", text: message, ts });
    await appendChatMessage(authWallet, { role: "agent", text: agentResponse, ts: ts + 1 });

    return reply.send({
      response: agentResponse,
      configUpdated,
      agentRunning: agentManager.isRunning(authWallet),
    });
  });
}
