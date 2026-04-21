import type { Entity, WorldLayout } from "../types.js";

const TYPE_DOT_COLORS: Record<string, string> = {
  player: "#44ddff",
  mob: "#cc4444",
  boss: "#aa33ff",
  npc: "#4488ff",
  merchant: "#ffcc00",
  "quest-giver": "#66bbff",
};

/**
 * Full-screen world map overlay. Toggle with M or Escape.
 * Renders every zone as a labeled rectangle on the unified
 * server-coordinate grid with live entity dots and player marker.
 */
export class WorldMap {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layout: WorldLayout | null = null;

  private entities: Record<string, Entity> = {};
  private playerEntity: Entity | null = null;
  private cameraSX = 0;
  private cameraSZ = 0;

  private isOpenState = false;

  // view transform (server coords → screen px)
  private scale = 1;
  private fitScale = 1;
  private offsetX = 0;
  private offsetY = 0;

  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOrigX = 0;
  private dragOrigY = 0;
  private hasDragged = false;

  private rafHandle: number | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "world-map";
    this.root.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 100;
      background: rgba(5, 8, 14, 0.94);
      display: none;
      cursor: grab;
    `;

    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = `width: 100%; height: 100%; display: block;`;
    this.root.appendChild(this.canvas);

    const hint = document.createElement("div");
    hint.style.cssText = `
      position: absolute;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      color: rgba(255,255,255,0.7);
      font: 12px monospace;
      padding: 6px 12px;
      background: rgba(0,0,0,0.5);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 4px;
      pointer-events: none;
    `;
    hint.textContent = "M or Esc to close · drag to pan · scroll to zoom";
    this.root.appendChild(hint);

    document.body.appendChild(this.root);
    this.ctx = this.canvas.getContext("2d")!;

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("resize", this.onResize);
  }

  setLayout(layout: WorldLayout) {
    this.layout = layout;
    this.recomputeFit();
    this.scale = this.fitScale;
    this.recenter();
  }

  isOpen() {
    return this.isOpenState;
  }

  toggle() {
    if (this.isOpenState) this.close();
    else this.open();
  }

  open() {
    if (this.isOpenState) return;
    this.isOpenState = true;
    this.root.style.display = "block";
    this.resize();
    this.recomputeFit();
    this.scale = this.fitScale;
    this.recenter();
    this.loop();
  }

  close() {
    if (!this.isOpenState) return;
    this.isOpenState = false;
    this.root.style.display = "none";
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
  }

  update(
    entities: Record<string, Entity>,
    player: Entity | null,
    cameraSX: number,
    cameraSZ: number,
  ) {
    this.entities = entities;
    this.playerEntity = player;
    this.cameraSX = cameraSX;
    this.cameraSZ = cameraSZ;
  }

  private loop = () => {
    if (!this.isOpenState) return;
    this.draw();
    this.rafHandle = requestAnimationFrame(this.loop);
  };

  private onResize = () => {
    if (!this.isOpenState) return;
    this.resize();
  };

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.recomputeFit();
  }

  private recomputeFit() {
    if (!this.layout) return;
    const pad = 60;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const sx = (w - pad * 2) / this.layout.totalSize.width;
    const sy = (h - pad * 2) / this.layout.totalSize.height;
    this.fitScale = Math.max(0.01, Math.min(sx, sy));
  }

  private recenter() {
    if (!this.layout) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx =
      this.playerEntity?.x ??
      this.cameraSX ??
      this.layout.totalSize.width / 2;
    const cy =
      this.playerEntity?.y ??
      this.cameraSZ ??
      this.layout.totalSize.height / 2;
    this.offsetX = w / 2 - cx * this.scale;
    this.offsetY = h / 2 - cy * this.scale;
  }

  private w2s(wx: number, wy: number): [number, number] {
    return [wx * this.scale + this.offsetX, wy * this.scale + this.offsetY];
  }

  private draw() {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;

    ctx.fillStyle = "rgba(5, 8, 14, 1)";
    ctx.fillRect(0, 0, w, h);

    if (!this.layout) {
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "14px monospace";
      ctx.textAlign = "center";
      ctx.fillText("World layout unavailable", w / 2, h / 2);
      ctx.textAlign = "start";
      return;
    }

    const [ox, oy] = this.w2s(0, 0);
    const ww = this.layout.totalSize.width * this.scale;
    const wh = this.layout.totalSize.height * this.scale;

    // Outer world bounds
    ctx.strokeStyle = "rgba(100, 130, 180, 0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, ww, wh);

    // Coarse grid (every 8 tiles) — skip if too dense
    const spacing = this.layout.tileSize * 8;
    if (spacing > 0 && this.scale * spacing > 24) {
      ctx.strokeStyle = "rgba(80, 110, 150, 0.08)";
      ctx.beginPath();
      for (let gx = 0; gx <= this.layout.totalSize.width; gx += spacing) {
        const sx = gx * this.scale + this.offsetX;
        ctx.moveTo(sx, oy);
        ctx.lineTo(sx, oy + wh);
      }
      for (let gy = 0; gy <= this.layout.totalSize.height; gy += spacing) {
        const sy = gy * this.scale + this.offsetY;
        ctx.moveTo(ox, sy);
        ctx.lineTo(ox + ww, sy);
      }
      ctx.stroke();
    }

    // Zones
    const playerZoneId = this.playerEntity?.zoneId ?? null;
    for (const zone of Object.values(this.layout.zones)) {
      const [zx, zy] = this.w2s(zone.offset.x, zone.offset.z);
      const zw = zone.size.width * this.scale;
      const zh = zone.size.height * this.scale;
      const isCurrent = zone.id === playerZoneId;

      ctx.fillStyle = zoneFill(zone.levelReq, isCurrent);
      ctx.fillRect(zx, zy, zw, zh);

      ctx.lineWidth = isCurrent ? 2.5 : 1;
      ctx.strokeStyle = isCurrent
        ? "#ffdd66"
        : "rgba(180, 200, 230, 0.35)";
      ctx.strokeRect(zx, zy, zw, zh);

      if (zw > 34 && zh > 20) {
        drawZoneLabel(ctx, zone.id, zone.levelReq, zx, zy, zw, zh, isCurrent);
      }
    }

    // Entity dots (skip player, drawn below)
    const playerId = this.playerEntity?.id ?? null;
    for (const ent of Object.values(this.entities)) {
      if (ent.id === playerId) continue;
      const [ex, ey] = this.w2s(ent.x, ent.y);
      if (ex < -10 || ey < -10 || ex > w + 10 || ey > h + 10) continue;
      const color = TYPE_DOT_COLORS[ent.type] ?? "#888";
      const r = ent.type === "boss" ? 4 : 2.5;
      ctx.beginPath();
      ctx.arc(ex, ey, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    // Player marker
    if (this.playerEntity) {
      const [px, py] = this.w2s(this.playerEntity.x, this.playerEntity.y);
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(68, 221, 255, 0.25)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "#44ddff";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Header banner (current zone + coords)
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(16, 16, 260, 54);
    ctx.strokeStyle = "rgba(255,221,102,0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(16, 16, 260, 54);
    ctx.fillStyle = "#ffdd66";
    ctx.font = "bold 14px monospace";
    ctx.fillText(playerZoneId ?? "—", 28, 38);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "11px monospace";
    if (this.playerEntity) {
      ctx.fillText(
        `pos  ${Math.round(this.playerEntity.x)}, ${Math.round(this.playerEntity.y)}`,
        28,
        58,
      );
    } else {
      ctx.fillText("(no player)", 28, 58);
    }
  }

  private onPointerDown = (e: PointerEvent) => {
    this.isDragging = true;
    this.hasDragged = false;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragOrigX = this.offsetX;
    this.dragOrigY = this.offsetY;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {}
    this.root.style.cursor = "grabbing";
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.isDragging) return;
    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;
    if (!this.hasDragged && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
      this.hasDragged = true;
    }
    this.offsetX = this.dragOrigX + dx;
    this.offsetY = this.dragOrigY + dy;
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.isDragging) return;
    this.isDragging = false;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {}
    this.root.style.cursor = "grab";
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!this.layout) return;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const minS = this.fitScale * 0.5;
    const maxS = this.fitScale * 8;
    const newScale = Math.max(minS, Math.min(maxS, this.scale * factor));
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = (mx - this.offsetX) / this.scale;
    const wy = (my - this.offsetY) / this.scale;
    this.scale = newScale;
    this.offsetX = mx - wx * this.scale;
    this.offsetY = my - wy * this.scale;
  };
}

function drawZoneLabel(
  ctx: CanvasRenderingContext2D,
  id: string,
  levelReq: number,
  zx: number,
  zy: number,
  zw: number,
  zh: number,
  isCurrent: boolean,
) {
  const innerPad = 4;
  const maxWidth = zw - innerPad * 2;
  if (maxWidth < 16) return;

  // Pick a font size that fits the zone width (clamped)
  const byWidth = Math.min(14, Math.max(8, Math.floor(zw / 10)));
  const byHeight = Math.min(14, Math.max(8, Math.floor(zh / 4)));
  const nameSize = Math.min(byWidth, byHeight);
  const showLevel = zh >= nameSize * 2.6;
  const levelSize = Math.max(7, nameSize - 2);

  ctx.save();
  ctx.beginPath();
  ctx.rect(zx + 1, zy + 1, zw - 2, zh - 2);
  ctx.clip();

  ctx.font = `bold ${nameSize}px monospace`;
  const name = fitText(ctx, id, maxWidth);
  const nameWidth = ctx.measureText(name).width;

  let levelText = "";
  let levelWidth = 0;
  if (showLevel) {
    ctx.font = `${levelSize}px monospace`;
    levelText = `Lv ${levelReq}`;
    levelWidth = ctx.measureText(levelText).width;
  }

  // Readability strip behind the text
  const lineHeight = nameSize + 2;
  const totalH = showLevel ? lineHeight + levelSize + 2 : lineHeight;
  const stripW = Math.min(maxWidth, Math.max(nameWidth, levelWidth) + 8);
  const stripX = zx + zw / 2 - stripW / 2;
  const stripY = zy + zh / 2 - totalH / 2 - 1;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(stripX, stripY, stripW, totalH + 2);

  // Name
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${nameSize}px monospace`;
  ctx.fillStyle = isCurrent ? "#ffdd66" : "rgba(255,255,255,0.95)";
  const nameY = showLevel
    ? zy + zh / 2 - lineHeight / 2 + 1
    : zy + zh / 2;
  ctx.fillText(name, zx + zw / 2, nameY);

  if (showLevel) {
    ctx.font = `${levelSize}px monospace`;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(levelText, zx + zw / 2, nameY + lineHeight);
  }

  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const candidate = text.slice(0, mid) + ellipsis;
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? "" : text.slice(0, lo) + ellipsis;
}

function zoneFill(levelReq: number, isCurrent: boolean): string {
  // green (low level) → red (high level)
  const t = Math.max(0, Math.min(60, levelReq)) / 60;
  const r = Math.round(60 + 140 * t);
  const g = Math.round(150 - 90 * t);
  const b = 80;
  const alpha = isCurrent ? 0.45 : 0.22;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
