/**
 * mcpClient.ts — Per-agent MCP client for the WoG MCP server.
 *
 * Connects to the WoG MCP server (port 3001), authenticates using the agent's
 * custodial wallet, discovers all tools, and proxies tool calls.
 *
 * Gemini gets the tools via `getGeminiTools()` which returns FunctionDeclarations
 * with `parametersJsonSchema` (raw JSON Schema passthrough from MCP).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { privateKeyToAccount } from "viem/accounts";
import type { FunctionDeclaration } from "@google/genai";

const MCP_URL = process.env.MCP_URL ?? "http://localhost:3001/mcp";

/** Parameters automatically injected from agent context — stripped from Gemini schemas. */
const AUTO_INJECT_PARAMS = new Set([
  "sessionId",
  "entityId",
  "zoneId",
  "currentZoneId",
  "walletAddress",
]);

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Context the runner provides so tool calls get auto-filled parameters. */
export interface McpCallContext {
  entityId?: string;
  zoneId?: string;
  walletAddress?: string;
}

// Tools to hide from Gemini — managed internally or dangerous for agents
const HIDDEN_TOOLS = new Set([
  "auth_get_challenge",
  "auth_verify_signature",
  "auth_logout",
  "wallet_register",
  "character_create",
  "character_spawn",
  "character_logout",
]);

// Blocking/long-running tools — only exposed in chat, not supervisor
const BLOCKING_TOOLS = new Set([
  "fight_until_dead",
  "grind_mobs",
  "travel_to_zone",
  "navigate_to",
  "navigate_to_entity",
  "navigate_to_npc",
  "navigate_to_portal",
]);

/** Supervisor-only allowlist — keep this small so the LLM decides fast. */
const SUPERVISOR_TOOLS = new Set([
  "scan_zone",
  "get_my_status",
  "find_mobs_for_level",
  "what_can_i_craft",
  "shop_get_catalog",
  "items_get_inventory",
  "world_list_zones",
  "quests_get_active",
  "quests_get_catalog",
]);

/** Chat allowlist — curated subset for user-facing chat. Keeps tool count low
 *  so Gemini responds fast and doesn't get confused by 60+ tools. */
const CHAT_TOOLS = new Set([
  "scan_zone",
  "get_my_status",
  "find_mobs_for_level",
  "items_get_inventory",
  "shop_get_catalog",
  "what_can_i_craft",
  "quests_get_active",
  "quests_get_catalog",
  "world_list_zones",
  "fight_until_dead",
  "grind_mobs",
  "travel_to_zone",
  "navigate_to_npc",
]);

export class AgentMcpClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private tools: McpToolDef[] = [];
  private toolMap = new Map<string, McpToolDef>();
  private mcpSessionId: string | null = null;
  private connectedAt = 0;
  private tag: string;

  constructor(walletTag: string) {
    this.tag = walletTag;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async connect(privateKey: string): Promise<void> {
    try {
      this.transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
      this.client = new Client({ name: "wog-agent-runner", version: "1.0.0" });
      await this.client.connect(this.transport);

      this.mcpSessionId = this.transport.sessionId ?? null;
      console.log(`[mcp:${this.tag}] Connected, session=${this.mcpSessionId?.slice(0, 8)}`);

      // Authenticate via the MCP auth flow
      await this.authenticate(privateKey);

      // Discover tools
      await this.discoverTools();

      this.connectedAt = Date.now();
    } catch (err: any) {
      console.error(`[mcp:${this.tag}] Connect failed: ${err.message?.slice(0, 100)}`);
      this.client = null;
      this.transport = null;
      throw err;
    }
  }

  async ensureConnected(privateKey: string): Promise<void> {
    // Re-auth after 20 hours (MCP sessions expire in 24h)
    if (this.client && Date.now() - this.connectedAt > 20 * 3_600_000) {
      console.log(`[mcp:${this.tag}] Session stale, reconnecting`);
      await this.disconnect();
    }
    if (!this.client) {
      await this.connect(privateKey);
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.transport) await this.transport.terminateSession();
    } catch { /* ignore */ }
    this.client = null;
    this.transport = null;
    this.mcpSessionId = null;
    this.tools = [];
    this.toolMap.clear();
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  // ── Auth ───────────────────────────────────────────────────────────────────

  private async authenticate(privateKey: string): Promise<void> {
    if (!this.client) throw new Error("Not connected");

    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const walletAddress = account.address;

    // Step 1: Get challenge
    const challengeResult = await this.client.callTool({
      name: "auth_get_challenge",
      arguments: { walletAddress },
    });
    const challengeText = (challengeResult.content as any[])?.find(
      (c: any) => c.type === "text",
    )?.text;
    if (!challengeText) throw new Error("No challenge returned from MCP");
    const challenge = JSON.parse(challengeText);

    // Step 2: Sign
    const signature = await account.signMessage({ message: challenge.message });

    // Step 3: Verify — MCP server stores session under transport.sessionId
    await this.client.callTool({
      name: "auth_verify_signature",
      arguments: { walletAddress, signature, timestamp: challenge.timestamp },
    });

    console.log(`[mcp:${this.tag}] Authenticated as ${walletAddress.slice(0, 10)}`);
  }

  // ── Tool Discovery ─────────────────────────────────────────────────────────

  private async discoverTools(): Promise<void> {
    if (!this.client) return;
    const result = await this.client.listTools();
    this.tools = (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
    }));
    this.toolMap.clear();
    for (const t of this.tools) this.toolMap.set(t.name, t);
    console.log(`[mcp:${this.tag}] Discovered ${this.tools.length} tools`);
  }

  // ── Gemini Integration ─────────────────────────────────────────────────────

  /**
   * Returns MCP tools as Gemini FunctionDeclarations.
   * Auto-injected params (sessionId, entityId, zoneId, walletAddress) are stripped
   * from schemas so the LLM doesn't need to provide them.
   *
   * @param includeBlocking If false, blocking tools (fight_until_dead, grind_mobs, etc.) are excluded.
   * @param supervisorOnly If true, only return the small set of read tools the supervisor needs.
   * @param chatOnly If true, only return the curated chat subset (~13 tools instead of ~60).
   */
  getGeminiTools(includeBlocking = true, supervisorOnly = false, chatOnly = false): FunctionDeclaration[] {
    const decls: FunctionDeclaration[] = [];

    for (const tool of this.tools) {
      if (HIDDEN_TOOLS.has(tool.name)) continue;
      if (!includeBlocking && BLOCKING_TOOLS.has(tool.name)) continue;
      if (supervisorOnly && !SUPERVISOR_TOOLS.has(tool.name)) continue;
      if (chatOnly && !CHAT_TOOLS.has(tool.name)) continue;

      // Deep clone schema so we can strip auto-inject params
      const schema = structuredClone(tool.inputSchema) as any;
      const props = schema.properties ?? {};
      const required: string[] = schema.required ?? [];

      for (const param of AUTO_INJECT_PARAMS) {
        delete props[param];
      }
      schema.required = required.filter((r: string) => !AUTO_INJECT_PARAMS.has(r));
      if (schema.required.length === 0) delete schema.required;

      // Gemini requires at least one property — add a dummy if empty
      if (Object.keys(props).length === 0) {
        schema.properties = {};
      }

      decls.push({
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: schema,
      });
    }

    return decls;
  }

  /** Check whether a tool name belongs to the MCP server */
  hasTool(name: string): boolean {
    return this.toolMap.has(name);
  }

  // ── Tool Execution ─────────────────────────────────────────────────────────

  /**
   * Call an MCP tool, auto-injecting context parameters.
   * Returns the raw text response from the MCP server.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    ctx: McpCallContext = {},
  ): Promise<string> {
    if (!this.client) throw new Error("MCP client not connected");

    const tool = this.toolMap.get(name);
    if (!tool) throw new Error(`Unknown MCP tool: ${name}`);

    const toolProps = (tool.inputSchema as any)?.properties ?? {};
    const fullArgs: Record<string, unknown> = { ...args };

    // Auto-inject context parameters
    if ("sessionId" in toolProps && !fullArgs.sessionId) {
      fullArgs.sessionId = this.mcpSessionId;
    }
    if ("entityId" in toolProps && !fullArgs.entityId && ctx.entityId) {
      fullArgs.entityId = ctx.entityId;
    }
    if ("zoneId" in toolProps && !fullArgs.zoneId && ctx.zoneId) {
      fullArgs.zoneId = ctx.zoneId;
    }
    if ("currentZoneId" in toolProps && !fullArgs.currentZoneId && ctx.zoneId) {
      fullArgs.currentZoneId = ctx.zoneId;
    }
    if ("walletAddress" in toolProps && !fullArgs.walletAddress && ctx.walletAddress) {
      fullArgs.walletAddress = ctx.walletAddress;
    }

    const result = await this.client.callTool({ name, arguments: fullArgs });

    // Extract text content
    const text =
      (result.content as any[])?.find((c: any) => c.type === "text")?.text ??
      "{}";
    return text;
  }
}
