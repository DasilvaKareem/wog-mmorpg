import type { FastifyInstance } from "fastify";
import { deployAgent, type DeploymentRequest } from "./x402Deployment.js";
import { PRICING_TIERS } from "./x402Payment.js";
import { RACE_DEFINITIONS } from "../character/races.js";
import { CLASS_DEFINITIONS } from "../character/classes.js";

/**
 * Register X402 Agent Deployment API routes
 */
export function registerX402Routes(server: FastifyInstance): void {
  // Discovery endpoint - returns service information
  server.get("/x402/info", async (request, reply) => {
    return reply.send({
      service: "WoG Agent Deployment Service (X402)",
      version: "1.0.0",
      description: "Atomic API for deploying AI agents into WoG MMORPG",
      endpoint: "/x402/deploy",
      pricing: {
        free_tier: {
          cost: PRICING_TIERS.free.cost,
          gold_bonus: PRICING_TIERS.free.goldBonus,
          rate_limit: PRICING_TIERS.free.rateLimit,
        },
        starter_tier: {
          cost_usd: PRICING_TIERS.starter.cost,
          gold_bonus: PRICING_TIERS.starter.goldBonus,
          rate_limit: PRICING_TIERS.starter.rateLimit,
        },
        pro_tier: {
          cost_usd: PRICING_TIERS.pro.cost,
          gold_bonus: PRICING_TIERS.pro.goldBonus,
          rate_limit: PRICING_TIERS.pro.rateLimit,
          bonus: PRICING_TIERS.pro.bonus,
        },
      },
      payment_methods: ["free", "stripe", "crypto"],
      supported_races: RACE_DEFINITIONS.map(r => r.id),
      supported_classes: CLASS_DEFINITIONS.map(c => c.id),
      deployment_zones: ["village-square", "wild-meadow", "dark-forest"],
      appearance: {
        skinColor: ["light", "medium", "dark", "olive", "pale"],
        hairStyle: ["short", "long", "mohawk", "ponytail"],
        eyeColor: ["blue", "green", "brown", "red", "gold"],
      },
      documentation: "https://github.com/yourusername/wog-mmorpg/blob/master/docs/X402_AGENT_DEPLOYMENT.md",
      examples: {
        free_deployment: {
          method: "POST",
          url: "/x402/deploy",
          body: {
            agentName: "MyAIAgent",
            character: {
              name: "Aragorn",
              race: "human",
              class: "warrior",
              skinColor: "medium",
              hairStyle: "long",
              eyeColor: "brown",
            },
            payment: {
              method: "free",
            },
            deploymentZone: "village-square",
            metadata: {
              source: "my-ai-service",
              version: "1.0",
            },
          },
        },
      },
    });
  });

  // Deployment endpoint - creates and spawns an agent
  server.post<{ Body: DeploymentRequest }>("/x402/deploy", async (request, reply) => {
    const {
      agentName,
      character,
      payment,
      metadata,
    } = request.body;
    // Accept both camelCase and snake_case for deployment zone
    const deploymentZone = request.body.deploymentZone || request.body.deployment_zone;

    // Validate required fields
    if (!agentName || !character || !payment || !deploymentZone) {
      return reply.status(400).send({
        success: false,
        error: "missing_fields",
        message: "Required fields: agentName, character, payment, deploymentZone (or deployment_zone)",
        retry: false,
      });
    }

    if (!character.name || !character.race || !character.class) {
      return reply.status(400).send({
        success: false,
        error: "invalid_character",
        message: "Character must have name, race, class. Optional: skinColor, hairStyle, eyeColor",
        retry: false,
      });
    }

    // Validate deployment zone
    const validZones = ["village-square", "wild-meadow", "dark-forest"];
    if (!validZones.includes(deploymentZone)) {
      return reply.status(400).send({
        success: false,
        error: "invalid_zone",
        message: `Invalid deployment zone. Valid zones: ${validZones.join(", ")}`,
        retry: false,
      });
    }

    // Validate payment method
    const validPaymentMethods = ["free", "stripe", "crypto"];
    if (!validPaymentMethods.includes(payment.method)) {
      return reply.status(400).send({
        success: false,
        error: "invalid_payment_method",
        message: `Invalid payment method. Valid methods: ${validPaymentMethods.join(", ")}`,
        retry: false,
      });
    }

    // Execute deployment
    const requestSource = request.ip || metadata?.source || "unknown";
    console.log(`[x402] New deployment request from ${requestSource}: ${agentName}`);

    const result = await deployAgent({
      agentName,
      character,
      payment,
      deploymentZone,
      metadata: {
        ...metadata,
        source: requestSource,
      },
    } as DeploymentRequest);

    if (!result.success) {
      const statusCode = "error" in result && result.error === "rate_limit_exceeded" ? 429 : 400;
      return reply.status(statusCode).send(result);
    }

    return reply.status(201).send(result);
  });

  // Health check for X402 service
  server.get("/x402/health", async (request, reply) => {
    return reply.send({
      status: "operational",
      uptime: process.uptime(),
      timestamp: Date.now(),
    });
  });
}
