import * as THREE from "three";
import { TerrainRenderer } from "./TerrainRenderer.js";
import { CollisionMap } from "./CollisionMap.js";
import { EnvironmentAssets } from "./EnvironmentAssets.js";
import { CharacterAssets } from "./CharacterAssets.js";
import { ArmorSystem } from "./ArmorSystem.js";
import { fetchTerrain } from "../api.js";
import type { WorldLayout, WorldLayoutZone, ElevationProvider } from "../types.js";

const COORD_SCALE = 1 / 10;
/** All terrain grids are 64x64 tiles = 64 3D units */
const TERRAIN_SIZE = 64;

/** Load zones within this radius (3D units) of camera */
const LOAD_RADIUS = 90;
/** Unload zones beyond this radius */
const UNLOAD_RADIUS = 120;

/** Border wall height */
const WALL_HEIGHT = 12;
/** Border wall color */
const WALL_COLOR = 0x4488cc;

interface ZoneSlot {
  info: WorldLayoutZone;
  terrain: TerrainRenderer | null;
  collision: CollisionMap | null;
  terrainData: import("../types.js").TerrainData | null;
  loading: boolean;
  /** Zone origin in 3D world units */
  worldOffset: THREE.Vector2;
  /** Zone center in 3D world units */
  center: THREE.Vector2;
  /** Zone size in 3D world units */
  sizeUnits: THREE.Vector2;
}

/**
 * Manages all zone terrains in a unified world coordinate space.
 * Loads/unloads zone terrain based on camera proximity.
 *
 * Coordinate convention:
 *   Server coords: offset.x, offset.z, size.width, size.height (e.g. 640)
 *   3D world units: server * COORD_SCALE (e.g. 64)
 */
export class WorldManager implements ElevationProvider {
  readonly group = new THREE.Group();
  private zones = new Map<string, ZoneSlot>();
  private layout: WorldLayout | null = null;
  private borderGroup = new THREE.Group();
  private borderElapsed = 0;
  private borderWalls: THREE.Mesh[] = [];
  private envAssets = new EnvironmentAssets();
  private charAssets = new CharacterAssets();
  private armorSystem = new ArmorSystem();
  private envAssetsReady: Promise<void>;

  constructor() {
    this.group.name = "world";
    this.borderGroup.name = "borders";
    this.group.add(this.borderGroup);
    // Start preloading environment + town + character + armor GLB models immediately
    this.envAssetsReady = Promise.all([
      this.envAssets.preload(),
      this.envAssets.preloadTown(),
      this.charAssets.preload(),
      this.armorSystem.preload(),
    ]).then(() => {
      // Rebuild any zones that were loaded before assets were ready
      this.rebuildZonesWithAssets();
    });
  }

  /** Get the shared environment assets instance */
  getEnvironmentAssets(): EnvironmentAssets {
    return this.envAssets;
  }

  /** Get the shared character assets instance */
  getCharacterAssets(): CharacterAssets {
    return this.charAssets;
  }

  /** Get the shared armor system instance */
  getArmorSystem(): ArmorSystem {
    return this.armorSystem;
  }

  /** Initialize from the /world/layout response */
  setLayout(layout: WorldLayout) {
    this.layout = layout;
    for (const [id, zone] of Object.entries(layout.zones)) {
      // Convert everything from server coords to 3D units
      const ox = zone.offset.x * COORD_SCALE;
      const oz = zone.offset.z * COORD_SCALE;
      const sw = zone.size.width * COORD_SCALE;
      const sh = zone.size.height * COORD_SCALE;
      this.zones.set(id, {
        info: zone,
        terrain: null,
        collision: null,
        terrainData: null,
        loading: false,
        worldOffset: new THREE.Vector2(ox, oz),
        center: new THREE.Vector2(ox + sw / 2, oz + sh / 2),
        sizeUnits: new THREE.Vector2(sw, sh),
      });
    }
    this.buildBorders();
  }

  /**
   * Build border walls along world edges where no neighboring zone exists.
   * Uses a grid of occupied 64x64 cells to detect boundaries.
   */
  private buildBorders() {
    // Build set of occupied grid cells (keyed by cell coords)
    const occupied = new Set<string>();
    const cells: { gx: number; gz: number; ox: number; oz: number }[] = [];

    for (const zone of this.zones.values()) {
      // Grid cell coords (integer, e.g. 0,0  1,0  2,0 ...)
      const gx = Math.round(zone.worldOffset.x / TERRAIN_SIZE);
      const gz = Math.round(zone.worldOffset.y / TERRAIN_SIZE);
      const key = `${gx},${gz}`;
      if (!occupied.has(key)) {
        occupied.add(key);
        cells.push({ gx, gz, ox: gx * TERRAIN_SIZE, oz: gz * TERRAIN_SIZE });
      }
    }

    // Shared wall material — custom shader for energy barrier effect
    const wallMat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(WALL_COLOR) },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          // Fade: solid at bottom, transparent at top
          float fade = 1.0 - vUv.y * vUv.y;
          // Pulse effect
          float pulse = 0.6 + 0.2 * sin(uTime * 1.5 + vUv.x * 8.0);
          // Horizontal energy lines
          float lines = 0.05 * step(0.95, fract(vUv.y * 20.0 + uTime * 0.3));
          float alpha = fade * pulse + lines;
          // Brighten near bottom
          vec3 col = uColor + vec3(0.2, 0.3, 0.4) * (1.0 - vUv.y) * 0.5;
          gl_FragColor = vec4(col, alpha * 0.45);
        }
      `,
    });

    // Check each cell's 4 edges
    // Directions: +X (east), -X (west), +Z (south), -Z (north)
    const dirs = [
      { dx: 1, dz: 0, axis: "z" as const, side: 1 },   // east wall
      { dx: -1, dz: 0, axis: "z" as const, side: 0 },   // west wall
      { dx: 0, dz: 1, axis: "x" as const, side: 1 },    // south wall
      { dx: 0, dz: -1, axis: "x" as const, side: 0 },   // north wall
    ];

    const wallGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, WALL_HEIGHT);

    for (const cell of cells) {
      for (const dir of dirs) {
        const neighborKey = `${cell.gx + dir.dx},${cell.gz + dir.dz}`;
        if (occupied.has(neighborKey)) continue;

        // No neighbor on this side — place a wall
        const wall = new THREE.Mesh(wallGeo, wallMat);

        if (dir.axis === "z") {
          // East or west edge — wall faces X direction
          const wx = cell.ox + (dir.side === 1 ? TERRAIN_SIZE : 0);
          const wz = cell.oz + TERRAIN_SIZE / 2;
          wall.position.set(wx, WALL_HEIGHT / 2, wz);
          wall.rotation.y = Math.PI / 2;
        } else {
          // North or south edge — wall faces Z direction
          const wx = cell.ox + TERRAIN_SIZE / 2;
          const wz = cell.oz + (dir.side === 1 ? TERRAIN_SIZE : 0);
          wall.position.set(wx, WALL_HEIGHT / 2, wz);
          // PlaneGeometry faces +Z by default, no rotation needed
        }

        this.borderGroup.add(wall);
        this.borderWalls.push(wall);
      }
    }
  }

  /** Call each frame with camera target position (3D world coords) */
  updateLoading(cameraX: number, cameraZ: number) {
    for (const [id, zone] of this.zones) {
      const dx = cameraX - zone.center.x;
      const dz = cameraZ - zone.center.y;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < LOAD_RADIUS && !zone.terrain && !zone.loading) {
        this.loadZone(id);
      } else if (dist > UNLOAD_RADIUS && zone.terrain) {
        this.unloadZone(id);
      }
    }
  }

  private async loadZone(id: string) {
    const zone = this.zones.get(id);
    if (!zone) return;
    zone.loading = true;

    // Wait for both terrain data AND environment assets in parallel
    const [data] = await Promise.all([
      fetchTerrain(id),
      this.envAssetsReady,
    ]);
    zone.loading = false;
    if (!data) return;

    console.log(`[World] Building zone ${id} (envAssets ready: ${this.envAssets.isReady()}, cached: ${this.envAssets.getCacheSize()})`);

    const terrain = new TerrainRenderer(this.envAssets);
    terrain.build(data, id);
    terrain.group.position.set(zone.worldOffset.x, 0, zone.worldOffset.y);
    this.group.add(terrain.group);
    zone.terrain = terrain;
    zone.terrainData = data;
    zone.collision = new CollisionMap(data);
  }

  private unloadZone(id: string) {
    const zone = this.zones.get(id);
    if (!zone?.terrain) return;
    this.group.remove(zone.terrain.group);
    zone.terrain.dispose();
    zone.terrain = null;
    zone.collision = null;
  }

  /** Get terrain elevation at world 3D coordinates */
  getElevationAt(worldX: number, worldZ: number): number {
    for (const zone of this.zones.values()) {
      if (!zone.terrain) continue;
      const localX = worldX - zone.worldOffset.x;
      const localZ = worldZ - zone.worldOffset.y;
      // Use actual terrain grid dimensions (always 64x64 tiles = 64 3D units)
      if (
        localX >= 0 && localX < zone.terrain.gridWidth &&
        localZ >= 0 && localZ < zone.terrain.gridHeight
      ) {
        return zone.terrain.getElevationAt(localX, localZ);
      }
    }
    return 0;
  }

  /** Check if a world position is walkable (not blocked by walls/trees/water/borders) */
  isWalkable(worldX: number, worldZ: number): boolean {
    for (const zone of this.zones.values()) {
      if (!zone.collision) continue;
      const localX = worldX - zone.worldOffset.x;
      const localZ = worldZ - zone.worldOffset.y;
      if (
        localX >= 0 && localX < zone.collision.width &&
        localZ >= 0 && localZ < zone.collision.height
      ) {
        return zone.collision.isWalkable(localX, localZ);
      }
    }
    // Outside all loaded zones = not walkable
    return false;
  }

  /** Get zone IDs within a radius of a world position */
  getNearbyZoneIds(worldX: number, worldZ: number, radius: number): string[] {
    const result: string[] = [];
    for (const [id, zone] of this.zones) {
      const dx = worldX - zone.center.x;
      const dz = worldZ - zone.center.y;
      if (Math.sqrt(dx * dx + dz * dz) < radius) {
        result.push(id);
      }
    }
    return result;
  }

  /** Get all loaded zone IDs */
  getLoadedZoneIds(): string[] {
    const result: string[] = [];
    for (const [id, zone] of this.zones) {
      if (zone.terrain) result.push(id);
    }
    return result;
  }

  /** Get the center of a zone in world 3D coords */
  getZoneCenter(zoneId: string): { x: number; z: number } | null {
    const zone = this.zones.get(zoneId);
    if (!zone) return null;
    return { x: zone.center.x, z: zone.center.y };
  }

  /** Get all zone IDs in order */
  getZoneIds(): string[] {
    return Array.from(this.zones.keys());
  }

  /** Update all loaded terrain animations + border pulse */
  updateAnimations(dt: number) {
    for (const zone of this.zones.values()) {
      zone.terrain?.update(dt);
    }

    // Animate border walls
    if (this.borderWalls.length > 0) {
      this.borderElapsed += dt;
      const mat = this.borderWalls[0].material as THREE.ShaderMaterial;
      mat.uniforms.uTime.value = this.borderElapsed;
    }
  }

  /** Rebuild all loaded zones so they use GLB models instead of primitives */
  private rebuildZonesWithAssets() {
    for (const [id, zone] of this.zones) {
      if (!zone.terrain || !zone.terrainData) continue;
      const pos = zone.terrain.group.position.clone();
      this.group.remove(zone.terrain.group);
      zone.terrain.dispose();
      const terrain = new TerrainRenderer(this.envAssets);
      terrain.build(zone.terrainData, id);
      terrain.group.position.copy(pos);
      this.group.add(terrain.group);
      zone.terrain = terrain;
    }
    console.log("[World] Rebuilt zones with environment assets");
  }

  dispose() {
    for (const [id] of this.zones) {
      this.unloadZone(id);
    }
  }
}
