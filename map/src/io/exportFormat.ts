import { useEditorStore, type EditorProp } from "../store/editorStore";

export interface TerrainGridDataV2 {
  zoneId: string;
  width: number;
  height: number;
  tileSize: 10;
  ground: number[];
  overlay: number[];
  elevation: number[];
  biome: string;
  props?: EditorProp[];
}

/**
 * Convert current editor state to the TerrainGridDataV2 format
 * used by the shard server.
 */
export function exportToV2(): TerrainGridDataV2 {
  const s = useEditorStore.getState();
  return {
    zoneId: s.zoneId,
    width: s.width,
    height: s.height,
    tileSize: 10,
    ground: [...s.ground],
    overlay: [...s.overlay],
    elevation: [...s.elevation],
    biome: s.biome,
    props: s.props.map((p) => ({ ...p })),
  };
}

function parseProps(raw: unknown): EditorProp[] {
  if (!Array.isArray(raw)) return [];
  const out: EditorProp[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    if (typeof o.model !== "string") continue;
    if (typeof o.x !== "number" || typeof o.z !== "number") continue;
    out.push({
      model: o.model,
      x: o.x,
      z: o.z,
      rotY: typeof o.rotY === "number" ? o.rotY : undefined,
      scale: typeof o.scale === "number" ? o.scale : undefined,
    });
  }
  return out;
}

/**
 * Validate and parse a TerrainGridDataV2 JSON object.
 * Returns null if invalid.
 */
export function parseV2(data: unknown): TerrainGridDataV2 | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  if (typeof d.zoneId !== "string") return null;
  if (typeof d.width !== "number" || typeof d.height !== "number") return null;
  if (!Array.isArray(d.ground) || !Array.isArray(d.overlay) || !Array.isArray(d.elevation))
    return null;

  const size = d.width * d.height;
  if (d.ground.length !== size || d.overlay.length !== size || d.elevation.length !== size)
    return null;

  return {
    zoneId: d.zoneId,
    width: d.width,
    height: d.height,
    tileSize: 10,
    ground: d.ground as number[],
    overlay: d.overlay as number[],
    elevation: d.elevation as number[],
    biome: (d.biome as string) || "temperate",
    props: parseProps(d.props),
  };
}
