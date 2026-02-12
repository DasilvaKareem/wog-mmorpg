import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/health": "http://localhost:3000",
      "/zones": "http://localhost:3000",
      "/state": "http://localhost:3000",
      "/spawn": "http://localhost:3000",
      "/command": "http://localhost:3000",
      "/wallet": "http://localhost:3000",
      "/shop": "http://localhost:3000",
      "/character": "http://localhost:3000",
      "/events": "http://localhost:3000",
      "/techniques": "http://localhost:3000",
      "/v1": "http://localhost:3000",
    },
  },
});
