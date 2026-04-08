import * as THREE from "three";
import type { TerrainData } from "../types.js";
import type { EnvironmentAssets } from "./EnvironmentAssets.js";
import { getGradientMap } from "./ToonPipeline.js";

/**
 * Tile index → terrain type mapping.
 * Each type gets its own textured material.
 */
type TerrainType = "grass" | "dirt" | "sand" | "stone" | "water" | "rock" | "structure";

function tileToTerrainType(idx: number): TerrainType {
  if (idx >= 0 && idx <= 5) return "grass";
  if (idx >= 6 && idx <= 9) return "dirt";
  if (idx >= 10 && idx <= 12) return "sand";
  if (idx === 13) return "dirt"; // mud → dirt
  if (idx === 14 || idx === 15) return "stone";
  if (idx >= 16 && idx <= 23) return "water";
  if (idx >= 24 && idx <= 28) return "structure"; // walls/doors
  if (idx >= 29 && idx <= 35) return "structure"; // roofs/floors
  if (idx === 34 || idx === 35) return "dirt"; // interior floors
  return "grass"; // fallback
}

/** Tint multipliers per tile index to keep some variation within each texture type */
const TILE_TINTS: Record<number, [number, number, number]> = {
  0: [1.0, 1.0, 1.0], 1: [0.85, 0.90, 0.85], 2: [1.1, 1.1, 1.05],
  3: [1.05, 1.02, 1.0], 4: [1.08, 1.05, 1.0], 5: [0.95, 0.95, 0.95],
  6: [1.0, 1.0, 1.0], 7: [0.9, 0.9, 0.9], 8: [0.95, 0.95, 0.95], 9: [0.92, 0.92, 0.92],
  10: [1.0, 1.0, 1.0], 11: [0.9, 0.9, 0.85], 12: [1.05, 1.05, 1.0],
  13: [0.7, 0.65, 0.6], // mud is darker dirt
  14: [1.0, 1.0, 1.0], 15: [0.85, 0.85, 0.85],
};

const WALL_TILES = new Set([24, 25, 26, 27, 28, 30, 31, 32, 33]);
const TREE_TILES = new Set([40, 41, 42, 43, 44, 45, 46, 47, 48, 49]);
const ROCK_TILES = new Set([50, 51]);
const BUSH_TILES = new Set([52, 53]);
const FENCE_TILES = new Set([58, 59]);
const WATER_TILES = new Set([16, 17, 18, 19, 20, 21, 22, 23]);
/** Structure ground tiles that should get a 3D floor piece (road/planks) */
const STRUCTURE_FLOOR_TILES = new Set([24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35]);

const TILE_UNIT = 1;

// ── Texture loader (shared) ─────────────────────────────────────────
const loader = new THREE.TextureLoader();
// Resolve texture base to an absolute URL so Three.js can always find them
const BASE = new URL("textures/", new URL(import.meta.env.BASE_URL, window.location.href)).href;

function loadTex(name: string, repeatX = 1, repeatY = 1): THREE.Texture {
  const url = BASE + name;
  const tex = loader.load(
    url,
    () => { console.log(`[Terrain] Texture loaded: ${name}`); },
    undefined,
    (err) => { console.error(`[Terrain] Failed to load texture: ${url}`, err); },
  );
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ── Vertex color fallback for structures ─────────────────────────────
const STRUCTURE_COLORS: Record<number, [number, number, number]> = {
  24: [0.55, 0.40, 0.25], 25: [0.50, 0.50, 0.48], 26: [0.58, 0.42, 0.27],
  27: [0.52, 0.52, 0.50], 28: [0.45, 0.30, 0.18],
  29: [0.60, 0.35, 0.20], 30: [0.72, 0.28, 0.22], 31: [0.25, 0.35, 0.65],
  32: [0.75, 0.30, 0.24], 33: [0.28, 0.38, 0.68],
  34: [0.65, 0.55, 0.40], 35: [0.55, 0.48, 0.35],
};

export class TerrainRenderer {
  readonly group = new THREE.Group();
  private waterMeshes: THREE.Mesh[] = [];
  private portalMeshes: THREE.Mesh[] = [];
  private canopyMeshes: { mesh: THREE.Mesh; baseX: number; baseZ: number }[] = [];
  private bushMeshes: THREE.Mesh[] = [];
  private groundMeshes: THREE.Mesh[] = [];
  private elapsed = 0;
  private built = false;
  private elevationData: number[] = [];
  gridWidth = 0;
  gridHeight = 0;
  private envAssets: EnvironmentAssets | null = null;

  // Shared textures (loaded once)
  private static textures: Record<string, THREE.Texture> | null = null;

  private static getTextures() {
    if (!TerrainRenderer.textures) {
      TerrainRenderer.textures = {
        grass: loadTex("grass.jpg"),
        dirt: loadTex("dirt.jpg"),
        sand: loadTex("sand.jpg"),
        stone: loadTex("stone.jpg"),
        rock: loadTex("rock.jpg"),
        water: loadTex("water.jpg"),
      };
    }
    return TerrainRenderer.textures;
  }

  // Shared overlay materials (toon-shaded)
  private wallMat = new THREE.MeshToonMaterial({ color: 0x887766, gradientMap: getGradientMap() });
  private trunkMat = new THREE.MeshToonMaterial({ color: 0x6b4226, gradientMap: getGradientMap() });
  private canopyLightMat = new THREE.MeshToonMaterial({ color: 0x2d6a1e, gradientMap: getGradientMap() });
  private canopyDarkMat = new THREE.MeshToonMaterial({ color: 0x1a4a0e, gradientMap: getGradientMap() });
  private rockMat = new THREE.MeshToonMaterial({ color: 0x777777, gradientMap: getGradientMap() });
  private bushMat = new THREE.MeshToonMaterial({ color: 0x3a7a22, gradientMap: getGradientMap() });
  private fenceMat = new THREE.MeshToonMaterial({ color: 0x8a6a3a, gradientMap: getGradientMap() });
  private portalMat = new THREE.MeshBasicMaterial({ color: 0x9955dd, transparent: true, opacity: 0.7 });
  private waterOverlayMat = new THREE.MeshToonMaterial({
    color: 0x2266aa, transparent: true, opacity: 0.6, gradientMap: getGradientMap(),
  });

  // Shared geometries
  private wallGeo = new THREE.BoxGeometry(TILE_UNIT, 2, TILE_UNIT);
  private trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, 2.5, 6);
  private canopyGeo = new THREE.SphereGeometry(0.8, 6, 4);
  private rockGeo = new THREE.DodecahedronGeometry(0.4, 0);
  private bushGeo = new THREE.SphereGeometry(0.35, 5, 4);
  private fenceGeo = new THREE.BoxGeometry(TILE_UNIT, 0.8, 0.1);
  private portalGeo = new THREE.TorusGeometry(0.5, 0.12, 8, 16);
  private waterTileGeo = (() => {
    const g = new THREE.PlaneGeometry(TILE_UNIT, TILE_UNIT);
    g.rotateX(-Math.PI / 2);
    return g;
  })();

  constructor(envAssets?: EnvironmentAssets) {
    this.group.name = "terrain";
    this.envAssets = envAssets ?? null;
  }

  getElevationAt(x: number, z: number): number {
    if (!this.elevationData.length) return 0;
    const ix = Math.max(0, Math.min(this.gridWidth - 1, Math.floor(x)));
    const iz = Math.max(0, Math.min(this.gridHeight - 1, Math.floor(z)));
    const elev = this.elevationData[iz * this.gridWidth + ix] ?? 0;
    return elev * 0.5;
  }

  build(data: TerrainData) {
    this.dispose();
    const W = data.width;
    const H = data.height;
    this.elevationData = data.elevation;
    this.gridWidth = W;
    this.gridHeight = H;

    const textures = TerrainRenderer.getTextures();

    // ── Group tiles by terrain type ──
    // For each type, collect tile positions, then build one merged mesh per type.
    const tileBuckets: Record<string, { ix: number; iz: number; tileIdx: number }[]> = {};

    for (let iz = 0; iz < H; iz++) {
      for (let ix = 0; ix < W; ix++) {
        const ti = iz * W + ix;
        const tileIdx = data.ground[ti] ?? 0;
        const type = tileToTerrainType(tileIdx);
        if (!tileBuckets[type]) tileBuckets[type] = [];
        tileBuckets[type].push({ ix, iz, tileIdx });
      }
    }

    // ── Build one textured mesh per terrain type ──
    for (const [type, tiles] of Object.entries(tileBuckets)) {
      const positions: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];
      const colors: number[] = [];
      const indices: number[] = [];

      for (let t = 0; t < tiles.length; t++) {
        const { ix, iz, tileIdx } = tiles[t];
        const ti = iz * W + ix;
        const elev = (data.elevation[ti] ?? 0) * 0.5;
        const x0 = ix * TILE_UNIT;
        const z0 = iz * TILE_UNIT;

        // Get tint for variation
        const tint = TILE_TINTS[tileIdx] ?? [1, 1, 1];

        // 4 vertices per tile quad
        const vi = t * 4;
        // v0: top-left, v1: top-right, v2: bottom-left, v3: bottom-right
        const elev00 = (data.elevation[iz * W + ix] ?? 0) * 0.5;
        const elev10 = (data.elevation[iz * W + Math.min(ix + 1, W - 1)] ?? 0) * 0.5;
        const elev01 = (data.elevation[Math.min(iz + 1, H - 1) * W + ix] ?? 0) * 0.5;
        const elev11 = (data.elevation[Math.min(iz + 1, H - 1) * W + Math.min(ix + 1, W - 1)] ?? 0) * 0.5;

        // Positions (XZ plane, Y = elevation)
        positions.push(x0, elev00, z0);                           // v0
        positions.push(x0 + TILE_UNIT, elev10, z0);               // v1
        positions.push(x0, elev01, z0 + TILE_UNIT);               // v2
        positions.push(x0 + TILE_UNIT, elev11, z0 + TILE_UNIT);   // v3

        // Normals (up, will recompute later)
        normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);

        // UVs - each tile maps to one full texture repeat
        uvs.push(0, 0, 1, 0, 0, 1, 1, 1);

        // Vertex colors for tinting
        for (let v = 0; v < 4; v++) {
          colors.push(tint[0], tint[1], tint[2]);
        }

        // Two triangles per quad (CCW winding so normals face up toward camera)
        indices.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();

      let material: THREE.Material;
      const gm = getGradientMap();
      if (type === "structure") {
        material = new THREE.MeshToonMaterial({ gradientMap: gm, side: THREE.DoubleSide });
      } else if (type === "water") {
        material = new THREE.MeshToonMaterial({
          map: textures.water,
          transparent: true,
          opacity: 0.85,
          gradientMap: gm,
          side: THREE.DoubleSide,
        });
      } else {
        const texName = type as keyof typeof textures;
        const tex = textures[texName];
        if (tex) {
          material = new THREE.MeshToonMaterial({
            map: tex,
            gradientMap: gm,
            side: THREE.DoubleSide,
          });
        } else {
          material = new THREE.MeshToonMaterial({ gradientMap: gm, side: THREE.DoubleSide });
        }
      }

      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      mesh.name = `ground-${type}`;
      this.group.add(mesh);
      this.groundMeshes.push(mesh);
    }

    // ── Overlay objects ──
    const useGlb = this.envAssets?.isReady() ?? false;

    for (let iz = 0; iz < H; iz++) {
      for (let ix = 0; ix < W; ix++) {
        const ti = iz * W + ix;
        const wx = ix * TILE_UNIT + TILE_UNIT / 2;
        const wz = iz * TILE_UNIT + TILE_UNIT / 2;
        const elev = (data.elevation[ti] ?? 0) * 0.5;

        // Water overlay shimmer planes
        const groundIdx = data.ground[ti] ?? 0;
        if (WATER_TILES.has(groundIdx)) {
          const water = new THREE.Mesh(this.waterTileGeo, this.waterOverlayMat);
          water.position.set(wx, 0.08 + elev, wz);
          this.group.add(water);
          this.waterMeshes.push(water);
        }

        // Place 3D floor pieces under structure tiles (road for exterior, planks for interior)
        if (useGlb && STRUCTURE_FLOOR_TILES.has(groundIdx)) {
          const floorAsset = (groundIdx === 34 || groundIdx === 35)
            ? "town_planks" : "town_road";
          const floor = this.envAssets!.place(floorAsset, wx, elev, wz);
          if (floor) this.group.add(floor);
        }

        const ov = data.overlay[ti] ?? -1;
        if (ov < 0) continue;

        // Try GLB model first
        if (useGlb) {
          const assetName = this.envAssets!.getAssetForTile(ov);
          if (assetName) {
            const obj = this.envAssets!.place(assetName, wx, elev, wz);
            if (obj) {
              this.group.add(obj);
              // Track for animations if needed
              if (BUSH_TILES.has(ov)) {
                obj.traverse((c) => { if (c instanceof THREE.Mesh) this.bushMeshes.push(c); });
              } else if (ov === 56 || ov === 57) {
                obj.traverse((c) => { if (c instanceof THREE.Mesh) this.portalMeshes.push(c); });
              }
              continue; // GLB placed, skip primitive fallback
            }
          }
        }

        // Primitive fallback
        if (WALL_TILES.has(ov)) {
          const m = new THREE.Mesh(this.wallGeo, this.wallMat);
          m.position.set(wx, 1 + elev, wz);
          m.castShadow = true;
          this.group.add(m);
        } else if (TREE_TILES.has(ov)) {
          const isDark = ov >= 45;
          const trunk = new THREE.Mesh(this.trunkGeo, this.trunkMat);
          trunk.position.set(wx, 1.25 + elev, wz);
          trunk.castShadow = true;
          this.group.add(trunk);
          const canopy = new THREE.Mesh(this.canopyGeo, isDark ? this.canopyDarkMat : this.canopyLightMat);
          canopy.position.set(wx, 2.8 + elev, wz);
          canopy.castShadow = true;
          this.group.add(canopy);
          this.canopyMeshes.push({ mesh: canopy, baseX: wx, baseZ: wz });
        } else if (ROCK_TILES.has(ov)) {
          const s = ov === 51 ? 1.5 : 1;
          const m = new THREE.Mesh(this.rockGeo, this.rockMat);
          m.position.set(wx, 0.3 * s + elev, wz);
          m.scale.setScalar(s);
          m.castShadow = true;
          this.group.add(m);
        } else if (BUSH_TILES.has(ov)) {
          const m = new THREE.Mesh(this.bushGeo, this.bushMat);
          m.position.set(wx, 0.35 + elev, wz);
          m.castShadow = true;
          this.group.add(m);
          this.bushMeshes.push(m);
        } else if (FENCE_TILES.has(ov)) {
          const m = new THREE.Mesh(this.fenceGeo, this.fenceMat);
          m.position.set(wx, 0.4 + elev, wz);
          m.castShadow = true;
          this.group.add(m);
        } else if (ov === 56 || ov === 57) {
          const m = new THREE.Mesh(this.portalGeo, this.portalMat.clone());
          m.position.set(wx, 1.5 + elev, wz);
          m.rotation.x = Math.PI / 2;
          this.group.add(m);
          this.portalMeshes.push(m);
        }
      }
    }

    this.built = true;
  }

  /** Animate water, trees, bushes, and portals */
  update(dt: number) {
    if (!this.built) return;
    this.elapsed += dt;
    const t = this.elapsed;

    // ── Water overlay: bob ──
    for (const w of this.waterMeshes) {
      const phase = t * 1.5 + w.position.x * 0.5 + w.position.z * 0.3;
      w.position.y = 0.08 + Math.sin(phase) * 0.04;
    }
    const wh = 0.55 + Math.sin(t * 0.3) * 0.04;
    this.waterOverlayMat.color.setHSL(wh, 0.55, 0.35);

    // ── Scroll water texture UVs ──
    for (const mesh of this.groundMeshes) {
      if (mesh.name === "ground-water") {
        const mat = mesh.material as THREE.MeshToonMaterial;
        if (mat.map) {
          mat.map.offset.x = Math.sin(t * 0.15) * 0.3;
          mat.map.offset.y = t * 0.05;
        }
        break;
      }
    }

    // ── Tree canopy sway ──
    for (const { mesh: c, baseX, baseZ } of this.canopyMeshes) {
      const phase = t * 0.8 + baseX * 0.4 + baseZ * 0.3;
      c.position.x = baseX + Math.sin(phase) * 0.15;
      c.position.z = baseZ + Math.cos(phase * 0.7) * 0.1;
    }

    // ── Bush rustle ──
    for (const b of this.bushMeshes) {
      const phase = t * 1.8 + b.position.x * 0.9 + b.position.z * 0.7;
      b.scale.setScalar(1 + Math.sin(phase * 1.3) * 0.04);
      b.rotation.y = Math.sin(phase) * 0.02;
    }

    // ── Portals: spin + pulse ──
    for (const p of this.portalMeshes) {
      p.rotation.z += dt * 0.8;
      (p.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(t * 2) * 0.2;
    }
  }

  dispose() {
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }
    this.waterMeshes = [];
    this.portalMeshes = [];
    this.canopyMeshes = [];
    this.bushMeshes = [];
    this.groundMeshes = [];
    this.elevationData = [];
    this.built = false;
  }
}
