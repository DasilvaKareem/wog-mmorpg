import { mapOldTileToOverworld } from "../tiles/overworldMapping";
import { getTilesheet, getTileRect } from "./tilesheetLoader";
import type { MapState } from "../store/editorStore";

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
  >;
  canvasWidth: number;
  canvasHeight: number;
  hoverTile?: { x: number; y: number } | null;
  rectPreview?: { x1: number; y1: number; x2: number; y2: number } | null;
}

export function renderMap(opts: RenderOpts) {
  const { ctx, state, canvasWidth, canvasHeight, hoverTile, rectPreview } = opts;
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
          const alpha = 0.12 + elev * 0.12;
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

  // Active layer indicator: dim non-active layer tiles slightly
  // (visual hint for which layer is being edited)

  // Hover highlight
  if (hoverTile && hoverTile.x >= 0 && hoverTile.x < state.width && hoverTile.y >= 0 && hoverTile.y < state.height) {
    ctx.fillStyle = "rgba(59, 130, 246, 0.2)";
    ctx.fillRect(hoverTile.x * tileSize, hoverTile.y * tileSize, tileSize, tileSize);
    ctx.strokeStyle = "rgba(59, 130, 246, 0.9)";
    ctx.lineWidth = 1.5 / state.zoom;
    ctx.strokeRect(hoverTile.x * tileSize, hoverTile.y * tileSize, tileSize, tileSize);
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
