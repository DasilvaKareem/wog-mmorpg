import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isProd = mode === "production";
  const apiUrl =
    env.DEV_PROXY_URL ||
    env.VITE_API_URL ||
    env.API_URL ||
    "http://127.0.0.1:3000";

  const proxyOpts = { target: apiUrl, changeOrigin: true, secure: true };

  return {
    base: isProd ? "/xr/" : "./",
    build: {
      rollupOptions: {
        input: {
          index: resolve(process.cwd(), "index.html"),
          controller: resolve(process.cwd(), "controller.html"),
          display: resolve(process.cwd(), "display.html"),
        },
      },
    },
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
