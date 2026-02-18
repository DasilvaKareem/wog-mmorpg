/**
 * AgentManager — singleton that tracks running agent loops per user wallet.
 */

import { AgentRunner } from "./agentRunner.js";
import { patchAgentConfig } from "./agentConfigStore.js";
import { getRedis } from "./redis.js";

class AgentManager {
  private loops = new Map<string, AgentRunner>();

  async start(userWallet: string): Promise<void> {
    const key = userWallet.toLowerCase();
    if (this.loops.has(key)) {
      const existing = this.loops.get(key)!;
      if (existing.running) {
        console.log(`[AgentManager] Agent ${key.slice(0, 8)} already running`);
        return;
      }
      this.loops.delete(key);
    }

    const runner = new AgentRunner(key);
    this.loops.set(key, runner);
    await runner.start();
    console.log(`[AgentManager] Started agent for ${key.slice(0, 8)}`);
  }

  async stop(userWallet: string): Promise<void> {
    const key = userWallet.toLowerCase();
    const runner = this.loops.get(key);
    if (runner) {
      runner.stop();
      this.loops.delete(key);
    }
    // Persist disabled state
    await patchAgentConfig(key, { enabled: false });
    console.log(`[AgentManager] Stopped agent for ${key.slice(0, 8)}`);
  }

  isRunning(userWallet: string): boolean {
    const key = userWallet.toLowerCase();
    const runner = this.loops.get(key);
    return runner?.running === true;
  }

  async stopAll(): Promise<void> {
    console.log(`[AgentManager] Stopping all ${this.loops.size} agents`);
    for (const [key, runner] of this.loops) {
      runner.stop();
    }
    this.loops.clear();
  }

  listRunning(): string[] {
    return Array.from(this.loops.entries())
      .filter(([, r]) => r.running)
      .map(([k]) => k);
  }

  /**
   * On server boot: scan Redis for all agent:config:* keys with enabled=true
   * and restart those loops. Called once from server.ts after Redis is ready.
   */
  async restoreFromRedis(): Promise<void> {
    const redis = getRedis();
    if (!redis) {
      console.log("[AgentManager] No Redis — skipping boot restore");
      return;
    }

    let keys: string[] = [];
    try {
      keys = await redis.keys("agent:config:*");
    } catch (err: any) {
      console.warn("[AgentManager] Boot restore scan failed:", err.message);
      return;
    }

    let restored = 0;
    for (const key of keys) {
      try {
        const raw = await redis.get(key);
        if (!raw) continue;
        const config = JSON.parse(raw);
        if (!config.enabled) continue;

        const userWallet = key.replace("agent:config:", "");
        await this.start(userWallet);
        restored++;
      } catch {}
    }

    console.log(`[AgentManager] Boot restore: ${restored} agent(s) resumed from Redis`);
  }
}

export const agentManager = new AgentManager();
