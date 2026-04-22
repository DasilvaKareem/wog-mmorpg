import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { shard } from "../shard.js";
import { requireSession } from "../session.js";

// Shape of a single edict. Kept loose here — the shard re-validates on PUT
// via validateEdicts(), which is the source of truth.
const conditionSchema = z.object({
  subject: z.enum(["self", "target", "ally_lowest_hp", "leader", "leader_target"]),
  field: z.enum([
    "hp_pct", "essence_pct", "type", "active_effect",
    "effect_from_self", "nearby_enemies", "always",
  ]),
  operator: z.enum(["lt", "gt", "gte", "eq", "has", "not_has", "is"]),
  value: z.union([z.number(), z.string(), z.boolean()]),
});

const actionSchema = z.object({
  type: z.enum(["use_technique", "best_technique", "attack", "prefer_target", "flee", "skip"]),
  techniqueId: z.string().optional(),
  targetPreference: z
    .enum(["nearest", "weakest", "strongest", "boss", "leader_target", "party_tagged"])
    .optional(),
});

const edictSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  conditions: z.array(conditionSchema).max(3),
  action: actionSchema,
});

type EdictInput = z.infer<typeof edictSchema>;

async function readEdicts(wallet: string, token: string): Promise<EdictInput[]> {
  const data = await shard.get<{ edicts: EdictInput[] }>(
    `/agent/edicts/${wallet}`,
    token,
  );
  return data.edicts ?? [];
}

async function writeEdicts(edicts: EdictInput[], token: string): Promise<EdictInput[]> {
  const data = await shard.put<{ edicts: EdictInput[] }>(
    "/agent/edicts",
    { edicts },
    token,
  );
  return data.edicts ?? edicts;
}

export function registerGambitTools(server: McpServer): void {
  server.registerTool(
    "gambit_list",
    {
      description:
        "List your current gambits (edicts) — the rules that drive your auto-combat every tick. Rules evaluate top-to-bottom, first match wins.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
      },
    },
    async ({ sessionId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const edicts = await readEdicts(walletAddress, token);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ edicts }, null, 2) }],
      };
    },
  );

  server.registerTool(
    "gambit_set_all",
    {
      description:
        "Replace your entire gambit list. Max 12 gambits, max 3 conditions each. Use this when you know the full rule set you want. For incremental changes prefer gambit_add / gambit_remove.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        edicts: z.array(edictSchema).max(12).describe("Full replacement list of gambits"),
      },
    },
    async ({ sessionId, edicts }) => {
      const { token } = requireSession(sessionId);
      const saved = await writeEdicts(edicts, token);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ ok: true, edicts: saved }, null, 2) }],
      };
    },
  );

  server.registerTool(
    "gambit_add",
    {
      description:
        "Append a new gambit to your rule list. New rules go at the end so existing higher-priority rules still win.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        edict: edictSchema.describe("The gambit to append"),
      },
    },
    async ({ sessionId, edict }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const current = await readEdicts(walletAddress, token);
      const next = [...current.filter((e) => e.id !== edict.id), edict];
      const saved = await writeEdicts(next, token);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ ok: true, edicts: saved }, null, 2) }],
      };
    },
  );

  server.registerTool(
    "gambit_remove",
    {
      description: "Remove a gambit by id. No-op if the id is not found.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        edictId: z.string().describe("ID of the gambit to remove"),
      },
    },
    async ({ sessionId, edictId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const current = await readEdicts(walletAddress, token);
      const next = current.filter((e) => e.id !== edictId);
      const saved = await writeEdicts(next, token);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ ok: true, edicts: saved }, null, 2) }],
      };
    },
  );

  server.registerTool(
    "gambit_toggle",
    {
      description: "Enable or disable a gambit without removing it.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        edictId: z.string().describe("ID of the gambit to toggle"),
        enabled: z.boolean().describe("New enabled state"),
      },
    },
    async ({ sessionId, edictId, enabled }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const current = await readEdicts(walletAddress, token);
      const next = current.map((e) => (e.id === edictId ? { ...e, enabled } : e));
      const saved = await writeEdicts(next, token);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ ok: true, edicts: saved }, null, 2) }],
      };
    },
  );
}
