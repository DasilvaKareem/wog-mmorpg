import type { TerrainType } from "./terrain.js";

/** Number of tiles per chunk dimension (64×64 tiles per chunk) */
export const CHUNK_SIZE = 64;

/** Chunk coordinate derived from tile coordinates: cx = floor(tx / CHUNK_SIZE) */
export interface ChunkCoord {
  cx: number;
  cz: number;
}

/** Convert tile coordinates to the chunk they belong to */
export function tileToChunk(tx: number, tz: number): ChunkCoord {
  return {
    cx: Math.floor(tx / CHUNK_SIZE),
    cz: Math.floor(tz / CHUNK_SIZE),
  };
}

/** Get the tile-coordinate origin (top-left) of a chunk */
export function chunkOrigin(cx: number, cz: number): { tx: number; tz: number } {
  return {
    tx: cx * CHUNK_SIZE,
    tz: cz * CHUNK_SIZE,
  };
}

/** Canonical string key for a chunk */
export function chunkKey(cx: number, cz: number): string {
  return `${cx}_${cz}`;
}

/** Data for a single chunk — a CHUNK_SIZE×CHUNK_SIZE tile array + metadata */
export interface ChunkData {
  cx: number;
  cz: number;
  /** Flat array of terrain types, length = CHUNK_SIZE * CHUNK_SIZE.
   *  Index = localTz * CHUNK_SIZE + localTx  */
  tiles: TerrainType[];
}

/** A tracked modification to a single tile within a chunk */
export interface TileDiff {
  localTx: number;
  localTz: number;
  terrain: TerrainType;
}

/** Runtime state overlay for a chunk — only stores changes from base data */
export interface ChunkState {
  cx: number;
  cz: number;
  /** Modified tiles (sparse — only tiles that differ from base generation) */
  tileDiffs: TileDiff[];
  /** Object-level state changes keyed by objectId */
  objectStates: Record<string, ObjectStateDiff>;
}

/** A diff for a world object (tree, door, chest, etc.) */
export interface ObjectStateDiff {
  objectId: string;
  destroyed?: boolean;
  interacted?: boolean;
  /** Arbitrary key-value state the server tracks */
  properties?: Record<string, unknown>;
}

/** Payload sent to the client when streaming a chunk */
export interface ChunkPayload {
  cx: number;
  cz: number;
  zoneId: string;
  /** Flat tile array with diffs already applied */
  tiles: TerrainType[];
  /** Active object states within this chunk */
  objects: ObjectStateDiff[];
}

/** Request for chunks around a player position */
export interface ChunkStreamRequest {
  zoneId: string;
  /** Player world X */
  worldX: number;
  /** Player world Z */
  worldZ: number;
  /** How many chunks in each direction (default 2 → 5×5 grid) */
  radius?: number;
}

/** Response with multiple chunks for streaming */
export interface ChunkStreamResponse {
  zoneId: string;
  centerChunk: ChunkCoord;
  chunks: ChunkPayload[];
  /** Chunks that are outside zone bounds (client can treat as void/empty) */
  outOfBounds: ChunkCoord[];
}
