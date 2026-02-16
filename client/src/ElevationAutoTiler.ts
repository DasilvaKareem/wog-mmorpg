import { OW_TILES } from "./OverworldAtlas.js";

/**
 * ElevationAutoTiler — determines which cliff edge tiles to place based on
 * elevation differences between neighboring tiles.
 *
 * For each tile, compares its elevation to 4 cardinal + 4 diagonal neighbors.
 * Where elevation drops, places cliff face / edge tiles from the Overworld
 * spritesheet.
 *
 * This is a client-side post-process on the elevation data — no server logic.
 */

/** Result of auto-tiling: a cliff overlay tile index or -1 for no cliff */
export interface CliffTileResult {
  /** Overworld tile index for the cliff overlay, or -1 if none */
  tileIndex: number;
  /** The elevation level this cliff tile visually belongs to */
  renderElevation: number;
}

/**
 * For a given tile position, determine if a cliff edge tile should be placed.
 *
 * @param elevation - Flat elevation array for the chunk/zone
 * @param x - Tile x position within the grid
 * @param z - Tile z position within the grid
 * @param w - Width of the grid in tiles
 * @param h - Height of the grid in tiles
 * @returns CliffTileResult with tile index and render elevation, or null if no cliff
 */
export function getCliffTile(
  elevation: number[],
  x: number,
  z: number,
  w: number,
  h: number,
): CliffTileResult | null {
  const idx = z * w + x;
  const myElev = elevation[idx];

  // Sample neighbors: N, S, E, W, NE, NW, SE, SW
  const n  = z > 0     ? elevation[(z - 1) * w + x]     : myElev;
  const s  = z < h - 1 ? elevation[(z + 1) * w + x]     : myElev;
  const e  = x < w - 1 ? elevation[z * w + (x + 1)]     : myElev;
  const ww = x > 0     ? elevation[z * w + (x - 1)]     : myElev;
  const ne = z > 0 && x < w - 1     ? elevation[(z - 1) * w + (x + 1)] : myElev;
  const nw = z > 0 && x > 0         ? elevation[(z - 1) * w + (x - 1)] : myElev;
  const se = z < h - 1 && x < w - 1 ? elevation[(z + 1) * w + (x + 1)] : myElev;
  const sw = z < h - 1 && x > 0     ? elevation[(z + 1) * w + (x - 1)] : myElev;

  // Check if this tile is higher than any neighbor (cliff source)
  const dropN  = myElev > n;
  const dropS  = myElev > s;
  const dropE  = myElev > e;
  const dropW  = myElev > ww;
  const dropNE = myElev > ne;
  const dropNW = myElev > nw;
  const dropSE = myElev > se;
  const dropSW = myElev > sw;

  const hasAnyDrop = dropN || dropS || dropE || dropW || dropNE || dropNW || dropSE || dropSW;
  if (!hasAnyDrop) return null;

  // Determine cliff tile based on which directions have drops
  let tileIndex: number;

  // Cardinal edges (single side drops)
  if (dropS && !dropE && !dropW && !dropN) {
    tileIndex = OW_TILES.CLIFF_EDGE_B;
  } else if (dropN && !dropE && !dropW && !dropS) {
    tileIndex = OW_TILES.CLIFF_EDGE_T;
  } else if (dropE && !dropN && !dropS && !dropW) {
    tileIndex = OW_TILES.CLIFF_EDGE_R;
  } else if (dropW && !dropN && !dropS && !dropE) {
    tileIndex = OW_TILES.CLIFF_EDGE_L;
  }
  // Outer corners (two adjacent cardinal drops)
  else if (dropS && dropE && !dropN && !dropW) {
    tileIndex = OW_TILES.CLIFF_OUTER_BR;
  } else if (dropS && dropW && !dropN && !dropE) {
    tileIndex = OW_TILES.CLIFF_OUTER_BL;
  } else if (dropN && dropE && !dropS && !dropW) {
    tileIndex = OW_TILES.CLIFF_OUTER_TR;
  } else if (dropN && dropW && !dropS && !dropE) {
    tileIndex = OW_TILES.CLIFF_OUTER_TL;
  }
  // Inner corners (only diagonal drop, no cardinal drops)
  else if (!dropN && !dropS && !dropE && !dropW && dropSE) {
    tileIndex = OW_TILES.CLIFF_INNER_BR;
  } else if (!dropN && !dropS && !dropE && !dropW && dropSW) {
    tileIndex = OW_TILES.CLIFF_INNER_BL;
  } else if (!dropN && !dropS && !dropE && !dropW && dropNE) {
    tileIndex = OW_TILES.CLIFF_INNER_TR;
  } else if (!dropN && !dropS && !dropE && !dropW && dropNW) {
    tileIndex = OW_TILES.CLIFF_INNER_TL;
  }
  // Full cliff face (3+ sides dropping)
  else if (dropN && dropS && dropE && dropW) {
    tileIndex = OW_TILES.CLIFF_FACE;
  }
  // Edge + corner combos: prefer the edge tile
  else if (dropS) {
    tileIndex = OW_TILES.CLIFF_EDGE_B;
  } else if (dropN) {
    tileIndex = OW_TILES.CLIFF_EDGE_T;
  } else if (dropE) {
    tileIndex = OW_TILES.CLIFF_EDGE_R;
  } else if (dropW) {
    tileIndex = OW_TILES.CLIFF_EDGE_L;
  }
  // Fallback: cliff face
  else {
    tileIndex = OW_TILES.CLIFF_FACE;
  }

  return { tileIndex, renderElevation: myElev };
}

/**
 * Generate a full cliff overlay layer for a chunk.
 *
 * @param elevation - Flat elevation array (CHUNK_SIZE * CHUNK_SIZE)
 * @param w - Grid width
 * @param h - Grid height
 * @returns Array of cliff tile indices (-1 = no cliff) and corresponding elevations
 */
export function generateCliffLayer(
  elevation: number[],
  w: number,
  h: number,
): { cliffTiles: number[]; cliffElevations: number[] } {
  const cliffTiles = new Array(w * h).fill(-1);
  const cliffElevations = new Array(w * h).fill(0);

  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const result = getCliffTile(elevation, x, z, w, h);
      const idx = z * w + x;
      if (result) {
        cliffTiles[idx] = result.tileIndex;
        cliffElevations[idx] = result.renderElevation;
      } else {
        cliffElevations[idx] = elevation[idx];
      }
    }
  }

  return { cliffTiles, cliffElevations };
}
