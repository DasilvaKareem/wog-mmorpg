import { create } from "zustand";
import { TILE } from "../tiles/tileTypes";
import { PREFABS, rotatePrefab, type Prefab } from "../tiles/prefabs";

export type Tool = "brush" | "eraser" | "fill" | "rect" | "eyedropper" | "stamp";
export type Layer = "ground" | "overlay" | "elevation" | "npcs" | "props";

/** Free-form 3D prop placed by a human. Tile-unit coords match the TerrainRenderer. */
export interface EditorProp {
  /** Asset key in PROP_MODELS / client-xr ASSET_DEFS. */
  model: string;
  /** Tile-unit X (float, 0..width). */
  x: number;
  /** Tile-unit Z (float, 0..height). */
  z: number;
  /** Y rotation in radians; default 0. */
  rotY?: number;
  /** Scale multiplier; default 1. */
  scale?: number;
}

/** NPC entry as stored in world/content/npcs/<zoneId>.json (zoneId is implicit) */
export interface EditorNpc {
  type: string;
  name: string;
  /** zone-local game units (1 tile = 10 units) */
  x: number;
  y: number;
  hp: number;
  level?: number;
  xpReward?: number;
  shopItems?: number[];
  teachesProfession?: string;
  teachesClass?: string;
}

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
  viewMode: "2d" | "3d";

  // Viewport
  zoom: number;
  panX: number;
  panY: number;

  // Undo
  undoStack: { ground: number[]; overlay: number[]; elevation: number[] }[];
  redoStack: { ground: number[]; overlay: number[]; elevation: number[] }[];

  // Rect tool state
  rectStart: { x: number; y: number } | null;

  // Prefab tool state
  selectedPrefabId: string;
  /** Number of 90° CW rotations applied to the current prefab (0-3) */
  prefabRotation: 0 | 1 | 2 | 3;
  /** When on, stamping flattens the elevation under the footprint to the anchor tile's height */
  flattenUnderStamp: boolean;

  // NPC layer state
  npcs: EditorNpc[];
  selectedNpcIndex: number | null;
  npcsDirty: boolean;

  // Props layer state
  props: EditorProp[];
  selectedPropIndex: number | null;
  selectedPropModel: string;
  propsDirty: boolean;

  // Actions
  setTool: (tool: Tool) => void;
  setLayer: (layer: Layer) => void;
  setSelectedTile: (tile: number) => void;
  setSelectedElevation: (elev: number) => void;
  toggleGrid: () => void;
  toggleLayerVisibility: (layer: "ground" | "overlay" | "elevation") => void;
  setViewMode: (mode: "2d" | "3d") => void;
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

  // Prefab actions
  setSelectedPrefab: (id: string) => void;
  rotatePrefabCW: () => void;
  toggleFlattenUnderStamp: () => void;
  stampPrefab: (x: number, y: number) => void;
  /** Returns the currently selected prefab with rotation applied. */
  getActivePrefab: () => Prefab;

  // NPC actions (x/y in game units; tile × 10)
  setNpcs: (npcs: EditorNpc[]) => void;
  addNpc: (npc: EditorNpc) => void;
  updateNpc: (index: number, patch: Partial<EditorNpc>) => void;
  removeNpc: (index: number) => void;
  moveNpc: (index: number, x: number, y: number) => void;
  selectNpc: (index: number | null) => void;
  markNpcsClean: () => void;

  // Prop actions (x/z in tile units; match TerrainRenderer native coords)
  setProps: (props: EditorProp[]) => void;
  addProp: (prop: EditorProp) => void;
  updateProp: (index: number, patch: Partial<EditorProp>) => void;
  removeProp: (index: number) => void;
  moveProp: (index: number, x: number, z: number) => void;
  selectProp: (index: number | null) => void;
  setSelectedPropModel: (model: string) => void;
  markPropsClean: () => void;

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
    props?: EditorProp[];
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
  viewMode: "2d",

  zoom: 1,
  panX: 0,
  panY: 0,

  undoStack: [],
  redoStack: [],

  rectStart: null,

  selectedPrefabId: PREFABS[0].id,
  prefabRotation: 0,
  flattenUnderStamp: true,

  npcs: [],
  selectedNpcIndex: null,
  npcsDirty: false,

  props: [],
  selectedPropIndex: null,
  selectedPropModel: "oak_tree",
  propsDirty: false,

  setTool: (tool) => set({ tool }),
  setLayer: (layer) => set({ layer }),
  setSelectedTile: (tile) => set({ selectedTile: tile }),
  setSelectedElevation: (elev) => set({ selectedElevation: elev }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  setViewMode: (mode) => set({ viewMode: mode }),
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

  setSelectedPrefab: (id) => set({ selectedPrefabId: id, prefabRotation: 0 }),

  rotatePrefabCW: () =>
    set((s) => ({ prefabRotation: (((s.prefabRotation + 1) % 4) as 0 | 1 | 2 | 3) })),

  toggleFlattenUnderStamp: () =>
    set((s) => ({ flattenUnderStamp: !s.flattenUnderStamp })),

  getActivePrefab: () => {
    const s = get();
    const base = PREFABS.find((p) => p.id === s.selectedPrefabId) ?? PREFABS[0];
    let p = base;
    for (let i = 0; i < s.prefabRotation; i++) p = rotatePrefab(p);
    return p;
  },

  setNpcs: (npcs) =>
    set({ npcs, selectedNpcIndex: null, npcsDirty: false }),

  addNpc: (npc) =>
    set((s) => ({
      npcs: [...s.npcs, npc],
      selectedNpcIndex: s.npcs.length,
      npcsDirty: true,
    })),

  updateNpc: (index, patch) =>
    set((s) => {
      if (index < 0 || index >= s.npcs.length) return s;
      const next = [...s.npcs];
      next[index] = { ...next[index], ...patch };
      return { npcs: next, npcsDirty: true };
    }),

  removeNpc: (index) =>
    set((s) => {
      if (index < 0 || index >= s.npcs.length) return s;
      const next = s.npcs.filter((_, i) => i !== index);
      return {
        npcs: next,
        selectedNpcIndex: null,
        npcsDirty: true,
      };
    }),

  moveNpc: (index, x, y) =>
    set((s) => {
      if (index < 0 || index >= s.npcs.length) return s;
      const next = [...s.npcs];
      next[index] = { ...next[index], x, y };
      return { npcs: next, npcsDirty: true };
    }),

  selectNpc: (index) => set({ selectedNpcIndex: index }),

  markNpcsClean: () => set({ npcsDirty: false }),

  setProps: (props) => set({ props, selectedPropIndex: null, propsDirty: false }),

  addProp: (prop) =>
    set((s) => ({
      props: [...s.props, prop],
      selectedPropIndex: s.props.length,
      propsDirty: true,
    })),

  updateProp: (index, patch) =>
    set((s) => {
      if (index < 0 || index >= s.props.length) return s;
      const next = [...s.props];
      next[index] = { ...next[index], ...patch };
      return { props: next, propsDirty: true };
    }),

  removeProp: (index) =>
    set((s) => {
      if (index < 0 || index >= s.props.length) return s;
      const next = s.props.filter((_, i) => i !== index);
      return { props: next, selectedPropIndex: null, propsDirty: true };
    }),

  moveProp: (index, x, z) =>
    set((s) => {
      if (index < 0 || index >= s.props.length) return s;
      const next = [...s.props];
      next[index] = { ...next[index], x, z };
      return { props: next, propsDirty: true };
    }),

  selectProp: (index) => set({ selectedPropIndex: index }),

  setSelectedPropModel: (model) => set({ selectedPropModel: model }),

  markPropsClean: () => set({ propsDirty: false }),

  stampPrefab: (x, y) => {
    const s = get();
    const p = s.getActivePrefab();
    const ground = [...s.ground];
    const overlay = [...s.overlay];
    const elevation = [...s.elevation];

    // Flatten elevation under footprint using the anchor tile's current height
    // (prefab cells that explicitly set .elevation still win over the flatten value)
    const anchorInBounds = x >= 0 && x < s.width && y >= 0 && y < s.height;
    const flattenTo = s.flattenUnderStamp && anchorInBounds
      ? s.elevation[y * s.width + x]
      : null;

    for (let dy = 0; dy < p.height; dy++) {
      for (let dx = 0; dx < p.width; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || tx >= s.width || ty < 0 || ty >= s.height) continue;
        const cell = p.cells[dy * p.width + dx];
        const idx = ty * s.width + tx;

        // Flatten first so an explicit cell.elevation still overrides
        if (flattenTo !== null) elevation[idx] = flattenTo;

        if (!cell) continue;
        if (cell.ground !== undefined) ground[idx] = cell.ground;
        if (cell.overlay !== undefined) overlay[idx] = cell.overlay;
        if (cell.elevation !== undefined) elevation[idx] = cell.elevation;
      }
    }

    set({ ground, overlay, elevation });
  },

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
      props: [],
      selectedPropIndex: null,
      propsDirty: false,
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
      props: data.props ?? [],
      selectedPropIndex: null,
      propsDirty: false,
      undoStack: [],
      redoStack: [],
      _needsFit: true,
    } as any),
}));
