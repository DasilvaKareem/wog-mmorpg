import type { Entity } from "../types.js";

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

/**
 * Canvas-based minimap overlay in the top-right corner.
 * Shows entity dots on a dark background.
 */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private zoneWidth = 640;
  private zoneHeight = 640;

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

  update(entities: Record<string, Entity>, cameraX?: number, cameraZ?: number) {
    const ctx = this.ctx;
    const scale = SIZE / this.zoneWidth;

    // Background
    ctx.fillStyle = "rgba(10, 12, 18, 0.85)";
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Entity dots
    for (const ent of Object.values(entities)) {
      const color = TYPE_DOT_COLORS[ent.type] ?? "#666";
      const px = ent.x * scale;
      const py = ent.y * scale;
      const radius = ent.type === "boss" ? 3 : ent.type === "player" ? 2 : 1.5;

      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    // Camera indicator
    if (cameraX !== undefined && cameraZ !== undefined) {
      const cx = cameraX * scale;
      const cy = cameraZ * scale;
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 15, cy - 10, 30, 20);
    }
  }
}
