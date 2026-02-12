import type { FastifyInstance } from "fastify";
import type { WorldAgentTemplate, AgentCategory, AgentTier } from "../../types/world-agent.js";

interface TemplatesQuery {
  category?: string;
  tier?: string;
}

const VALID_CATEGORIES = ["hostile", "friendly"];
const VALID_TIERS = ["lesser", "normal", "greater", "elite"];

export function registerTemplatesRoute(
  app: FastifyInstance,
  templates: Map<string, WorldAgentTemplate>,
): void {
  app.get<{ Querystring: TemplatesQuery }>("/v1/templates", (req, reply) => {
    let results = Array.from(templates.values());

    const category = req.query.category;
    if (category) {
      if (!VALID_CATEGORIES.includes(category)) {
        return reply.status(400).send({ error: 'category must be "hostile" or "friendly"' });
      }
      results = results.filter((t) => t.category === category);
    }

    const tier = req.query.tier;
    if (tier) {
      if (!VALID_TIERS.includes(tier)) {
        return reply.status(400).send({ error: 'tier must be "lesser", "normal", "greater", or "elite"' });
      }
      results = results.filter((t) => t.tier === tier);
    }

    return reply.send({ templates: results });
  });
}
