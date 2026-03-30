import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isProd = mode === "production";
  const apiUrl =
    env.VITE_API_URL ||
    env.API_URL ||
    (isProd ? "https://wog.urbantech.dev" : "http://localhost:3003");

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
    },
  };
});
