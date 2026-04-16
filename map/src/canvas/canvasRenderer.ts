import { mapOldTileToOverworld } from "../tiles/overworldMapping";
import { getTilesheet, getTileRect } from "./tilesheetLoader";
import type { MapState, EditorNpc } from "../store/editorStore";
import type { Prefab } from "../tiles/prefabs";

/** Game units per tile — matches server TILE_SIZE. */
const GAME_UNITS_PER_TILE = 10;

function npcColor(type: string): string {
  if (type === "mob" || type === "boss") return "#ef4444";        // red
  if (type === "merchant") return "#22c55e";                      // green
  if (type === "auctioneer") return "#eab308";                    // yellow
  if (type === "quest-giver") return "#f59e0b";                   // amber
  if (type === "lore-npc") return "#3b82f6";                      // blue
  if (type === "trainer" || type === "profession-trainer") return "#a855f7"; // purple
  if (type === "guild-registrar") return "#ec4899";               // pink
  if (type === "arena-master") return "#f97316";                  // orange
  return "#94a3b8";                                               // slate (crafting stations, etc.)
}

const RENDER_TILE_PX = 16;

export interface RenderOpts {
  ctx: CanvasRenderingContext2D;
  state: Pick<
    MapState,
    | "width"
    | "height"
    | "ground"
    | "overlay"
    | "elevation"
    | "zoom"
    | "panX"
    | "panY"
    | "showGrid"
    | "showGround"
    | "showOverlay"
    | "showElevation"
    | "layer"
    | "tool"
    | "npcs"
    | "selectedNpcIndex"
  >;
  canvasWidth: number;
  canvasHeight: number;
  hoverTile?: { x: number; y: number } | null;
  rectPreview?: { x1: number; y1: number; x2: number; y2: number } | null;
  prefabPreview?: Prefab | null;
}

export function renderMap(opts: RenderOpts) {
  const { ctx, state, canvasWidth, canvasHeight, hoverTile, rectPreview, prefabPreview } = opts;
  const img = getTilesheet();

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Dark background
  ctx.fillStyle = "#0c0c0e";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.save();
  ctx.translate(state.panX, state.panY);
  ctx.scale(state.zoom, state.zoom);

  const tileSize = RENDER_TILE_PX;
  const mapPxW = state.width * tileSize;
  const mapPxH = state.height * tileSize;

  // Determine visible tile range for culling
  const invZoom = 1 / state.zoom;
  const startX = Math.max(0, Math.floor(-state.panX * invZoom / tileSize));
  const startY = Math.max(0, Math.floor(-state.panY * invZoom / tileSize));
  const endX = Math.min(state.width, Math.ceil((-state.panX + canvasWidth) * invZoom / tileSize));
  const endY = Math.min(state.height, Math.ceil((-state.panY + canvasHeight) * invZoom / tileSize));

  // Map background (checkerboard for empty areas)
  ctx.fillStyle = "#1a1a1f";
  ctx.fillRect(0, 0, mapPxW, mapPxH);

  // Ground layer
  if (state.showGround && img) {
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const tileIdx = state.ground[y * state.width + x];
        const owIdx = mapOldTileToOverworld(tileIdx);
        if (owIdx < 0) continue;
        const { sx, sy, sw, sh } = getTileRect(owIdx);
        ctx.drawImage(img, sx, sy, sw, sh, x * tileSize, y * tileSize, tileSize, tileSize);
      }
    }
  }

  // Overlay layer
  if (state.showOverlay && img) {
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const tileIdx = state.overlay[y * state.width + x];
        if (tileIdx < 0) continue;
        const owIdx = mapOldTileToOverworld(tileIdx);
        if (owIdx < 0) continue;
        const { sx, sy, sw, sh } = getTileRect(owIdx);
        ctx.drawImage(img, sx, sy, sw, sh, x * tileSize, y * tileSize, tileSize, tileSize);
      }
    }
  }

  // Elevation overlay
  if (state.showElevation) {
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const elev = state.elevation[y * state.width + x];
        if (elev > 0) {
          const alpha = 0.12 + (elev / 30) * 0.48;
          ctx.fillStyle = `rgba(255, 220, 100, ${alpha})`;
          ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
          // Elevation number when zoomed in enough
          if (state.zoom >= 2) {
            ctx.fillStyle = `rgba(255, 220, 100, 0.9)`;
            ctx.font = `${Math.max(6, 8 / state.zoom * state.zoom)}px monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(
              String(elev),
              x * tileSize + tileSize / 2,
              y * tileSize + tileSize / 2,
            );
          }
        }
      }
    }
  }

  // Grid — minor lines + major lines every 8 tiles
  if (state.showGrid) {
    // Minor grid
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 0.5 / state.zoom;
    ctx.beginPath();
    for (let x = startX; x <= endX; x++) {
      if (x % 8 === 0) continue; // skip major lines
      ctx.moveTo(x * tileSize, startY * tileSize);
      ctx.lineTo(x * tileSize, Math.min(endY, state.height) * tileSize);
    }
    for (let y = startY; y <= endY; y++) {
      if (y % 8 === 0) continue;
      ctx.moveTo(startX * tileSize, y * tileSize);
      ctx.lineTo(Math.min(endX, state.width) * tileSize, y * tileSize);
    }
    ctx.stroke();

    // Major grid (every 8 tiles)
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1 / state.zoom;
    ctx.beginPath();
    for (let x = Math.ceil(startX / 8) * 8; x <= endX; x += 8) {
      ctx.moveTo(x * tileSize, startY * tileSize);
      ctx.lineTo(x * tileSize, Math.min(endY, state.height) * tileSize);
    }
    for (let y = Math.ceil(startY / 8) * 8; y <= endY; y += 8) {
      ctx.moveTo(startX * tileSize, y * tileSize);
      ctx.lineTo(Math.min(endX, state.width) * tileSize, y * tileSize);
    }
    ctx.stroke();

    // Coordinate labels on major grid lines (when zoomed in enough)
    if (state.zoom >= 0.8) {
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = `${Math.max(4, 6)}px monospace`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      for (let x = Math.ceil(startX / 8) * 8; x <= endX; x += 8) {
        ctx.fillText(String(x), x * tileSize + 1, startY * tileSize + 1);
      }
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      for (let y = Math.ceil(startY / 8) * 8; y <= endY; y += 8) {
        if (y === 0) continue;
        ctx.fillText(String(y), startX * tileSize + 1, y * tileSize + 1);
      }
    }
  }

  // Map boundary
  ctx.strokeStyle = "rgba(250, 204, 21, 0.6)";
  ctx.lineWidth = 2 / state.zoom;
  ctx.strokeRect(0, 0, mapPxW, mapPxH);

  // NPC markers — always visible so authors can see where NPCs sit while
  // painting terrain. Highlighted in "npcs" layer mode.
  if (state.npcs.length > 0) {
    const isNpcLayer = state.layer === "npcs";
    // Game units → editor pixels: tileSize (16 px) / GAME_UNITS_PER_TILE (10) = 1.6 px/unit
    const pxPerGameUnit = tileSize / GAME_UNITS_PER_TILE;
    const dotRadius = Math.max(3, 5 / state.zoom);
    const borderWidth = 1.5 / state.zoom;

    for (let i = 0; i < state.npcs.length; i++) {
      const npc = state.npcs[i];
      const px = npc.x * pxPerGameUnit;
      const py = npc.y * pxPerGameUnit;
      const isSelected = state.selectedNpcIndex === i;
      const color = npcColor(npc.type);

      // Outer ring for contrast against terrain
      ctx.beginPath();
      ctx.arc(px, py, dotRadius + 1 / state.zoom, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = borderWidth;
        ctx.stroke();
        // Selection ring
        ctx.beginPath();
        ctx.arc(px, py, dotRadius + 4 / state.zoom, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.stroke();
      }

      // Label — only when on NPC layer or zoomed in
      if ((isNpcLayer || state.zoom >= 1.5) && npc.name) {
        const fontPx = Math.max(8, 10 / state.zoom);
        ctx.font = `${fontPx}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const label = npc.name.length > 22 ? npc.name.slice(0, 20) + "…" : npc.name;
        const textY = py - dotRadius - 3 / state.zoom;
        // Text shadow for legibility
        ctx.fillStyle = "rgba(0,0,0,0.85)";
        ctx.fillText(label, px + 1 / state.zoom, textY + 1 / state.zoom);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, px, textY);
      }
    }

    // Dim non-NPC layers visually when in NPC layer mode so markers pop
    if (isNpcLayer) {
      ctx.fillStyle = "rgba(0,0,0,0.05)";
      ctx.fillRect(0, 0, mapPxW, mapPxH);
    }
  }

  // Active layer indicator: dim non-active layer tiles slightly
  // (visual hint for which layer is being edited)

  // Hover highlight — skip single-tile highlight in stamp mode (prefab ghost takes over)
  if (
    hoverTile &&
    hoverTile.x >= 0 && hoverTile.x < state.width &&
    hoverTile.y >= 0 && hoverTile.y < state.height &&
    state.tool !== "stamp"
  ) {
    ctx.fillStyle = "rgba(59, 130, 246, 0.2)";
    ctx.fillRect(hoverTile.x * tileSize, hoverTile.y * tileSize, tileSize, tileSize);
    ctx.strokeStyle = "rgba(59, 130, 246, 0.9)";
    ctx.lineWidth = 1.5 / state.zoom;
    ctx.strokeRect(hoverTile.x * tileSize, hoverTile.y * tileSize, tileSize, tileSize);
  }

  // Prefab ghost preview (stamp mode)
  if (
    state.tool === "stamp" &&
    prefabPreview &&
    hoverTile &&
    hoverTile.x >= 0 && hoverTile.y >= 0 &&
    img
  ) {
    const p = prefabPreview;
    const ox = hoverTile.x;
    const oy = hoverTile.y;

    ctx.globalAlpha = 0.65;
    for (let dy = 0; dy < p.height; dy++) {
      for (let dx = 0; dx < p.width; dx++) {
        const cell = p.cells[dy * p.width + dx];
        if (!cell) continue;
        const tx = ox + dx;
        const ty = oy + dy;
        if (tx < 0 || tx >= state.width || ty < 0 || ty >= state.height) continue;
        const draw = (t: number) => {
          const owIdx = mapOldTileToOverworld(t);
          if (owIdx < 0) return;
          const { sx, sy, sw, sh } = getTileRect(owIdx);
          ctx.drawImage(img, sx, sy, sw, sh, tx * tileSize, ty * tileSize, tileSize, tileSize);
        };
        if (cell.ground !== undefined) draw(cell.ground);
        if (cell.overlay !== undefined) draw(cell.overlay);
      }
    }
    ctx.globalAlpha = 1;

    // Yellow boundary showing the prefab footprint
    ctx.strokeStyle = "rgba(250, 204, 21, 0.9)";
    ctx.lineWidth = 2 / state.zoom;
    ctx.setLineDash([4 / state.zoom, 3 / state.zoom]);
    ctx.strokeRect(ox * tileSize, oy * tileSize, p.width * tileSize, p.height * tileSize);
    ctx.setLineDash([]);

    // Out-of-bounds warning
    if (ox + p.width > state.width || oy + p.height > state.height) {
      ctx.fillStyle = "rgba(239, 68, 68, 0.2)";
      ctx.fillRect(ox * tileSize, oy * tileSize, p.width * tileSize, p.height * tileSize);
    }
  }

  // Rect preview
  if (rectPreview) {
    const minX = Math.min(rectPreview.x1, rectPreview.x2);
    const maxX = Math.max(rectPreview.x1, rectPreview.x2);
    const minY = Math.min(rectPreview.y1, rectPreview.y2);
    const maxY = Math.max(rectPreview.y1, rectPreview.y2);

    ctx.fillStyle = "rgba(234, 179, 8, 0.15)";
    ctx.fillRect(
      minX * tileSize,
      minY * tileSize,
      (maxX - minX + 1) * tileSize,
      (maxY - minY + 1) * tileSize,
    );
    ctx.strokeStyle = "rgba(234, 179, 8, 0.8)";
    ctx.lineWidth = 1.5 / state.zoom;
    ctx.setLineDash([4 / state.zoom, 4 / state.zoom]);
    ctx.strokeRect(
      minX * tileSize,
      minY * tileSize,
      (maxX - minX + 1) * tileSize,
      (maxY - minY + 1) * tileSize,
    );
    ctx.setLineDash([]);
  }

  ctx.restore();
}
