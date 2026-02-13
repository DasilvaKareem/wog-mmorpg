import type { FastifyInstance } from "fastify";
import { deployAgent, type DeploymentRequest } from "./x402Deployment.js";
import { PRICING_TIERS } from "./x402Payment.js";
import { RACE_DEFINITIONS } from "./races.js";
import { CLASS_DEFINITIONS } from "./classes.js";

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
        basic_tier: {
          cost_usd: PRICING_TIERS.basic.cost,
          gold_bonus: PRICING_TIERS.basic.goldBonus,
          rate_limit: PRICING_TIERS.basic.rateLimit,
        },
        premium_tier: {
          cost_usd: PRICING_TIERS.premium.cost,
          gold_bonus: PRICING_TIERS.premium.goldBonus,
          rate_limit: PRICING_TIERS.premium.rateLimit,
          bonus: PRICING_TIERS.premium.bonus,
        },
      },
      payment_methods: ["free", "stripe", "crypto"],
      supported_races: RACE_DEFINITIONS.map(r => r.id),
      supported_classes: CLASS_DEFINITIONS.map(c => c.id),
      deployment_zones: ["human-meadow", "wild-meadow", "dark-forest"],
      documentation: "https://github.com/yourusername/wog-mmorpg/blob/master/docs/X402_AGENT_DEPLOYMENT.md",
      examples: {
        free_deployment: {
          method: "POST",
          url: "/x402/deploy",
          body: {
            agent_name: "MyAIAgent",
            character: {
              name: "Aragorn",
              race: "human",
              class: "warrior",
            },
            payment: {
              method: "free",
            },
            deployment_zone: "human-meadow",
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
      deploymentZone,
      metadata,
    } = request.body;

    // Validate required fields
    if (!agentName || !character || !payment || !deploymentZone) {
      return reply.status(400).send({
        success: false,
        error: "missing_fields",
        message: "Required fields: agentName, character, payment, deploymentZone",
        retry: false,
      });
    }

    if (!character.name || !character.race || !character.class) {
      return reply.status(400).send({
        success: false,
        error: "invalid_character",
        message: "Character must have name, race, and class",
        retry: false,
      });
    }

    // Validate deployment zone
    const validZones = ["human-meadow", "wild-meadow", "dark-forest"];
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
    console.log(`[x402] New deployment request from ${metadata?.source || "unknown"}: ${agentName}`);

    const result = await deployAgent({
      agentName,
      character,
      payment,
      deploymentZone,
      metadata,
    });

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
