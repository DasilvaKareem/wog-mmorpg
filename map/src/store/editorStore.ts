import { create } from "zustand";
import { TILE } from "../tiles/tileTypes";

export type Tool = "brush" | "eraser" | "fill" | "rect" | "eyedropper";
export type Layer = "ground" | "overlay" | "elevation";

export interface MapState {
  // Map data
  zoneId: string;
  biome: string;
  width: number;
  height: number;
  ground: number[];
  overlay: number[];
  elevation: number[];

  // Editor state
  tool: Tool;
  layer: Layer;
  selectedTile: number;
  selectedElevation: number;
  showGrid: boolean;
  showGround: boolean;
  showOverlay: boolean;
  showElevation: boolean;

  // Viewport
  zoom: number;
  panX: number;
  panY: number;

  // Undo
  undoStack: { ground: number[]; overlay: number[]; elevation: number[] }[];
  redoStack: { ground: number[]; overlay: number[]; elevation: number[] }[];

  // Rect tool state
  rectStart: { x: number; y: number } | null;

  // Actions
  setTool: (tool: Tool) => void;
  setLayer: (layer: Layer) => void;
  setSelectedTile: (tile: number) => void;
  setSelectedElevation: (elev: number) => void;
  toggleGrid: () => void;
  toggleLayerVisibility: (layer: "ground" | "overlay" | "elevation") => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setZoneId: (id: string) => void;
  setBiome: (biome: string) => void;

  // Map operations
  paintTile: (x: number, y: number) => void;
  eraseTile: (x: number, y: number) => void;
  fillArea: (x: number, y: number) => void;
  rectFill: (x1: number, y1: number, x2: number, y2: number) => void;
  eyedrop: (x: number, y: number) => void;
  setRectStart: (pos: { x: number; y: number } | null) => void;

  // Undo/redo
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;

  // Viewport
  fitToView: (canvasWidth: number, canvasHeight: number) => void;

  // I/O
  newMap: (zoneId: string, biome: string, width: number, height: number) => void;
  loadMap: (data: {
    zoneId: string;
    biome: string;
    width: number;
    height: number;
    ground: number[];
    overlay: number[];
    elevation: number[];
  }) => void;
}

const DEFAULT_W = 64;
const DEFAULT_H = 64;

function makeEmpty(w: number, h: number) {
  const size = w * h;
  return {
    ground: new Array(size).fill(TILE.GRASS_PLAIN),
    overlay: new Array(size).fill(-1),
    elevation: new Array(size).fill(0),
  };
}

export const useEditorStore = create<MapState>((set, get) => ({
  zoneId: "untitled",
  biome: "temperate",
  width: DEFAULT_W,
  height: DEFAULT_H,
  ...makeEmpty(DEFAULT_W, DEFAULT_H),

  tool: "brush",
  layer: "ground",
  selectedTile: TILE.GRASS_PLAIN,
  selectedElevation: 0,
  showGrid: true,
  showGround: true,
  showOverlay: true,
  showElevation: true,

  zoom: 1,
  panX: 0,
  panY: 0,

  undoStack: [],
  redoStack: [],

  rectStart: null,

  setTool: (tool) => set({ tool }),
  setLayer: (layer) => set({ layer }),
  setSelectedTile: (tile) => set({ selectedTile: tile }),
  setSelectedElevation: (elev) => set({ selectedElevation: elev }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleLayerVisibility: (layer) =>
    set((s) => {
      if (layer === "ground") return { showGround: !s.showGround };
      if (layer === "overlay") return { showOverlay: !s.showOverlay };
      return { showElevation: !s.showElevation };
    }),
  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(8, zoom)) }),
  setPan: (x, y) => set({ panX: x, panY: y }),
  setZoneId: (id) => set({ zoneId: id }),
  setBiome: (biome) => set({ biome }),

  paintTile: (x, y) => {
    const s = get();
    const idx = y * s.width + x;
    if (x < 0 || x >= s.width || y < 0 || y >= s.height) return;

    if (s.layer === "ground") {
      const next = [...s.ground];
      next[idx] = s.selectedTile;
      set({ ground: next });
    } else if (s.layer === "overlay") {
      const next = [...s.overlay];
      next[idx] = s.selectedTile;
      set({ overlay: next });
    } else {
      const next = [...s.elevation];
      next[idx] = s.selectedElevation;
      set({ elevation: next });
    }
  },

  eraseTile: (x, y) => {
    const s = get();
    const idx = y * s.width + x;
    if (x < 0 || x >= s.width || y < 0 || y >= s.height) return;

    if (s.layer === "ground") {
      const next = [...s.ground];
      next[idx] = TILE.GRASS_PLAIN;
      set({ ground: next });
    } else if (s.layer === "overlay") {
      const next = [...s.overlay];
      next[idx] = -1;
      set({ overlay: next });
    } else {
      const next = [...s.elevation];
      next[idx] = 0;
      set({ elevation: next });
    }
  },

  fillArea: (startX, startY) => {
    const s = get();
    if (startX < 0 || startX >= s.width || startY < 0 || startY >= s.height) return;

    const layerKey = s.layer === "elevation" ? "elevation" : s.layer;
    const arr = [...(s[layerKey] as number[])];
    const target = arr[startY * s.width + startX];
    const replacement = s.layer === "elevation" ? s.selectedElevation : s.selectedTile;
    if (target === replacement) return;

    const stack: [number, number][] = [[startX, startY]];
    const visited = new Set<number>();

    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!;
      const ci = cy * s.width + cx;
      if (cx < 0 || cx >= s.width || cy < 0 || cy >= s.height) continue;
      if (visited.has(ci)) continue;
      if (arr[ci] !== target) continue;

      visited.add(ci);
      arr[ci] = replacement;

      stack.push([cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]);
    }

    set({ [layerKey]: arr });
  },

  rectFill: (x1, y1, x2, y2) => {
    const s = get();
    const minX = Math.max(0, Math.min(x1, x2));
    const maxX = Math.min(s.width - 1, Math.max(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const maxY = Math.min(s.height - 1, Math.max(y1, y2));

    const layerKey = s.layer === "elevation" ? "elevation" : s.layer;
    const arr = [...(s[layerKey] as number[])];
    const val = s.layer === "elevation" ? s.selectedElevation : s.selectedTile;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        arr[y * s.width + x] = val;
      }
    }

    set({ [layerKey]: arr });
  },

  eyedrop: (x, y) => {
    const s = get();
    if (x < 0 || x >= s.width || y < 0 || y >= s.height) return;
    const idx = y * s.width + x;

    if (s.layer === "ground") {
      set({ selectedTile: s.ground[idx], tool: "brush" });
    } else if (s.layer === "overlay") {
      const v = s.overlay[idx];
      if (v >= 0) set({ selectedTile: v, tool: "brush" });
    } else {
      set({ selectedElevation: s.elevation[idx], tool: "brush" });
    }
  },

  setRectStart: (pos) => set({ rectStart: pos }),

  pushUndo: () =>
    set((s) => ({
      undoStack: [
        ...s.undoStack.slice(-49),
        { ground: [...s.ground], overlay: [...s.overlay], elevation: [...s.elevation] },
      ],
      redoStack: [],
    })),

  undo: () => {
    const s = get();
    if (s.undoStack.length === 0) return;
    const prev = s.undoStack[s.undoStack.length - 1];
    set({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [
        ...s.redoStack,
        { ground: [...s.ground], overlay: [...s.overlay], elevation: [...s.elevation] },
      ],
      ground: prev.ground,
      overlay: prev.overlay,
      elevation: prev.elevation,
    });
  },

  redo: () => {
    const s = get();
    if (s.redoStack.length === 0) return;
    const next = s.redoStack[s.redoStack.length - 1];
    set({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [
        ...s.undoStack,
        { ground: [...s.ground], overlay: [...s.overlay], elevation: [...s.elevation] },
      ],
      ground: next.ground,
      overlay: next.overlay,
      elevation: next.elevation,
    });
  },

  fitToView: (canvasWidth, canvasHeight) => {
    const s = get();
    const TILE_PX = 16;
    const mapPxW = s.width * TILE_PX;
    const mapPxH = s.height * TILE_PX;
    const pad = 32;
    const zoomX = (canvasWidth - pad * 2) / mapPxW;
    const zoomY = (canvasHeight - pad * 2) / mapPxH;
    const zoom = Math.max(0.25, Math.min(8, Math.min(zoomX, zoomY)));
    const panX = (canvasWidth - mapPxW * zoom) / 2;
    const panY = (canvasHeight - mapPxH * zoom) / 2;
    set({ zoom, panX, panY });
  },

  newMap: (zoneId, biome, width, height) =>
    set({
      zoneId,
      biome,
      width,
      height,
      ...makeEmpty(width, height),
      undoStack: [],
      redoStack: [],
      panX: 0,
      panY: 0,
      zoom: 1,
      _needsFit: true,
    } as any),

  loadMap: (data) =>
    set({
      zoneId: data.zoneId,
      biome: data.biome,
      width: data.width,
      height: data.height,
      ground: data.ground,
      overlay: data.overlay,
      elevation: data.elevation,
      undoStack: [],
      redoStack: [],
      _needsFit: true,
    } as any),
}));
