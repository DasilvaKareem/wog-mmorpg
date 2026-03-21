import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";

const TEST_SHARD_PORT = process.env.TEST_SHARD_PORT || "3001";
const SHARD_URL = process.env.SHARD_URL || `http://127.0.0.1:${TEST_SHARD_PORT}`;
const VERBOSE = process.env.FULL_FLOW_VERBOSE === "true";
const HARDHAT_RPC = process.env.HARDHAT_RPC_URL || "http://127.0.0.1:8545";
const DEFAULT_ENV: Record<string, string> = {
  DEV: "true",
  REDIS_ALLOW_MEMORY_FALLBACK: "true",
  LOCAL_TEST_MODE: "core",
  JWT_SECRET: process.env.JWT_SECRET || "local-dev-jwt-secret",
  SHARD_URL,
  PORT: TEST_SHARD_PORT,
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
  if (stdio === "ignore") {
    child.unref();
  }
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
      // Kill the full process group so shell wrappers and children also stop.
      process.kill(-child.pid, signal);
    } catch {
      return;
    }
    const exited = await waitExit(signal === "SIGKILL" ? 2000 : 4000);
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

async function waitFor(check: () => Promise<boolean>, label: string, timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await sleep(750);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main(): Promise<void> {
  const shardDir = process.cwd();
  const testsDir = path.join(shardDir, "tests");
  const repoRoot = path.resolve(shardDir, "..");
  const hardhatDir = path.join(repoRoot, "hardhat");
  const env = { ...process.env, ...DEFAULT_ENV };

  let startedHardhat: ChildProcess | null = null;
  let startedShard: ChildProcess | null = null;

  try {
    console.log("[full-flow] Running Hardhat contract tests...");
    await run("npm", ["test"], hardhatDir, env);

    if (!(await isHardhatUp())) {
      console.log("[full-flow] Hardhat RPC not detected. Starting local node...");
      startedHardhat = startBackground("npm", ["run", "node"], hardhatDir, env);
      await waitFor(isHardhatUp, "Hardhat RPC");
    } else {
      console.log("[full-flow] Hardhat RPC already running.");
    }

    console.log("[full-flow] Deploying local contracts to Hardhat...");
    await run("npm", ["run", "deploy:localhost"], hardhatDir, env);

    if (!(await isShardUp())) {
      console.log("[full-flow] Shard API not detected. Starting shard server...");
      startedShard = startBackground("npm", ["run", "dev"], shardDir, env);
      await waitFor(isShardUp, "shard health endpoint");
    } else {
      console.log("[full-flow] Shard API already running.");
    }

    const testFiles = readdirSync(testsDir)
      .filter((name) => name.endsWith(".test.ts"))
      .sort();
    if (testFiles.length === 0) {
      throw new Error("No *.test.ts files found in shard/tests");
    }

    console.log(`[full-flow] Running shard test suite (${testFiles.length} files)...`);
    for (const fileName of testFiles) {
      console.log(`[full-flow] -> ${fileName}`);
      await run("npx", ["tsx", `tests/${fileName}`], shardDir, env);
    }
  } finally {
    await stopBackground(startedShard, "shard");
    await stopBackground(startedHardhat, "hardhat");
  }
}

main().catch((err) => {
  console.error("[full-flow] Failed:", err);
  process.exit(1);
});
