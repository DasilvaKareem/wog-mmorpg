import type { Entity, GameTime } from "../types.js";

const SIZE = 160;
const PADDING = 12;

const TYPE_DOT_COLORS: Record<string, string> = {
  player: "#44ddff",
  mob: "#cc4444",
  boss: "#aa33ff",
  npc: "#4488ff",
  merchant: "#ffcc00",
  "quest-giver": "#66bbff",
};

const PHASE_ICONS: Record<string, string> = {
  dawn: "\u263C",     // ☼
  day: "\u2600",      // ☀
  dusk: "\u263D",     // ☽
  night: "\u2605",    // ★
};

/**
 * Canvas-based minimap overlay in the top-right corner.
 * Shows entity dots on a dark background with server time.
 */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** Visible range in server coords centered on camera */
  private viewRange = 800;
  private gameTime: GameTime | null = null;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.canvas.style.cssText = `
      position: fixed;
      top: ${PADDING}px;
      right: ${PADDING}px;
      width: ${SIZE}px;
      height: ${SIZE}px;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 6px;
      z-index: 10;
      pointer-events: none;
      image-rendering: pixelated;
    `;
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
  }

  setGameTime(gt: GameTime) {
    this.gameTime = gt;
  }

  update(entities: Record<string, Entity>, cameraSX?: number, cameraSZ?: number) {
    const ctx = this.ctx;
    const cx = cameraSX ?? 320;
    const cz = cameraSZ ?? 320;
    const half = this.viewRange / 2;

    // Background
    ctx.fillStyle = "rgba(10, 12, 18, 0.85)";
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Entity dots (positions in server coords)
    for (const ent of Object.values(entities)) {
      const rx = ent.x - (cx - half);
      const ry = ent.y - (cz - half);
      if (rx < 0 || rx > this.viewRange || ry < 0 || ry > this.viewRange) continue;

      const px = (rx / this.viewRange) * SIZE;
      const py = (ry / this.viewRange) * SIZE;
      const color = TYPE_DOT_COLORS[ent.type] ?? "#666";
      const radius = ent.type === "boss" ? 3 : ent.type === "player" ? 2 : 1.5;

      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    // Camera crosshair at center
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1;
    const mid = SIZE / 2;
    ctx.beginPath();
    ctx.moveTo(mid - 6, mid);
    ctx.lineTo(mid + 6, mid);
    ctx.moveTo(mid, mid - 6);
    ctx.lineTo(mid, mid + 6);
    ctx.stroke();

    // Server time in bottom-left of minimap
    if (this.gameTime) {
      const hh = String(this.gameTime.hour).padStart(2, "0");
      const mm = String(this.gameTime.minute).padStart(2, "0");
      const icon = PHASE_ICONS[this.gameTime.phase] ?? "";
      const label = `${icon} ${hh}:${mm}`;

      ctx.font = "bold 11px monospace";
      const tw = ctx.measureText(label).width;

      // Background pill
      const px = 4;
      const py = SIZE - 6;
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.beginPath();
      ctx.roundRect(px - 2, py - 11, tw + 6, 14, 3);
      ctx.fill();

      // Text — tint by phase
      const phaseColor =
        this.gameTime.phase === "night" ? "#8888cc" :
        this.gameTime.phase === "dawn" ? "#ffaa55" :
        this.gameTime.phase === "dusk" ? "#dd8844" :
        "#eedd77";
      ctx.fillStyle = phaseColor;
      ctx.fillText(label, px + 1, py);
    }
  }
}
