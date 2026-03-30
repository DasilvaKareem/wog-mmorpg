import Phaser from "phaser";

import { API_URL } from "@/config";
import { gameBus } from "@/lib/eventBus";
import { playSoundEffect } from "@/lib/soundEffects";

/** Tile size in pixels for arena rendering */
const TILE_PX = 16;

interface ArenaConfig {
  mapId: string;
  name: string;
  tileSet: string;
  width: number;
  height: number;
  spawnPoints: {
    red: Array<{ x: number; y: number }>;
    blue: Array<{ x: number; y: number }>;
  };
  obstacles: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    type: string;
  }>;
  powerUps: Array<{
    x: number;
    y: number;
    type: string;
    respawnTicks: number;
    active: boolean;
  }>;
  hazards: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    type: string;
    damagePerTick: number;
  }>;
}

interface ArenaCombatant {
  id: string;
  name: string;
  pvpTeam: "red" | "blue";
  stats: { hp: number; maxHp: number };
  alive: boolean;
  elo: number;
}

interface BattleStateResponse {
  battleId: string;
  status: "queued" | "betting" | "in_progress" | "completed" | "cancelled";
  config: {
    format: string;
    duration: number;
    arena: ArenaConfig;
    teamRed: ArenaCombatant[];
    teamBlue: ArenaCombatant[];
  };
  winner?: "red" | "blue";
  mvp?: string;
  log: Array<{
    turn: number;
    actorId?: string;
    targetId?: string;
    damage?: number;
    healing?: number;
    killed?: boolean;
  }>;
  statistics: {
    teamRedDamage: number;
    teamBlueDamage: number;
    teamRedKills: number;
    teamBlueKills: number;
  };
}

const COLORS = {
  floor: 0xd4a574,
  floorAlt: 0xc99b65,
  obstacle_pillar: 0x555566,
  obstacle_wall: 0x444455,
  hazard_fire: 0xff4400,
  hazard_spikes: 0x888888,
  hazard_poison: 0x44cc44,
  powerup_health: 0x00ff88,
  powerup_damage: 0xff4444,
  powerup_speed: 0x4488ff,
  team_red: 0xcc3333,
  team_blue: 0x3355cc,
  team_red_dead: 0x661111,
  team_blue_dead: 0x112255,
  hud_bg: 0x0a0f1a,
  hud_text: 0xf1f5ff,
  hud_gold: 0xffcc00,
  border: 0x29334d,
};

export class BattleScene extends Phaser.Scene {
  private battleId = "";
  private arenaGraphics!: Phaser.GameObjects.Graphics;
  private combatantSprites = new Map<string, Phaser.GameObjects.Container>();
  private hudElements: Phaser.GameObjects.GameObject[] = [];
  private timerText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private arenaTitle!: Phaser.GameObjects.Text;
  private battleState: BattleStateResponse | null = null;
  private pollTimer?: Phaser.Time.TimerEvent;
  private lastLogCount = 0;
  private battleComplete = false;
  private returnCountdown = 0;

  constructor() {
    super({ key: "BattleScene" });
  }

  init(data: { battleId: string }): void {
    this.battleId = data.battleId;
    this.battleComplete = false;
    this.returnCountdown = 0;
    this.lastLogCount = 0;
    this.battleState = null;
    this.combatantSprites.clear();
    this.hudElements = [];
    this.pollTimer = undefined;
  }

  create(): void {
    this.arenaGraphics = this.add.graphics();

    // HUD text elements (fixed to camera)
    this.arenaTitle = this.add
      .text(this.cameras.main.width / 2, 16, "Loading Arena...", {
        fontSize: "16px",
        fontFamily: "monospace",
        color: "#ffcc00",
        stroke: "#000000",
        strokeThickness: 4,
        align: "center",
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(200);

    this.timerText = this.add
      .text(this.cameras.main.width / 2, 40, "", {
        fontSize: "24px",
        fontFamily: "monospace",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 4,
        align: "center",
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(200);

    this.statusText = this.add
      .text(this.cameras.main.width / 2, this.cameras.main.height - 40, "", {
        fontSize: "14px",
        fontFamily: "monospace",
        color: "#54f28b",
        stroke: "#000000",
        strokeThickness: 3,
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(200);

    // Handle resize
    this.scale.on("resize", (gameSize: Phaser.Structs.Size) => {
      this.arenaTitle.setX(gameSize.width / 2);
      this.timerText.setX(gameSize.width / 2);
      this.statusText.setPosition(gameSize.width / 2, gameSize.height - 40);
    });

    // Start polling battle state
    void this.pollBattle();
    this.pollTimer = this.time.addEvent({
      delay: 2000,
      callback: () => void this.pollBattle(),
      loop: true,
    });

    // ESC to go back early (only if battle is complete)
    const escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    escKey.on("down", () => {
      if (this.battleComplete) {
        this.returnToWorld();
      }
    });
  }

  private async pollBattle(): Promise<void> {
    try {
      const response = await fetch(`${API_URL}/api/pvp/battle/${this.battleId}`);
      if (!response.ok) return;
      const data = await response.json();
      const prevState = this.battleState;
      this.battleState = data.battle;

      if (!prevState && this.battleState) {
        // First load — render the arena
        this.renderArena(this.battleState.config.arena);
        this.arenaTitle.setText(this.battleState.config.arena.name);
        this.centerCamera(this.battleState.config.arena);
        playSoundEffect("combat_battle_start");
      }

      this.updateCombatants();
      this.updateHUD();
      this.updateBattleLog();

      // Check for completion
      if (
        this.battleState &&
        (this.battleState.status === "completed" || this.battleState.status === "cancelled") &&
        !this.battleComplete
      ) {
        this.battleComplete = true;
        this.onBattleEnd();
      }
    } catch (err) {
      console.error("[BattleScene] Poll error:", err);
    }
  }

  private renderArena(arena: ArenaConfig): void {
    const g = this.arenaGraphics;
    g.clear();

    // Draw floor tiles (checkerboard pattern)
    for (let y = 0; y < arena.height; y++) {
      for (let x = 0; x < arena.width; x++) {
        const color = (x + y) % 2 === 0 ? COLORS.floor : COLORS.floorAlt;
        g.fillStyle(color, 1);
        g.fillRect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
      }
    }

    // Arena border
    g.lineStyle(3, COLORS.border, 1);
    g.strokeRect(0, 0, arena.width * TILE_PX, arena.height * TILE_PX);

    // Draw hazards (below obstacles)
    for (const hazard of arena.hazards) {
      const color =
        hazard.type === "fire"
          ? COLORS.hazard_fire
          : hazard.type === "spikes"
            ? COLORS.hazard_spikes
            : COLORS.hazard_poison;
      g.fillStyle(color, 0.35);
      g.fillRect(
        hazard.x * TILE_PX,
        hazard.y * TILE_PX,
        hazard.width * TILE_PX,
        hazard.height * TILE_PX,
      );
      g.lineStyle(1, color, 0.6);
      g.strokeRect(
        hazard.x * TILE_PX,
        hazard.y * TILE_PX,
        hazard.width * TILE_PX,
        hazard.height * TILE_PX,
      );
    }

    // Draw obstacles
    for (const obs of arena.obstacles) {
      const color =
        obs.type === "pillar" ? COLORS.obstacle_pillar : COLORS.obstacle_wall;
      g.fillStyle(color, 1);
      g.fillRect(
        obs.x * TILE_PX,
        obs.y * TILE_PX,
        obs.width * TILE_PX,
        obs.height * TILE_PX,
      );
      // Top highlight
      g.fillStyle(0xffffff, 0.15);
      g.fillRect(obs.x * TILE_PX, obs.y * TILE_PX, obs.width * TILE_PX, 2);
      // Shadow
      g.fillStyle(0x000000, 0.3);
      g.fillRect(
        obs.x * TILE_PX,
        (obs.y + obs.height) * TILE_PX - 2,
        obs.width * TILE_PX,
        2,
      );
    }

    // Draw power-ups
    for (const pu of arena.powerUps) {
      const color =
        pu.type === "health"
          ? COLORS.powerup_health
          : pu.type === "damage"
            ? COLORS.powerup_damage
            : COLORS.powerup_speed;
      const cx = pu.x * TILE_PX + TILE_PX / 2;
      const cy = pu.y * TILE_PX + TILE_PX / 2;

      // Glow
      g.fillStyle(color, 0.2);
      g.fillCircle(cx, cy, TILE_PX * 0.8);
      // Core
      g.fillStyle(color, 0.8);
      g.fillCircle(cx, cy, TILE_PX * 0.35);
    }

    // Draw spawn point markers
    for (const sp of arena.spawnPoints.red) {
      g.lineStyle(1, COLORS.team_red, 0.5);
      g.strokeCircle(sp.x * TILE_PX + TILE_PX / 2, sp.y * TILE_PX + TILE_PX / 2, TILE_PX * 0.6);
    }
    for (const sp of arena.spawnPoints.blue) {
      g.lineStyle(1, COLORS.team_blue, 0.5);
      g.strokeCircle(sp.x * TILE_PX + TILE_PX / 2, sp.y * TILE_PX + TILE_PX / 2, TILE_PX * 0.6);
    }
  }

  private centerCamera(arena: ArenaConfig): void {
    const cam = this.cameras.main;
    const arenaPixelW = arena.width * TILE_PX;
    const arenaPixelH = arena.height * TILE_PX;

    // Calculate zoom to fit arena with some padding
    const padFactor = 0.85;
    const zoomX = (cam.width * padFactor) / arenaPixelW;
    const zoomY = (cam.height * padFactor) / arenaPixelH;
    const zoom = Math.min(zoomX, zoomY, 3);

    cam.setZoom(zoom);
    cam.centerOn(arenaPixelW / 2, arenaPixelH / 2);
  }

  private updateCombatants(): void {
    if (!this.battleState) return;

    const allCombatants = [
      ...this.battleState.config.teamRed,
      ...this.battleState.config.teamBlue,
    ];
    const arena = this.battleState.config.arena;

    for (let i = 0; i < allCombatants.length; i++) {
      const c = allCombatants[i];
      let container = this.combatantSprites.get(c.id);

      // Determine spawn position
      const teamSpawns =
        c.pvpTeam === "red" ? arena.spawnPoints.red : arena.spawnPoints.blue;
      const teamIndex =
        c.pvpTeam === "red"
          ? this.battleState.config.teamRed.indexOf(c)
          : this.battleState.config.teamBlue.indexOf(c);
      const spawn = teamSpawns[teamIndex % teamSpawns.length];
      const px = spawn.x * TILE_PX + TILE_PX / 2;
      const py = spawn.y * TILE_PX + TILE_PX / 2;

      if (!container) {
        container = this.createCombatantSprite(c, px, py);
        this.combatantSprites.set(c.id, container);
      }

      // Update HP bar and alive state
      this.updateCombatantVisual(container, c);
    }
  }

  private createCombatantSprite(
    c: ArenaCombatant,
    x: number,
    y: number,
  ): Phaser.GameObjects.Container {
    const container = this.add.container(x, y).setDepth(100);

    // Body circle
    const bodyColor = c.pvpTeam === "red" ? COLORS.team_red : COLORS.team_blue;
    const body = this.add.graphics();
    body.fillStyle(bodyColor, 1);
    body.fillCircle(0, 0, TILE_PX * 0.6);
    body.lineStyle(2, 0xffffff, 0.6);
    body.strokeCircle(0, 0, TILE_PX * 0.6);
    container.add(body);

    // Name label
    const name = this.add
      .text(0, -TILE_PX * 1.2, c.name, {
        fontSize: "8px",
        fontFamily: "monospace",
        color: c.pvpTeam === "red" ? "#ff6666" : "#6688ff",
        stroke: "#000000",
        strokeThickness: 2,
        align: "center",
      })
      .setOrigin(0.5, 1);
    container.add(name);

    // HP bar background
    const hpBg = this.add.graphics();
    hpBg.fillStyle(0x000000, 0.7);
    hpBg.fillRect(-TILE_PX * 0.7, TILE_PX * 0.8, TILE_PX * 1.4, 4);
    container.add(hpBg);

    // HP bar fill
    const hpFill = this.add.graphics();
    container.add(hpFill);

    // Store data references
    container.setData("bodyGraphics", body);
    container.setData("hpFill", hpFill);
    container.setData("nameText", name);

    return container;
  }

  private updateCombatantVisual(
    container: Phaser.GameObjects.Container,
    c: ArenaCombatant,
  ): void {
    const hpFill = container.getData("hpFill") as Phaser.GameObjects.Graphics;
    const bodyGfx = container.getData("bodyGraphics") as Phaser.GameObjects.Graphics;

    // Update HP bar
    hpFill.clear();
    const hpRatio = c.stats.maxHp > 0 ? c.stats.hp / c.stats.maxHp : 0;
    const barWidth = TILE_PX * 1.4 * hpRatio;
    const barColor = hpRatio > 0.5 ? 0x54f28b : hpRatio > 0.25 ? 0xffcc00 : 0xff4d6d;
    hpFill.fillStyle(barColor, 1);
    hpFill.fillRect(-TILE_PX * 0.7, TILE_PX * 0.8, barWidth, 4);

    // Dim dead combatants
    if (!c.alive) {
      container.setAlpha(0.3);
      bodyGfx.clear();
      const deadColor =
        c.pvpTeam === "red" ? COLORS.team_red_dead : COLORS.team_blue_dead;
      bodyGfx.fillStyle(deadColor, 1);
      bodyGfx.fillCircle(0, 0, TILE_PX * 0.6);
      bodyGfx.lineStyle(1, 0x333333, 0.5);
      bodyGfx.strokeCircle(0, 0, TILE_PX * 0.6);

      // X marker for dead
      bodyGfx.lineStyle(2, 0xff0000, 0.6);
      bodyGfx.beginPath();
      bodyGfx.moveTo(-4, -4);
      bodyGfx.lineTo(4, 4);
      bodyGfx.moveTo(4, -4);
      bodyGfx.lineTo(-4, 4);
      bodyGfx.strokePath();
    }
  }

  private updateHUD(): void {
    if (!this.battleState) return;

    const state = this.battleState;

    // Timer
    if (state.status === "in_progress") {
      const turnCount = state.log?.length ?? 0;
      const elapsed = Math.floor(turnCount / 2);
      const remaining = Math.max(0, state.config.duration - elapsed);
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      this.timerText.setText(`${mins}:${secs.toString().padStart(2, "0")}`);
      this.timerText.setColor(remaining <= 30 ? "#ff4d6d" : "#ffffff");
    } else if (state.status === "betting") {
      this.timerText.setText("BETTING PHASE");
      this.timerText.setColor("#ffcc00");
    } else if (state.status === "completed") {
      this.timerText.setText("");
    }

    // Status bar
    const redAlive = state.config.teamRed.filter((c) => c.alive).length;
    const blueAlive = state.config.teamBlue.filter((c) => c.alive).length;
    const redTotal = state.config.teamRed.length;
    const blueTotal = state.config.teamBlue.length;

    let statusLine = `RED ${redAlive}/${redTotal}  |  ${state.config.format.toUpperCase()}  |  BLUE ${blueAlive}/${blueTotal}`;
    statusLine += `   DMG: ${state.statistics.teamRedDamage} vs ${state.statistics.teamBlueDamage}`;

    if (state.status === "completed" && state.winner) {
      statusLine = `${state.winner.toUpperCase()} TEAM WINS!   Press ESC to return`;
      this.statusText.setColor("#ffcc00");
    }

    this.statusText.setText(statusLine);
  }

  private updateBattleLog(): void {
    if (!this.battleState) return;
    const log = this.battleState.log;
    if (log.length <= this.lastLogCount) return;

    // Show new log entries as floating text
    const newEntries = log.slice(this.lastLogCount);
    this.lastLogCount = log.length;

    for (const entry of newEntries) {
      if (!entry.damage && !entry.killed && !entry.healing) continue;

      // Find the target combatant's position to show floating text
      const targetId = entry.targetId ?? entry.actorId;
      if (!targetId) continue;

      const container = this.combatantSprites.get(targetId);
      if (!container) continue;

      let text = "";
      let color = "#ffffff";

      if (entry.killed) {
        text = "KILLED!";
        color = "#ff4d6d";
        playSoundEffect("combat_melee_hit");
      } else if (entry.damage) {
        text = `-${entry.damage}`;
        color = "#ff6666";
        playSoundEffect("combat_melee_hit");
      } else if (entry.healing) {
        text = `+${entry.healing}`;
        color = "#54f28b";
      }

      if (text) {
        const floatText = this.add
          .text(container.x, container.y - TILE_PX * 1.5, text, {
            fontSize: "10px",
            fontFamily: "monospace",
            color,
            stroke: "#000000",
            strokeThickness: 3,
            align: "center",
          })
          .setOrigin(0.5, 1)
          .setDepth(300);

        this.tweens.add({
          targets: floatText,
          y: floatText.y - 20,
          alpha: 0,
          duration: 1500,
          ease: "Power2",
          onComplete: () => floatText.destroy(),
        });
      }
    }
  }

  private onBattleEnd(): void {
    if (!this.battleState) return;
    playSoundEffect("combat_victory");

    const winner = this.battleState.winner;
    if (winner) {
      const winColor = winner === "red" ? "#cc3333" : "#3355cc";
      const winText = this.add
        .text(
          this.cameras.main.width / 2,
          this.cameras.main.height / 2 - 30,
          `${winner.toUpperCase()} TEAM WINS!`,
          {
            fontSize: "28px",
            fontFamily: "monospace",
            color: winColor,
            stroke: "#000000",
            strokeThickness: 5,
            align: "center",
          },
        )
        .setOrigin(0.5, 0.5)
        .setScrollFactor(0)
        .setDepth(500);

      this.hudElements.push(winText);

      // MVP display
      if (this.battleState.mvp) {
        const allCombatants = [
          ...this.battleState.config.teamRed,
          ...this.battleState.config.teamBlue,
        ];
        const mvpCombatant = allCombatants.find(
          (c) => c.id === this.battleState!.mvp,
        );
        if (mvpCombatant) {
          const mvpText = this.add
            .text(
              this.cameras.main.width / 2,
              this.cameras.main.height / 2 + 10,
              `MVP: ${mvpCombatant.name}  +100 GOLD`,
              {
                fontSize: "14px",
                fontFamily: "monospace",
                color: "#ffcc00",
                stroke: "#000000",
                strokeThickness: 3,
                align: "center",
              },
            )
            .setOrigin(0.5, 0.5)
            .setScrollFactor(0)
            .setDepth(500);

          this.hudElements.push(mvpText);
        }
      }
    }

    // Auto-return after 8 seconds
    this.time.delayedCall(8000, () => {
      this.returnToWorld();
    });
  }

  private returnToWorld(): void {
    // Clean up poll timer (game objects auto-destroyed on scene stop)
    if (this.pollTimer) {
      this.pollTimer.remove();
      this.pollTimer = undefined;
    }

    gameBus.emit("battleEnded", { battleId: this.battleId });

    // Wake the sleeping WorldScene instead of restarting it from scratch
    this.scene.wake("WorldScene");
    this.scene.stop();
  }

  update(): void {
    // Currently no per-frame logic needed — battle updates via polling.
    // Arena is rendered once, combatants updated on poll.
  }
}
