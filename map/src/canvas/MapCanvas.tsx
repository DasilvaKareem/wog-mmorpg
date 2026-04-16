import { useRef, useEffect, useCallback, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { renderMap } from "./canvasRenderer";
import { loadTilesheet } from "./tilesheetLoader";
import { tileName } from "../tiles/tileTypes";

const TILE_PX = 16;
/** Game units per tile — must match server TILE_SIZE. */
const GAME_UNITS_PER_TILE = 10;
/** NPC hit radius in editor pixels (zoom-aware). */
const NPC_HIT_RADIUS_PX = 8;

export function MapCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [hoverTile, setHoverTile] = useState<{ x: number; y: number } | null>(null);
  const [rectEnd, setRectEnd] = useState<{ x: number; y: number } | null>(null);
  const isPanning = useRef(false);
  const isPainting = useRef(false);
  const isDraggingNpc = useRef(false);
  const lastPan = useRef({ x: 0, y: 0 });
  const rafId = useRef<number>(0);
  const canvasSize = useRef({ w: 0, h: 0 });

  const store = useEditorStore;
  const zoneId = useEditorStore((s) => s.zoneId);
  const zoom = useEditorStore((s) => s.zoom);
  const width = useEditorStore((s) => s.width);
  const height = useEditorStore((s) => s.height);
  const layer = useEditorStore((s) => s.layer);
  const tool = useEditorStore((s) => s.tool);

  // Load tilesheet
  useEffect(() => {
    loadTilesheet().then(() => setLoaded(true));
  }, []);

  // Resize canvas
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvasSize.current = { w: width, h: height };
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Auto-fit when map changes (load/new)
  useEffect(() => {
    const s = store.getState();
    if ((s as any)._needsFit && canvasSize.current.w > 0) {
      // Small delay to ensure canvas is sized
      requestAnimationFrame(() => {
        store.getState().fitToView(canvasSize.current.w, canvasSize.current.h);
        store.setState({ _needsFit: false } as any);
      });
    }
  }, [zoneId, width, height, store]);

  // Fit to view on first load
  useEffect(() => {
    if (!loaded) return;
    if (canvasSize.current.w > 0) {
      requestAnimationFrame(() => {
        store.getState().fitToView(canvasSize.current.w, canvasSize.current.h);
      });
    }
  }, [loaded, store]);

  // Render loop
  useEffect(() => {
    if (!loaded) return;

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const s = store.getState();
      const rectStart = s.rectStart;
      const prefabPreview = s.tool === "stamp" ? s.getActivePrefab() : null;

      renderMap({
        ctx,
        state: s,
        canvasWidth: canvas.width / dpr,
        canvasHeight: canvas.height / dpr,
        hoverTile,
        rectPreview:
          rectStart && rectEnd
            ? { x1: rectStart.x, y1: rectStart.y, x2: rectEnd.x, y2: rectEnd.y }
            : null,
        prefabPreview,
      });

      rafId.current = requestAnimationFrame(draw);
    };

    rafId.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId.current);
  }, [loaded, hoverTile, rectEnd, store]);

  const screenToTile = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: -1, y: -1 };
      const rect = canvas.getBoundingClientRect();
      const s = store.getState();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      const wx = (mx - s.panX) / s.zoom;
      const wy = (my - s.panY) / s.zoom;
      return {
        x: Math.floor(wx / TILE_PX),
        y: Math.floor(wy / TILE_PX),
      };
    },
    [store],
  );

  /** Screen-space → zone-local game units (1 tile = 10 units). */
  const screenToGame = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const s = store.getState();
      const wx = (clientX - rect.left - s.panX) / s.zoom;
      const wy = (clientY - rect.top - s.panY) / s.zoom;
      const unitsPerPx = GAME_UNITS_PER_TILE / TILE_PX;
      return { x: wx * unitsPerPx, y: wy * unitsPerPx };
    },
    [store],
  );

  /** Returns the index of the NPC under the cursor, or null. */
  const pickNpc = useCallback(
    (clientX: number, clientY: number): number | null => {
      const s = store.getState();
      if (s.npcs.length === 0) return null;
      const g = screenToGame(clientX, clientY);
      const hitR = (NPC_HIT_RADIUS_PX * GAME_UNITS_PER_TILE) / TILE_PX / s.zoom;
      const hitR2 = hitR * hitR;
      let best: { idx: number; d2: number } | null = null;
      for (let i = 0; i < s.npcs.length; i++) {
        const n = s.npcs[i];
        const dx = n.x - g.x;
        const dy = n.y - g.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= hitR2 && (!best || d2 < best.d2)) best = { idx: i, d2 };
      }
      return best?.idx ?? null;
    },
    [screenToGame, store],
  );

  const applyTool = useCallback(
    (tx: number, ty: number) => {
      const s = store.getState();
      if (tx < 0 || tx >= s.width || ty < 0 || ty >= s.height) return;

      switch (s.tool) {
        case "brush":
          s.paintTile(tx, ty);
          break;
        case "eraser":
          s.eraseTile(tx, ty);
          break;
        case "fill":
          s.fillArea(tx, ty);
          break;
        case "eyedropper":
          s.eyedrop(tx, ty);
          break;
        case "stamp":
          s.stampPrefab(tx, ty);
          break;
      }
    },
    [store],
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Middle-click or alt+click → pan
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        isPanning.current = true;
        lastPan.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
        return;
      }

      if (e.button !== 0) return;

      const s = store.getState();

      // NPC layer has its own interaction model: click to select/deselect + drag to move
      if (s.layer === "npcs") {
        const hit = pickNpc(e.clientX, e.clientY);
        if (hit !== null) {
          s.selectNpc(hit);
          isDraggingNpc.current = true;
        } else {
          s.selectNpc(null);
        }
        return;
      }

      const tile = screenToTile(e.clientX, e.clientY);

      if (s.tool === "rect") {
        s.pushUndo();
        s.setRectStart(tile);
        setRectEnd(tile);
        return;
      }

      s.pushUndo();
      // Stamp is one-shot: no drag continuation
      isPainting.current = s.tool !== "stamp";
      applyTool(tile.x, tile.y);
    },
    [screenToTile, applyTool, pickNpc, store],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning.current) {
        const s = store.getState();
        const dx = e.clientX - lastPan.current.x;
        const dy = e.clientY - lastPan.current.y;
        s.setPan(s.panX + dx, s.panY + dy);
        lastPan.current = { x: e.clientX, y: e.clientY };
        return;
      }

      const tile = screenToTile(e.clientX, e.clientY);
      setHoverTile(tile);

      const s = store.getState();

      // NPC drag
      if (isDraggingNpc.current && s.selectedNpcIndex !== null) {
        const g = screenToGame(e.clientX, e.clientY);
        // Clamp inside zone bounds (width/height are tile counts × game units)
        const maxX = s.width * GAME_UNITS_PER_TILE;
        const maxY = s.height * GAME_UNITS_PER_TILE;
        const clampedX = Math.max(0, Math.min(maxX, Math.round(g.x)));
        const clampedY = Math.max(0, Math.min(maxY, Math.round(g.y)));
        s.moveNpc(s.selectedNpcIndex, clampedX, clampedY);
        return;
      }

      if (s.tool === "rect" && s.rectStart) {
        setRectEnd(tile);
        return;
      }

      if (isPainting.current) {
        applyTool(tile.x, tile.y);
      }
    },
    [screenToTile, screenToGame, applyTool, store],
  );

  const onMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning.current) {
        isPanning.current = false;
        return;
      }

      if (isDraggingNpc.current) {
        isDraggingNpc.current = false;
        return;
      }

      const s = store.getState();
      if (s.tool === "rect" && s.rectStart) {
        const tile = screenToTile(e.clientX, e.clientY);
        s.rectFill(s.rectStart.x, s.rectStart.y, tile.x, tile.y);
        s.setRectStart(null);
        setRectEnd(null);
        return;
      }

      isPainting.current = false;
    },
    [screenToTile, store],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const s = store.getState();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.25, Math.min(8, s.zoom * delta));

      // Zoom toward cursor
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const newPanX = mx - (mx - s.panX) * (newZoom / s.zoom);
      const newPanY = my - (my - s.panY) * (newZoom / s.zoom);

      s.setZoom(newZoom);
      s.setPan(newPanX, newPanY);
    },
    [store],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
      const s = store.getState();

      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        s.undo();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        s.redo();
      } else if (e.key === "b") {
        s.setTool("brush");
      } else if (e.key === "e") {
        s.setTool("eraser");
      } else if (e.key === "g") {
        s.setTool("fill");
      } else if (e.key === "r") {
        s.setTool("rect");
      } else if (e.key === "i") {
        s.setTool("eyedropper");
      } else if (e.key === "p") {
        s.setTool("stamp");
      } else if (e.key === "t" && s.tool === "stamp") {
        s.rotatePrefabCW();
      } else if (e.key === "Escape" && s.tool === "stamp") {
        s.setTool("brush");
      } else if ((e.key === "Delete" || e.key === "Backspace") && s.layer === "npcs" && s.selectedNpcIndex !== null) {
        e.preventDefault();
        s.removeNpc(s.selectedNpcIndex);
      } else if (e.key === "Escape" && s.layer === "npcs") {
        s.selectNpc(null);
      } else if (e.key === "h") {
        s.toggleGrid();
      } else if (e.key === "f") {
        // Fit to view
        if (canvasSize.current.w > 0) {
          s.fitToView(canvasSize.current.w, canvasSize.current.h);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [store]);

  // Get hover tile info for status bar
  const hoverInfo = (() => {
    if (!hoverTile || hoverTile.x < 0 || hoverTile.y < 0) return null;
    const s = store.getState();
    if (hoverTile.x >= s.width || hoverTile.y >= s.height) return null;
    const idx = hoverTile.y * s.width + hoverTile.x;
    const groundTile = s.ground[idx];
    const overlayTile = s.overlay[idx];
    const elev = s.elevation[idx];
    return {
      groundName: tileName(groundTile) ?? String(groundTile),
      overlayName: overlayTile >= 0 ? (tileName(overlayTile) ?? String(overlayTile)) : "—",
      elev,
    };
  })();

  return (
    <div
      ref={containerRef}
      className={`relative flex-1 overflow-hidden ${layer === "npcs" ? "cursor-pointer" : "cursor-crosshair"}`}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          isPainting.current = false;
          isPanning.current = false;
          setHoverTile(null);
        }}
        onWheel={onWheel}
      />
      {/* Status bar */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex items-center gap-4 bg-zinc-900/90 px-3 py-1 text-xs">
        <span className="text-zinc-300">
          {zoneId}
        </span>
        <span className="text-zinc-500">|</span>
        {hoverTile && hoverTile.x >= 0 && hoverTile.y >= 0 && hoverTile.x < width && hoverTile.y < height && (
          <>
            <span className="font-mono text-zinc-300">
              ({hoverTile.x}, {hoverTile.y})
            </span>
            {hoverInfo && (
              <span className="text-zinc-500">
                G:{hoverInfo.groundName} O:{hoverInfo.overlayName} E:{hoverInfo.elev}
              </span>
            )}
          </>
        )}
        <span className="ml-auto text-zinc-500">
          {Math.round(zoom * 100)}% | {width}x{height} | {layer} | {tool} | F=fit
        </span>
      </div>
    </div>
  );
}
