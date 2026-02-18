import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerCharacterTools } from "./tools/character.js";
import { registerCombatTools } from "./tools/combat.js";
import { registerNavigationTools } from "./tools/navigation.js";
import { registerWorldTools } from "./tools/world.js";
import { registerShopTools } from "./tools/shop.js";
import { registerProfessionTools } from "./tools/professions.js";
import { registerSocialTools } from "./tools/social.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "wog-mmorpg",
    version: "0.1.0",
  });

  registerAuthTools(server);
  registerCharacterTools(server);
  registerCombatTools(server);
  registerNavigationTools(server);  // blocking walk, find_nearby, travel_to_zone
  registerWorldTools(server);
  registerShopTools(server);
  registerProfessionTools(server);
  registerSocialTools(server);

  return server;
}
