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
  defaultConfig,
  type AgentFocus,
  type AgentStrategy,
} from "./agentConfigStore.js";
import { setupAgentCharacter } from "./agentCharacterSetup.js";
import { getAllZones } from "../world/zoneRuntime.js";
import { getWorldLayout, resolveZoneId } from "../world/worldLayout.js";
import { loadAnyCharacterForWallet } from "../character/characterStore.js";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractRawCharacterName(name?: string): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(.+?)\s+the\s+\w+$/i);
  return match ? match[1] : trimmed;
}

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
  const availableZoneIds = Object.keys(getWorldLayout().zones);

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
    const requestedWallet = request.body.walletAddress;

    if (requestedWallet && requestedWallet.toLowerCase() !== authWallet.toLowerCase()) {
      return reply.code(403).send({ error: "Request wallet does not match authenticated wallet" });
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

    // If client didn't send a name, try owner wallet characters first.
    if (!characterName) {
      try {
        const charRes = await fetch(`${process.env.API_URL || "http://localhost:3000"}/character/${authWallet}`);
        if (charRes.ok) {
          const charData = await charRes.json() as { characters?: any[] };
          const nft = charData.characters?.[0];
          if (nft) {
            characterName = extractRawCharacterName(nft.name as string) ?? undefined;
            raceId = nft.properties?.race ?? raceId;
            classId = nft.properties?.class ?? classId;
            server.log.info(`[agent/deploy] Resolved from owner wallet character: "${characterName}" (${raceId}/${classId})`);
          }
        }
      } catch {}
    }

    // Next, try saved character state for the owner wallet.
    if (!characterName) {
      const saved = await loadAnyCharacterForWallet(authWallet);
      if (saved) {
        characterName = extractRawCharacterName(saved.name) ?? saved.name;
        raceId = saved.raceId ?? raceId;
        classId = saved.classId ?? classId;
        server.log.info(`[agent/deploy] Resolved from owner saved character: "${characterName}" (${raceId}/${classId})`);
      }
    }

    // Last, try the user's custodial wallet (existing agent redeploy path).
    if (!characterName) {
      const custodial = await getAgentCustodialWallet(authWallet);
      if (custodial) {
        const saved = await loadAnyCharacterForWallet(custodial);
        if (saved) {
          characterName = extractRawCharacterName(saved.name) ?? saved.name;
          raceId = saved.raceId ?? raceId;
          classId = saved.classId ?? classId;
          server.log.info(`[agent/deploy] Resolved from custodial saved character: "${characterName}" (${raceId}/${classId})`);
        } else {
          try {
            const charRes = await fetch(`${process.env.API_URL || "http://localhost:3000"}/character/${custodial}`);
            if (charRes.ok) {
              const charData = await charRes.json() as { characters?: any[] };
              const nft = charData.characters?.[0];
              if (nft) {
                characterName = extractRawCharacterName(nft.name as string) ?? undefined;
                raceId = nft.properties?.race ?? raceId;
                classId = nft.properties?.class ?? classId;
                server.log.info(`[agent/deploy] Resolved from custodial wallet character: "${characterName}" (${raceId}/${classId})`);
              }
            }
          } catch {}
        }
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

      // Enable agent config
      const config = (await getAgentConfig(authWallet)) ?? defaultConfig();
      config.enabled = true;
      config.lastUpdated = Date.now();
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

    const runner = agentManager.getRunner(authWallet);
    const currentActivity = runner?.currentActivity ?? null;
    const script = runner?.script ?? null;
    const currentScript = script ? { type: script.type, reason: script.reason ?? null } : null;

    return reply.send({
      running,
      config: config ?? null,
      entityId: ref?.entityId ?? null,
      zoneId: ref?.zoneId ?? null,
      custodialWallet: custodial ?? null,
      entity,
      currentActivity,
      currentScript,
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

    const systemPrompt = `You are ${charName}, a Level ${charLevel} ${charRace} ${charClass} in World of Geneva.
Zone: ${ref?.zoneId ?? "unknown"} | HP: ${entity?.hp ?? "?"}/${entity?.maxHp ?? "?"}
Current focus: ${config.focus} | Strategy: ${config.strategy}
Nearby: ${nearbyDesc}
${inventoryDesc}

RULES:
1. Respond in character as ${charName} — 1-2 sentences max, stay in-world.
2. ALWAYS call update_focus when the user wants you to change what you're doing. ANY request to fight, gather, craft, shop, brew, cook, quest, or idle MUST trigger update_focus. Do NOT just say you'll do it — call the tool.
3. Call take_action for one-off actions: learning a profession, buying a specific item, equipping gear.
4. You can call BOTH tools in one response if needed (e.g., learn alchemy AND switch focus to alchemy).
5. If focus is traveling, targetZone MUST be a canonical zone ID from this list: ${availableZoneIds.join(", ")}

Focus options: questing, combat, gathering, crafting, enchanting, alchemy, cooking, shopping, trading, traveling, idle
Strategy options: aggressive (fight higher-level mobs), balanced (default), defensive (fight lower, flee early)`;

    // Build message history — include tool action context so the LLM knows what it did
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
              description: "Execute an immediate in-game action: learn a profession, buy an item from a merchant, equip an item, or repair damaged gear at a blacksmith.",
              parameters: {
                type: "object",
                properties: {
                  action: {
                    type: "string",
                    enum: ["learn_profession", "buy_item", "equip_item", "repair_gear"],
                    description: "The action type",
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
    const hasToolCalls = choice?.message?.tool_calls && choice.message.tool_calls.length > 0;

    // Only use inline text when no tools were called — otherwise the LLM
    // returns lazy filler like "Got it" that we'll replace with a follow-up
    if (choice?.message?.content && !hasToolCalls) {
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
            const hasTargetZoneText = typeof input.targetZone === "string" && input.targetZone.trim().length > 0;
            if (input.focus === "traveling") {
              const normalizedTargetZone = resolveZoneId(input.targetZone);
              if (normalizedTargetZone) {
                patch.targetZone = normalizedTargetZone;
              } else if (hasTargetZoneText) {
                patch.targetZone = undefined;
                actionsTaken.push(`[unknown zone "${input.targetZone}"]`);
              }
            } else {
              // Prevent stale travel directives from overriding non-travel focus.
              patch.targetZone = undefined;
            }
            await patchAgentConfig(authWallet, patch);
            configUpdated = true;
            actionsTaken.push(
              `[switched to ${input.focus}${input.strategy ? `, ${input.strategy} strategy` : ""}${patch.targetZone ? `, destination ${patch.targetZone}` : ""}]`
            );
            server.log.info(
              `[agent/chat] Config updated: focus=${input.focus} strategy=${input.strategy ?? "unchanged"} targetZone=${patch.targetZone ?? "none"}`
            );

            const runner = agentManager.getRunner(authWallet);
            if (runner) runner.clearScript();
          } catch {}
        }
        if (toolCall.function.name === "take_action") {
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
            }
            if (input.action === "buy_item" && input.tokenId != null) {
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
            }
            if (input.action === "equip_item" && input.tokenId != null) {
              const runner = agentManager.getRunner(authWallet);
              if (runner) {
                const equipped = await runner.equipItem(input.tokenId);
                actionsTaken.push(`[${equipped ? "equipped" : "failed to equip"} item #${input.tokenId}]`);
                server.log.info(`[agent/chat] equip_item(${input.tokenId}) → ${equipped}`);
              }
            }
            if (input.action === "repair_gear") {
              const runner = agentManager.getRunner(authWallet);
              if (runner) {
                const repaired = await runner.repairGear();
                actionsTaken.push(`[${repaired ? "repaired gear" : "failed to repair gear"}]`);
                server.log.info(`[agent/chat] repair_gear → ${repaired}`);
              }
            }
          } catch {}
        }
      }
    }

    // When tools are called, the LLM often returns lazy filler ("Got it", "Sure")
    // alongside the tool calls. Always do a follow-up call to get a proper
    // in-character response that acknowledges what was actually done.
    if (actionsTaken.length > 0) {
      try {
        const followUp = await groq.chat.completions.create({
          model: "openai/gpt-oss-120b",
          max_tokens: 120,
          messages: [
            { role: "system", content: `You are ${charName}, a Level ${charLevel} ${charRace} ${charClass} in World of Geneva. Respond in character in 1-2 sentences. Be vivid and specific about what you're doing. Stay in-world. No OOC. Never say "got it" or generic confirmations.` },
            { role: "user", content: message },
            { role: "assistant", content: `(I just: ${actionsTaken.join(", ")})` },
            { role: "user", content: "Describe what you just did in character. Be specific and vivid." },
          ],
        });
        const followUpText = followUp.choices[0]?.message?.content?.trim();
        if (followUpText) agentResponse = followUpText;
      } catch {
        // Fallback below
      }
    }

    // Final fallback if still empty
    if (!agentResponse && actionsTaken.length > 0) {
      agentResponse = `Aye, ${actionsTaken.join(" and ").replace(/[\[\]]/g, "")}.`;
    } else if (!agentResponse) {
      agentResponse = "Hmm, I'm not sure what you mean.";
    }

    // Append action tags to the saved history so the LLM has context next time
    const savedResponse = actionsTaken.length > 0
      ? `${agentResponse} ${actionsTaken.join(" ")}`
      : agentResponse;

    // Persist chat history
    const ts = Date.now();
    await appendChatMessage(authWallet, { role: "user", text: message, ts });
    await appendChatMessage(authWallet, { role: "agent", text: savedResponse, ts: ts + 1 });

    return reply.send({
      response: agentResponse,
      configUpdated,
      agentRunning: agentManager.isRunning(authWallet),
    });
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
        const normalizedTargetZone = resolveZoneId(targetZone);
        if (!normalizedTargetZone) {
          return reply.code(400).send({
            error: `Unknown targetZone: ${targetZone}`,
            validZones: availableZoneIds,
          });
        }
        patch.targetZone = normalizedTargetZone;
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
