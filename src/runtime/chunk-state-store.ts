import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chunkKey, type ChunkState } from "../types/chunk.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, "../data");
const chunkStateDir = resolve(dataDir, "chunk-states");

/** Serialized format for a zone's chunk states file */
interface ZoneChunkStatesFile {
  zoneId: string;
  updatedAt: string;
  states: ChunkState[];
}

/**
 * Persists chunk state diffs (modified tiles, object states) to disk.
 *
 * Each zone gets a single JSON file: chunk-states/{zoneId}.json
 * containing only chunks that have been modified from their base generation.
 * This keeps storage minimal — unmodified chunks use zero disk space.
 */
export class ChunkStateStore {

  /** Ensure the chunk-states directory exists */
  static init(): void {
    if (!existsSync(chunkStateDir)) {
      mkdirSync(chunkStateDir, { recursive: true });
      console.log(`[ChunkStateStore] Created chunk-states directory`);
    }
  }

  /** Load all chunk states for a zone (returns empty map if no file) */
  static loadZoneStates(zoneId: string): Map<string, ChunkState> {
    const filePath = resolve(chunkStateDir, `${zoneId}.json`);
    const states = new Map<string, ChunkState>();

    if (!existsSync(filePath)) return states;

    const data = JSON.parse(readFileSync(filePath, "utf-8")) as ZoneChunkStatesFile;
    for (const state of data.states) {
      states.set(chunkKey(state.cx, state.cz), state);
    }

    console.log(`[ChunkStateStore] Loaded ${states.size} chunk states for "${zoneId}"`);
    return states;
  }

  /** Save all chunk states for a zone (only non-empty states) */
  static saveZoneStates(zoneId: string, states: Map<string, ChunkState>): void {
    ChunkStateStore.init();
    const filePath = resolve(chunkStateDir, `${zoneId}.json`);

    // Only persist states that actually have diffs
    const nonEmpty = Array.from(states.values()).filter(
      s => s.tileDiffs.length > 0 || Object.keys(s.objectStates).length > 0,
    );

    if (nonEmpty.length === 0) {
      // No diffs to persist — clean up file if it exists
      return;
    }

    const fileData: ZoneChunkStatesFile = {
      zoneId,
      updatedAt: new Date().toISOString(),
      states: nonEmpty,
    };

    writeFileSync(filePath, JSON.stringify(fileData, null, 2), "utf-8");
    console.log(`[ChunkStateStore] Saved ${nonEmpty.length} chunk states for "${zoneId}"`);
  }
}
