import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isProd = mode === "production";
  const apiUrl =
    env.VITE_API_URL ||
    env.API_URL ||
    (isProd ? "https://wog.urbantech.dev" : "http://localhost:3003");

<<<<<<< HEAD
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
      "/agent": API_URL,
      "/wallet": API_URL,
      "/chat": API_URL,
      "/inbox": API_URL,
      "/time": API_URL,
=======
  return {
    base: isProd ? "/xr/" : "./",
    server: {
      port: 5174,
      proxy: {
        "/zones": apiUrl,
        "/players": apiUrl,
        "/v1": apiUrl,
        "/v2": apiUrl,
        "/world": apiUrl,
        "/character": apiUrl,
        "/spawn": apiUrl,
        "/command": apiUrl,
        "/auth": apiUrl,
        "/time": apiUrl,
      },
>>>>>>> 9fffce2ab724d31b857c8621bfc401f48a43a5ef
    },
  };
});
