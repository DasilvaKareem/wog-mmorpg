import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Use production API URL if VITE_API_URL is set, otherwise localhost for dev
const API_URL = process.env.VITE_API_URL || "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/health": API_URL,
      "/zones": API_URL,
      "/state": API_URL,
      "/spawn": API_URL,
      "/command": API_URL,
      "/wallet": API_URL,
      "/shop": API_URL,
      "/character": API_URL,
      "/events": API_URL,
      "/techniques": API_URL,
      "/x402": API_URL,
      "/v1": API_URL,
      "/v2": API_URL,
      "/leaderboard": API_URL,
      "/api": API_URL,
      "/equipment": API_URL,
      "/auth": API_URL,
      "/herbalism": API_URL,
      "/mining": API_URL,
      "/alchemy": API_URL,
      "/cooking": API_URL,
      "/crafting": API_URL,
      "/enchanting": API_URL,
      "/leatherworking": API_URL,
      "/jewelcrafting": API_URL,
      "/professions": API_URL,
      "/guild": API_URL,
      "/guilds": API_URL,
      "/trade": API_URL,
      "/trades": API_URL,
      "/transition": API_URL,
      "/portals": API_URL,
      "/auctionhouse": API_URL,
      "/chat": API_URL,
      "/skinning": API_URL,
      "/quests": API_URL,
      "/party": API_URL,
      "/world": API_URL,
      "/items": API_URL,
      "/stats": API_URL,
      "/logout": API_URL,
      "/pvp": API_URL,
      "/predict": API_URL,
      "/marketplace": API_URL,
      "/upgrading": API_URL,
      "/terrain": API_URL,
      "/chunks": API_URL,
      "/dungeon": API_URL,
      "/essence-technique": API_URL,
    },
  },
});
