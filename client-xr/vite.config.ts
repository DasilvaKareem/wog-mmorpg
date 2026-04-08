import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isProd = mode === "production";
  const apiUrl =
    env.VITE_API_URL ||
    env.API_URL ||
    (isProd ? "https://wog.urbantech.dev" : "https://wog.urbantech.dev");

  const proxyOpts = { target: apiUrl, changeOrigin: true, secure: true };

  return {
    base: isProd ? "/xr/" : "./",
    server: {
      port: 5174,
      proxy: {
        "/zones": proxyOpts,
        "/players": proxyOpts,
        "/v1": proxyOpts,
        "/v2": proxyOpts,
        "/world": proxyOpts,
        "/character": proxyOpts,
        "/spawn": proxyOpts,
        "/command": proxyOpts,
        "/auth": proxyOpts,
        "/agent": proxyOpts,
        "/wallet": proxyOpts,
        "/chat": proxyOpts,
        "/inbox": proxyOpts,
        "/time": proxyOpts,
      },
    },
  };
});
