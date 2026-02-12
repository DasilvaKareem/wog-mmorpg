import { randomUUID } from "node:crypto";
import type { Combatant } from "../types/battle.js";
import type { WorldAgentTemplate } from "../types/world-agent.js";
import type { PartyManager } from "./party-manager.js";
import { BattleEngine } from "./battle-engine.js";

/** Default stats for an AI agent player (before equipment bonuses) */
const DEFAULT_PLAYER_STATS = {
  maxHp: 100,
  hp: 100,
  attack: 15,
  defense: 8,
  speed: 30,
};

/** XP reward per enemy = threat * 10 + health * 0.1 + attack * 2 */
function computeEnemyXp(template: WorldAgentTemplate): number {
  return Math.round(template.threat * 10 + template.health * 0.1 + template.attack * 2);
}

function buildPlayerCombatant(id: string, name: string): Combatant {
  return {
    id,
    name,
    team: "party",
    stats: { ...DEFAULT_PLAYER_STATS },
    statuses: [],
    nextActTime: 0,
    alive: true,
  };
}

export class BattleManager {
  private battles: Map<string, BattleEngine> = new Map();
  private templates: Map<string, WorldAgentTemplate>;
  private parties: PartyManager;

  constructor(templates: Map<string, WorldAgentTemplate>, parties: PartyManager) {
    this.templates = templates;
    this.parties = parties;
  }

  /**
   * Start a battle. If the initiator is in a party, all party members join as combatants.
   * enemyTemplateIds: list of template IDs to spawn as enemies.
   */
  startBattle(playerId: string, playerName: string, enemyTemplateIds: string[]): BattleEngine | string {
    // Check if player is in a party — if so, all members fight
    const partyView = this.parties.getAgentParty(playerId);
    const partyCombatants: Combatant[] = [];

    if (partyView) {
      for (const member of partyView.members) {
        partyCombatants.push(buildPlayerCombatant(member.agentId, member.name));
      }
    } else {
      // Solo battle
      partyCombatants.push(buildPlayerCombatant(playerId, playerName));
    }

    // Build enemy combatants from templates
    const enemies: Combatant[] = [];
    const enemyXpValues = new Map<string, number>();

    for (const tid of enemyTemplateIds) {
      const template = this.templates.get(tid);
      if (!template) return `unknown template: ${tid}`;

      const enemyId = `enemy-${randomUUID().slice(0, 8)}`;
      const xp = computeEnemyXp(template);

      enemies.push({
        id: enemyId,
        name: template.name,
        team: "enemy",
        stats: {
          maxHp: template.health,
          hp: template.health,
          attack: template.attack,
          defense: template.defense,
          speed: template.battleSpeed,
        },
        statuses: [],
        nextActTime: 0,
        alive: true,
      });

      enemyXpValues.set(enemyId, xp);
    }

    if (enemies.length === 0) return "no enemies specified";

    const battleId = randomUUID();
    const engine = new BattleEngine(battleId, partyCombatants, enemies, enemyXpValues);
    this.battles.set(battleId, engine);

    const partyNames = partyCombatants.map((c) => c.name).join(", ");
    const enemyNames = enemies.map((e) => e.name).join(", ");
    console.log(`[BattleManager] Battle ${battleId}: [${partyNames}] vs [${enemyNames}]`);

    return engine;
  }

  getBattle(battleId: string): BattleEngine | undefined {
    return this.battles.get(battleId);
  }

  /** Remove finished battles */
  cleanup(): void {
    for (const [id, engine] of this.battles) {
      if (engine.phase !== "awaiting_action") {
        this.battles.delete(id);
      }
    }
  }

  get activeBattleCount(): number {
    return this.battles.size;
  }
}
