import { defineConfig } from "vite";

const API_URL = process.env.VITE_API_URL || "https://wog.urbantech.dev";
const isProd = process.env.NODE_ENV === "production";

export default defineConfig({
  base: isProd ? "/xr/" : "./",
  server: {
    port: 5174,
    proxy: {
      "/zones": API_URL,
      "/players": API_URL,
      "/v1": API_URL,
      "/v2": API_URL,
      "/world": API_URL,
      "/character": API_URL,
      "/spawn": API_URL,
      "/command": API_URL,
      "/auth": API_URL,
      "/time": API_URL,
    },
  },
});
