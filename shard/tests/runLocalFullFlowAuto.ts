import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import Redis from "ioredis";

const TEST_SHARD_PORT = process.env.TEST_SHARD_PORT || "3001";
const SHARD_URL = process.env.SHARD_URL || `http://127.0.0.1:${TEST_SHARD_PORT}`;
const HARDHAT_RPC = process.env.HARDHAT_RPC_URL || "http://127.0.0.1:8545";
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379/15";
const VERBOSE = process.env.FULL_FLOW_VERBOSE === "true";
const REDIS_CONTAINER_NAME = process.env.TEST_REDIS_CONTAINER_NAME || "wog-test-redis";

const DEFAULT_ENV: Record<string, string> = {
  DEV: "true",
  REDIS_URL,
  JWT_SECRET: process.env.JWT_SECRET || "local-dev-jwt-secret",
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef",
  SERVER_PRIVATE_KEY:
    process.env.SERVER_PRIVATE_KEY ||
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  SHARD_URL,
  PORT: TEST_SHARD_PORT,
  TEST_SHARD_PORT,
  HARDHAT_RPC_URL: HARDHAT_RPC,
};

type ServiceHandle = {
  child: ChildProcess | null;
  startedByRunner: boolean;
};

function run(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: "inherit",
      shell: false,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} failed with exit code ${code}`));
    });
    child.on("error", reject);
  });
}

function startBackground(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  quiet = true
): ChildProcess {
  const stdio = quiet && !VERBOSE ? "ignore" : "inherit";
  const child = spawn(cmd, args, {
    cwd,
    env,
    stdio,
    detached: true,
    shell: false,
  });
  if (stdio === "ignore") child.unref();
  return child;
}

async function stopBackground(child: ChildProcess | null, label: string): Promise<void> {
  if (!child?.pid) return;

  const waitExit = (timeoutMs: number) =>
    new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });

  for (const signal of ["SIGINT", "SIGTERM", "SIGKILL"] as const) {
    try {
      process.kill(-child.pid, signal);
    } catch {
      return;
    }
    const exited = await waitExit(signal === "SIGKILL" ? 2_000 : 4_000);
    if (exited) return;
  }

  console.warn(`[full-flow] ${label} did not exit cleanly`);
}

async function isHardhatUp(): Promise<boolean> {
  try {
    const res = await fetch(HARDHAT_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { result?: string };
    return Boolean(body.result);
  } catch {
    return false;
  }
}

async function isShardUp(): Promise<boolean> {
  try {
    const res = await fetch(`${SHARD_URL}/health`);
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

async function isRedisUp(): Promise<boolean> {
  const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableReadyCheck: true });
  try {
    await redis.connect();
    const pong = await redis.ping();
    return pong === "PONG";
  } catch {
    return false;
  } finally {
    await redis.quit().catch(() => {});
    redis.disconnect();
  }
}

async function resetRedisDb(): Promise<void> {
  const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableReadyCheck: true });
  try {
    await redis.connect();
    await redis.flushdb();
  } finally {
    await redis.quit().catch(() => {});
    redis.disconnect();
  }
}

async function waitFor(check: () => Promise<boolean>, label: string, timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await sleep(750);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function ensureDockerRedis(repoRoot: string, env: NodeJS.ProcessEnv): Promise<ServiceHandle> {
  if (await isRedisUp()) {
    console.log("[full-flow] Redis already running.");
    return { child: null, startedByRunner: false };
  }

  console.log("[full-flow] Redis not detected. Starting docker Redis...");
  try {
    await run("docker", ["rm", "-f", REDIS_CONTAINER_NAME], repoRoot, env).catch(() => {});
    await run(
      "docker",
      ["run", "-d", "--rm", "--name", REDIS_CONTAINER_NAME, "-p", "6379:6379", "redis:7-alpine"],
      repoRoot,
      env
    );
  } catch (err) {
    throw new Error(`Failed to start Redis container ${REDIS_CONTAINER_NAME}: ${String(err)}`);
  }

  await waitFor(isRedisUp, "Redis");
  return { child: null, startedByRunner: true };
}

async function stopDockerRedisIfStarted(handle: ServiceHandle, repoRoot: string, env: NodeJS.ProcessEnv): Promise<void> {
  if (!handle.startedByRunner) return;
  await run("docker", ["rm", "-f", REDIS_CONTAINER_NAME], repoRoot, env).catch(() => {});
}

async function ensureHardhat(hardhatDir: string, env: NodeJS.ProcessEnv): Promise<ServiceHandle> {
  if (await isHardhatUp()) {
    console.log("[full-flow] Hardhat RPC already running.");
    return { child: null, startedByRunner: false };
  }

  console.log("[full-flow] Hardhat RPC not detected. Starting local node...");
  const child = startBackground("npm", ["run", "node"], hardhatDir, env);
  await waitFor(isHardhatUp, "Hardhat RPC");
  return { child, startedByRunner: true };
}

async function ensureShard(shardDir: string, env: NodeJS.ProcessEnv): Promise<ServiceHandle> {
  if (await isShardUp()) {
    throw new Error(
      `Shard test port ${TEST_SHARD_PORT} is already in use. Stop the existing shard or set TEST_SHARD_PORT to a free port.`
    );
  }

  console.log(`[full-flow] Starting shard on ${SHARD_URL}...`);
  const child = startBackground("pnpm", ["run", "dev"], shardDir, env);
  await waitFor(isShardUp, "shard health endpoint");
  return { child, startedByRunner: true };
}

async function stopShard(handle: ServiceHandle): Promise<void> {
  if (!handle.startedByRunner) return;
  await stopBackground(handle.child, "shard");
}

async function main(): Promise<void> {
  const shardDir = process.cwd();
  const repoRoot = path.resolve(shardDir, "..");
  const hardhatDir = path.join(repoRoot, "hardhat");
  const env = { ...process.env, ...DEFAULT_ENV };

  let redisHandle: ServiceHandle = { child: null, startedByRunner: false };
  let hardhatHandle: ServiceHandle = { child: null, startedByRunner: false };
  let shardHandle: ServiceHandle = { child: null, startedByRunner: false };

  try {
    redisHandle = await ensureDockerRedis(repoRoot, env);
    console.log(`[full-flow] Resetting Redis test DB at ${REDIS_URL}...`);
    await resetRedisDb();

    console.log("[full-flow] Running Hardhat contract tests...");
    await run("npm", ["test"], hardhatDir, env);

    hardhatHandle = await ensureHardhat(hardhatDir, env);

    console.log("[full-flow] Deploying local contracts to Hardhat...");
    await run("npm", ["run", "deploy:localhost"], hardhatDir, env);

    console.log("[full-flow] Running queue/store recovery suite...");
    await run("pnpm", ["run", "test:chain-ops"], shardDir, env);

    shardHandle = await ensureShard(shardDir, env);

    console.log("[full-flow] Running shard-dependent suites with shard up...");
    await run("pnpm", ["run", "test:character-bootstrap"], shardDir, env);
    await run("pnpm", ["run", "test:erc8004"], shardDir, {
      ...env,
      REDIS_ALLOW_MEMORY_FALLBACK: "true",
      LOCAL_TEST_MODE: "core",
    });

    console.log("[full-flow] Stopping shard before isolated reconciliation replay suite...");
    await stopShard(shardHandle);
    shardHandle = { child: null, startedByRunner: false };

    console.log("[full-flow] Running isolated chain reconciliation recovery suite...");
    await run("pnpm", ["run", "test:chain-recovery"], shardDir, env);
    console.log("[full-flow] Running isolated blockchain write processor recovery suite...");
    await run("pnpm", ["run", "test:blockchain-writes"], shardDir, env);

    console.log("[full-flow] All local full-flow suites passed.");
  } finally {
    await stopShard(shardHandle);
    if (hardhatHandle.startedByRunner) {
      await stopBackground(hardhatHandle.child, "hardhat");
    }
    await stopDockerRedisIfStarted(redisHandle, repoRoot, env);
  }
}

main().catch((err) => {
  console.error("[full-flow] Failed:", err);
  process.exit(1);
});
