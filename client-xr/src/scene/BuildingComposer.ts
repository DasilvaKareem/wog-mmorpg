import * as THREE from "three";
import type { TerrainData } from "../types.js";
import type { EnvironmentAssets } from "./EnvironmentAssets.js";

/**
 * Composes town buildings from contiguous interior-floor tile clusters.
 *
 * Ground tiles 34/35 mark building interiors. The composer flood-fills each
 * cluster, then assembles:
 *   - plank floor on every interior tile
 *   - perimeter walls on sides facing outside (one door on the longest external edge)
 *   - flat roof at wall-height over the footprint
 *
 * Kenney Town Kit pieces are grid-native (~1 unit). We force extraScale = 1/3
 * so the final scale is 1.0 regardless of the decorative default of 3.0.
 *
 * Returned `handledTiles` contains all footprint tile indices so the caller
 * can skip overlay wall/roof placement on them.
 */

const INTERIOR_TILES = new Set([34, 35]);
const WALL_OVERLAYS = new Set([24, 25, 26, 27, 28, 30, 31, 32, 33]);

const TILE_UNIT = 1;
const ELEV_SCALE = 0.12;
const BUILDING_PIECE_SCALE = 1 / 3; // cancels TOWN_ASSET_DEFS default of 3.0

export interface BuildingResult {
  group: THREE.Group;
  handledTiles: Set<number>;
}

export { WALL_OVERLAYS };

export function composeBuildings(
  data: TerrainData,
  envAssets: EnvironmentAssets,
): BuildingResult {
  const group = new THREE.Group();
  group.name = "buildings";
  const handledTiles = new Set<number>();
  const W = data.width;
  const H = data.height;

  if (!envAssets.isTownReady()) return { group, handledTiles };

  const footprints = findFootprints(data, W, H);

  for (const cells of footprints) {
    composeBuilding(cells, data, W, H, envAssets, group, handledTiles);
  }

  return { group, handledTiles };
}

function findFootprints(
  data: TerrainData,
  W: number,
  H: number,
): Array<Array<{ ix: number; iz: number }>> {
  const visited = new Array<boolean>(W * H).fill(false);
  const footprints: Array<Array<{ ix: number; iz: number }>> = [];

  for (let iz = 0; iz < H; iz++) {
    for (let ix = 0; ix < W; ix++) {
      const ti = iz * W + ix;
      if (visited[ti]) continue;
      if (!INTERIOR_TILES.has(data.ground[ti] ?? 0)) continue;

      const cells: Array<{ ix: number; iz: number }> = [];
      const stack: Array<{ ix: number; iz: number }> = [{ ix, iz }];
      visited[ti] = true;

      while (stack.length) {
        const c = stack.pop()!;
        cells.push(c);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = c.ix + dx;
          const nz = c.iz + dz;
          if (nx < 0 || nx >= W || nz < 0 || nz >= H) continue;
          const nti = nz * W + nx;
          if (visited[nti]) continue;
          if (!INTERIOR_TILES.has(data.ground[nti] ?? 0)) continue;
          visited[nti] = true;
          stack.push({ ix: nx, iz: nz });
        }
      }

      if (cells.length >= 1) footprints.push(cells);
    }
  }

  return footprints;
}

function composeBuilding(
  cells: Array<{ ix: number; iz: number }>,
  data: TerrainData,
  W: number,
  H: number,
  envAssets: EnvironmentAssets,
  group: THREE.Group,
  handledTiles: Set<number>,
) {
  const cellSet = new Set(cells.map((c) => c.iz * W + c.ix));

  const isOutside = (ix: number, iz: number) => {
    if (ix < 0 || ix >= W || iz < 0 || iz >= H) return true;
    return !cellSet.has(iz * W + ix);
  };

  const SIDES = [
    { dx: 0, dz: -1, offX: 0,    offZ: -0.5, rotY: 0 },              // north
    { dx: 1, dz: 0,  offX: 0.5,  offZ: 0,    rotY: Math.PI / 2 },    // east
    { dx: 0, dz: 1,  offX: 0,    offZ: 0.5,  rotY: Math.PI },        // south
    { dx: -1, dz: 0, offX: -0.5, offZ: 0,    rotY: -Math.PI / 2 },   // west
  ] as const;

  // Pick door: first perimeter tile with an east-facing outside neighbor.
  // Falls back to any perimeter side if none face east.
  let doorKey = "";
  for (const c of cells) {
    if (isOutside(c.ix + 1, c.iz)) {
      doorKey = `${c.ix},${c.iz},E`;
      break;
    }
  }
  if (!doorKey) {
    outer: for (const c of cells) {
      for (const s of SIDES) {
        if (isOutside(c.ix + s.dx, c.iz + s.dz)) {
          const dir = s.dx === 1 ? "E" : s.dx === -1 ? "W" : s.dz === 1 ? "S" : "N";
          doorKey = `${c.ix},${c.iz},${dir}`;
          break outer;
        }
      }
    }
  }

  for (const c of cells) {
    const ti = c.iz * W + c.ix;
    handledTiles.add(ti);
    const wx = c.ix * TILE_UNIT + TILE_UNIT / 2;
    const wz = c.iz * TILE_UNIT + TILE_UNIT / 2;
    const elev = (data.elevation[ti] ?? 0) * ELEV_SCALE;

    const floor = envAssets.placeTown("town_planks", wx, elev, wz, 0, BUILDING_PIECE_SCALE);
    if (floor) group.add(floor);

    for (const s of SIDES) {
      if (!isOutside(c.ix + s.dx, c.iz + s.dz)) continue;
      const dir = s.dx === 1 ? "E" : s.dx === -1 ? "W" : s.dz === 1 ? "S" : "N";
      const isDoor = doorKey === `${c.ix},${c.iz},${dir}`;
      const wallAsset = isDoor ? "town_wall_door" : "town_wall";
      const wall = envAssets.placeTown(
        wallAsset,
        wx + s.offX,
        elev,
        wz + s.offZ,
        s.rotY,
        BUILDING_PIECE_SCALE,
      );
      if (wall) group.add(wall);
    }

    const roof = envAssets.placeTown("town_roof_flat", wx, elev, wz, 0, BUILDING_PIECE_SCALE);
    if (roof) group.add(roof);
  }
}
