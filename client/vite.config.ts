import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Use production API URL if VITE_API_URL is set, otherwise localhost for dev
const API_URL = process.env.VITE_API_URL || "http://localhost:3000";
const API_PROXY_PATHS = [
  "/health",
  "/zones",
  "/state",
  "/spawn",
  "/command",
  "/wallet",
  "/shop",
  "/character",
  "/events",
  "/techniques",
  "/x402",
  "/v1",
  "/v2",
  "/leaderboard",
  "/api",
  "/equipment",
  "/auth",
  "/herbalism",
  "/mining",
  "/alchemy",
  "/cooking",
  "/crafting",
  "/enchanting",
  "/leatherworking",
  "/jewelcrafting",
  "/professions",
  "/guild",
  "/guilds",
  "/trade",
  "/trades",
  "/transition",
  "/portals",
  "/auctionhouse",
  "/chat",
  "/skinning",
  "/quests",
  "/party",
  "/items",
  "/stats",
  "/logout",
  "/pvp",
  "/predict",
  "/marketplace",
  "/upgrading",
  "/terrain",
  "/chunks",
  "/dungeon",
  "/essence-technique",
  "/agent",
  "/diary",
  "/admin",
  "/notifications",
] as const;

function createApiProxy() {
  return {
    target: API_URL,
    changeOrigin: true,
    configure(proxy: any) {
      proxy.removeAllListeners("error");
      proxy.on("error", (_err: unknown, _req: unknown, res: any) => {
        if (!res || typeof res.writeHead !== "function" || typeof res.end !== "function") return;
        if (!res.headersSent) {
          res.writeHead(503, { "Content-Type": "application/json" });
        }
        res.end(JSON.stringify({ error: "Shard backend unavailable" }));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      onwarn(warning, warn) {
        const message = typeof warning === "string" ? warning : warning.message;
        const id = typeof warning === "string" ? "" : (warning.id ?? "");

        if (
          (message.includes("contains an annotation that Rollup cannot interpret due to the position of the comment") &&
            id.includes("node_modules")) ||
          message.includes("dynamic import will not move module into another chunk")
        ) {
          return;
        }

        warn(warning);
      },
      output: {
        manualChunks: {
          phaser:   ["phaser"],
          wagmi:    ["wagmi", "viem"],
          react:    ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
  server: {
    proxy: Object.fromEntries(API_PROXY_PATHS.map((route) => [route, createApiProxy()])),
  },
});
