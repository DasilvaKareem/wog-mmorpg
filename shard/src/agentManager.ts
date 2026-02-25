/**
 * AgentManager — singleton that tracks running agent loops per user wallet.
 */

import { AgentRunner } from "./agentRunner.js";
import {
  getAgentConfig,
  getAgentCustodialWallet,
  getAgentEntityRef,
  patchAgentConfig,
} from "./agentConfigStore.js";
import { getAllZones } from "./zoneRuntime.js";
import { getRedis } from "./redis.js";
import { setupAgentCharacter } from "./agentCharacterSetup.js";

const API_URL = process.env.API_URL || "http://localhost:3000";

interface CharacterMetadata {
  name?: string;
  properties?: {
    race?: string;
    class?: string;
  };
}

class AgentManager {
  private loops = new Map<string, AgentRunner>();

  /**
   * Start an agent loop.
   * @param waitForFirstTick  If true, waits for the first game tick to succeed
   *                          before resolving. Throws if the tick fails (bad auth,
   *                          missing entity, etc).
   */
  async start(userWallet: string, waitForFirstTick = false): Promise<void> {
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
    try {
      await runner.start(waitForFirstTick);
      console.log(`[AgentManager] Started agent for ${key.slice(0, 8)}`);
    } catch (err) {
      // First tick failed — clean up the dead runner
      this.loops.delete(key);
      throw err;
    }
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

  getRunner(userWallet: string): AgentRunner | null {
    const key = userWallet.toLowerCase();
    return this.loops.get(key) ?? null;
  }

  private async hasLiveEntity(userWallet: string): Promise<boolean> {
    const key = userWallet.toLowerCase();
    const ref = await getAgentEntityRef(key);
    if (!ref) return false;

    const refZone = getAllZones().get(ref.zoneId);
    if (refZone?.entities.has(ref.entityId)) return true;

    for (const [, zone] of getAllZones()) {
      if (zone.entities.has(ref.entityId)) return true;
    }
    return false;
  }

  private async getPrimaryCharacter(custodialWallet: string): Promise<CharacterMetadata | null> {
    try {
      const res = await fetch(`${API_URL}/character/${custodialWallet}`);
      if (!res.ok) return null;
      const data = await res.json() as { characters?: CharacterMetadata[] };
      return data.characters?.[0] ?? null;
    } catch {
      return null;
    }
  }

  private extractRawName(characterName?: string): string | null {
    if (!characterName) return null;
    const trimmed = characterName.trim();
    if (!trimmed) return null;
    const suffixMatch = trimmed.match(/^(.+?)\s+the\s+\w+$/i);
    return suffixMatch ? suffixMatch[1] : trimmed;
  }

  /**
   * If an enabled agent has no live entity (common after process restart),
   * respawn from its custodial wallet character metadata.
   */
  private async rehydrateMissingEntity(userWallet: string): Promise<boolean> {
    const key = userWallet.toLowerCase();
    if (await this.hasLiveEntity(key)) return true;

    const custodialWallet = await getAgentCustodialWallet(key);
    if (!custodialWallet) {
      console.warn(`[AgentManager] Rehydrate skipped for ${key.slice(0, 8)}: no custodial wallet mapping`);
      return false;
    }

    const character = await this.getPrimaryCharacter(custodialWallet);
    const characterName = this.extractRawName(character?.name);
    const raceId = character?.properties?.race ?? "human";
    const classId = character?.properties?.class ?? "warrior";

    if (!characterName) {
      console.warn(`[AgentManager] Rehydrate skipped for ${key.slice(0, 8)}: no character NFT found`);
      return false;
    }

    try {
      const setup = await setupAgentCharacter(key, characterName, raceId, classId);
      console.log(
        `[AgentManager] Rehydrated ${key.slice(0, 8)}: entity=${setup.entityId} zone=${setup.zoneId}${setup.alreadyExisted ? " [EXISTING]" : " [RESPAWNED]"}`
      );
      return true;
    } catch (err: any) {
      console.warn(`[AgentManager] Rehydrate failed for ${key.slice(0, 8)}: ${err.message?.slice(0, 120)}`);
      return false;
    }
  }

  /**
   * Self-healing check: if agent should be running (config.enabled + entity in zone)
   * but isn't, restart it. Called from the status endpoint so polling auto-heals.
   * Returns true if the agent is running after the check.
   */
  async ensureRunning(userWallet: string): Promise<boolean> {
    const key = userWallet.toLowerCase();

    // Already running — nothing to do
    const existing = this.loops.get(key);
    if (existing?.running) return true;

    // Check if agent *should* be running
    const config = await getAgentConfig(key);
    if (!config?.enabled) return false;

    let found = await this.hasLiveEntity(key);
    if (!found) {
      found = await this.rehydrateMissingEntity(key);
    }
    if (!found) return false;

    // Agent should be running but isn't — restart
    console.log(`[AgentManager] Self-heal: restarting agent for ${key.slice(0, 8)} (was dead but enabled + entity alive)`);
    try {
      await this.start(key, true);
      return true;
    } catch (err: any) {
      console.warn(`[AgentManager] Self-heal restart failed for ${key.slice(0, 8)}: ${err.message?.slice(0, 80)}`);
      return false;
    }
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
    let failed = 0;
    for (const key of keys) {
      try {
        const raw = await redis.get(key);
        if (!raw) continue;
        const config = JSON.parse(raw);
        if (!config.enabled) continue;

        const userWallet = key.replace("agent:config:", "");
        const rehydrated = await this.rehydrateMissingEntity(userWallet);
        if (!rehydrated) {
          failed++;
          console.warn(`[AgentManager] Boot restore skipped for ${userWallet.slice(0, 8)}: could not rehydrate entity`);
          continue;
        }
        await this.start(userWallet, true);
        restored++;
      } catch (err: any) {
        failed++;
        const wallet = key.replace("agent:config:", "").slice(0, 8);
        console.warn(`[AgentManager] Boot restore failed for ${wallet}: ${err.message?.slice(0, 80)}`);
      }
    }

    console.log(`[AgentManager] Boot restore: ${restored} resumed, ${failed} failed (will self-heal on status poll)`);
  }
}

export const agentManager = new AgentManager();
