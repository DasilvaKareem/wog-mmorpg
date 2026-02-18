import "dotenv/config";
import express from "express";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 3001);
const API_KEY = process.env.MCP_API_KEY;

const app = express();
app.use(express.json());

// Optional API key guard — set MCP_API_KEY in .env to enable
function checkApiKey(req: express.Request, res: express.Response): boolean {
  if (!API_KEY) return true; // disabled
  const key = req.headers["x-api-key"] as string | undefined;
  if (key === API_KEY) return true;
  res.status(401).json({ error: "Invalid or missing x-api-key header" });
  return false;
}

// Map sessionId → transport so we can reuse connections
const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", async (req, res) => {
  if (!checkApiKey(req, res)) return;

  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // Reuse existing transport for this session
  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // New connection — must start with an initialize request
  if (!isInitializeRequest(req.body)) {
    res.status(400).json({ error: "Expected initialize request for new session" });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      transports.set(id, transport);
    },
  });

  // Clean up when the client disconnects
  transport.onclose = () => {
    const id = transport.sessionId;
    if (id) transports.delete(id);
  };

  const server = createMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// SSE-based GET endpoint (for clients that prefer streaming)
app.get("/mcp", async (req, res) => {
  if (!checkApiKey(req, res)) return;

  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: "No active session. POST to /mcp first." });
    return;
  }

  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res);
});

// Graceful cleanup on DELETE
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    transports.delete(sessionId);
  } else {
    res.status(404).json({ error: "Session not found" });
  }
});

// Health check
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    activeSessions: transports.size,
    shardUrl: process.env.SHARD_URL ?? "http://localhost:3000",
  });
});

app.listen(PORT, () => {
  console.log(`WoG MCP server running on http://localhost:${PORT}/mcp`);
  console.log(`Shard URL: ${process.env.SHARD_URL ?? "http://localhost:3000"}`);
  if (API_KEY) {
    console.log("API key auth: enabled");
  } else {
    console.log("API key auth: disabled (set MCP_API_KEY to enable)");
  }
});
