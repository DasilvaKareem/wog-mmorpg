import * as THREE from "three";
import type { TerrainData } from "../types.js";

/**
 * Tile index → color mapping (matches server mapGenerator tile indices).
 * Vertex colors on a plane geometry — zero textures.
 */
const TILE_COLORS: Record<number, [number, number, number]> = {
  // Grass variants
  0: [0.42, 0.74, 0.19], 1: [0.29, 0.54, 0.16], 2: [0.55, 0.84, 0.31],
  3: [0.45, 0.76, 0.28], 4: [0.50, 0.78, 0.25], 5: [0.48, 0.72, 0.30],
  // Dirt / paths
  6: [0.78, 0.63, 0.38], 7: [0.65, 0.52, 0.32], 8: [0.72, 0.58, 0.35], 9: [0.68, 0.55, 0.34],
  // Sand
  10: [0.90, 0.82, 0.60], 11: [0.80, 0.72, 0.50], 12: [0.95, 0.88, 0.68],
  // Mud
  13: [0.48, 0.36, 0.16],
  // Stone
  14: [0.60, 0.60, 0.56], 15: [0.42, 0.42, 0.40],
  // Water
  16: [0.19, 0.41, 0.53], 17: [0.15, 0.35, 0.48], 18: [0.25, 0.50, 0.60],
  19: [0.22, 0.44, 0.55], 20: [0.22, 0.44, 0.55], 21: [0.22, 0.44, 0.55],
  22: [0.22, 0.44, 0.55], 23: [0.20, 0.42, 0.54],
  // Walls / doors
  24: [0.55, 0.40, 0.25], 25: [0.50, 0.50, 0.48], 26: [0.58, 0.42, 0.27],
  27: [0.52, 0.52, 0.50], 28: [0.45, 0.30, 0.18],
  // Roofs
  29: [0.60, 0.35, 0.20], // roof brown
  30: [0.72, 0.28, 0.22], 31: [0.25, 0.35, 0.65], 32: [0.75, 0.30, 0.24], 33: [0.28, 0.38, 0.68],
  34: [0.65, 0.55, 0.40], // floor/interior
  35: [0.55, 0.48, 0.35], // floor dark
  // Trees (light)
  40: [0.20, 0.45, 0.15], 41: [0.22, 0.48, 0.17], 42: [0.18, 0.42, 0.13],
  43: [0.24, 0.50, 0.19], 44: [0.20, 0.46, 0.16],
  // Trees (dark)
  45: [0.14, 0.32, 0.10], 46: [0.16, 0.35, 0.12], 47: [0.12, 0.30, 0.08],
  48: [0.18, 0.38, 0.14], 49: [0.15, 0.33, 0.11],
  // Decorations
  50: [0.50, 0.50, 0.48], 51: [0.45, 0.45, 0.43], 52: [0.35, 0.55, 0.25], 53: [0.40, 0.65, 0.22],
  // Portals
  56: [0.55, 0.30, 0.85], 57: [0.60, 0.35, 0.90],
  // Fences
  58: [0.50, 0.38, 0.22], 59: [0.48, 0.36, 0.20],
};

const DEFAULT_COLOR: [number, number, number] = [0.35, 0.35, 0.35];

const WALL_TILES = new Set([24, 25, 26, 27, 28, 30, 31, 32, 33]);
const TREE_TILES = new Set([40, 41, 42, 43, 44, 45, 46, 47, 48, 49]);
const ROCK_TILES = new Set([50, 51]);
const BUSH_TILES = new Set([52, 53]);
const FENCE_TILES = new Set([58, 59]);
const WATER_TILES = new Set([16, 17, 18, 19, 20, 21, 22, 23]);

// Each tile = 1 Three.js unit. Zone is 64 tiles wide = 64 units.
// Server coords are 0-640 (tileSize=10), so server→3D = x/10.
const TILE_UNIT = 1;

export class TerrainRenderer {
  readonly group = new THREE.Group();
  private waterMeshes: THREE.Mesh[] = [];
  private portalMeshes: THREE.Mesh[] = [];
  private canopyMeshes: { mesh: THREE.Mesh; baseX: number; baseZ: number }[] = [];
  private bushMeshes: THREE.Mesh[] = [];
  private groundMesh: THREE.Mesh | null = null;
  private baseColors: Float32Array | null = null; // snapshot of vertex colors for shimmer
  private elapsed = 0;
  private built = false;
  private elevationData: number[] = [];
  private gridWidth = 0;
  private gridHeight = 0;
  private grassIndices: number[] = []; // vertex indices that are grass tiles

  // Shared materials
  private wallMat = new THREE.MeshLambertMaterial({ color: 0x887766 });
  private trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4226 });
  private canopyLightMat = new THREE.MeshLambertMaterial({ color: 0x2d6a1e });
  private canopyDarkMat = new THREE.MeshLambertMaterial({ color: 0x1a4a0e });
  private rockMat = new THREE.MeshLambertMaterial({ color: 0x777777 });
  private bushMat = new THREE.MeshLambertMaterial({ color: 0x3a7a22 });
  private fenceMat = new THREE.MeshLambertMaterial({ color: 0x8a6a3a });
  private portalMat = new THREE.MeshBasicMaterial({ color: 0x9955dd, transparent: true, opacity: 0.7 });
  private waterMat = new THREE.MeshPhongMaterial({
    color: 0x2266aa, transparent: true, opacity: 0.6, shininess: 80, specular: 0x88bbff,
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

  constructor() {
    this.group.name = "terrain";
  }

  /** Get terrain elevation at a 3D position (x, z in Three.js units) */
  getElevationAt(x: number, z: number): number {
    if (!this.elevationData.length) return 0;
    // 3D coords are 0..gridWidth, tile index = floor(coord)
    const ix = Math.max(0, Math.min(this.gridWidth - 1, Math.floor(x)));
    const iz = Math.max(0, Math.min(this.gridHeight - 1, Math.floor(z)));
    const elev = this.elevationData[iz * this.gridWidth + ix] ?? 0;
    return elev * 0.5; // same multiplier used when building the mesh
  }

  /** Build the zone terrain from v2 terrain data */
  build(data: TerrainData) {
    this.dispose();
    const W = data.width;  // 64
    const H = data.height; // 64
    this.elevationData = data.elevation;
    this.gridWidth = W;
    this.gridHeight = H;

    // ── Ground plane with vertex colors ──
    const planeGeo = new THREE.PlaneGeometry(
      W * TILE_UNIT, H * TILE_UNIT, W, H
    );
    planeGeo.rotateX(-Math.PI / 2);

    const vCount = (W + 1) * (H + 1);
    const colors = new Float32Array(vCount * 3);
    const posAttr = planeGeo.getAttribute("position");

    for (let iz = 0; iz <= H; iz++) {
      for (let ix = 0; ix <= W; ix++) {
        const vi = iz * (W + 1) + ix;
        const tx = Math.min(ix, W - 1);
        const tz = Math.min(iz, H - 1);
        const ti = tz * W + tx;

        const tileIdx = data.ground[ti] ?? 0;
        const elev = (data.elevation[ti] ?? 0) * 0.5;
        const [r, g, b] = TILE_COLORS[tileIdx] ?? DEFAULT_COLOR;

        colors[vi * 3] = r;
        colors[vi * 3 + 1] = g;
        colors[vi * 3 + 2] = b;

        posAttr.setY(vi, posAttr.getY(vi) + elev);
      }
    }

    planeGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    planeGeo.computeVertexNormals();

    const groundMesh = new THREE.Mesh(
      planeGeo,
      new THREE.MeshLambertMaterial({ vertexColors: true })
    );
    // Center the plane so tile (0,0) starts at world origin
    groundMesh.position.set(W * TILE_UNIT / 2, 0, H * TILE_UNIT / 2);
    groundMesh.receiveShadow = true;
    this.group.add(groundMesh);
    this.groundMesh = groundMesh;

    // Store base colors + grass indices for shimmer animation
    this.baseColors = new Float32Array(colors);
    this.grassIndices = [];
    for (let iz = 0; iz <= H; iz++) {
      for (let ix = 0; ix <= W; ix++) {
        const vi = iz * (W + 1) + ix;
        const tx = Math.min(ix, W - 1);
        const tz = Math.min(iz, H - 1);
        const tileIdx = data.ground[tz * W + tx] ?? 0;
        if (tileIdx >= 0 && tileIdx <= 5) {
          this.grassIndices.push(vi);
        }
      }
    }

    // ── Overlay objects + water ──
    for (let iz = 0; iz < H; iz++) {
      for (let ix = 0; ix < W; ix++) {
        const ti = iz * W + ix;
        const wx = ix * TILE_UNIT + TILE_UNIT / 2;
        const wz = iz * TILE_UNIT + TILE_UNIT / 2;
        const elev = (data.elevation[ti] ?? 0) * 0.5;

        // Water on ground layer
        const groundIdx = data.ground[ti] ?? 0;
        if (WATER_TILES.has(groundIdx)) {
          const water = new THREE.Mesh(this.waterTileGeo, this.waterMat);
          water.position.set(wx, 0.05 + elev, wz);
          this.group.add(water);
          this.waterMeshes.push(water);
        }

        // Overlay objects
        const ov = data.overlay[ti] ?? -1;
        if (ov < 0) continue;

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

  /** Animate water, trees, bushes, grass, and portals */
  update(dt: number) {
    if (!this.built) return;
    this.elapsed += dt;
    const t = this.elapsed;

    // ── Water: bob + color shift ──
    for (const w of this.waterMeshes) {
      const phase = t * 1.5 + w.position.x * 0.5 + w.position.z * 0.3;
      w.position.y = 0.05 + Math.sin(phase) * 0.04;
    }
    // Slow water hue shift
    const wh = 0.55 + Math.sin(t * 0.3) * 0.04;
    this.waterMat.color.setHSL(wh, 0.55, 0.35);

    // ── Tree canopy sway (wind) ──
    for (const { mesh: c, baseX, baseZ } of this.canopyMeshes) {
      const phase = t * 0.8 + baseX * 0.4 + baseZ * 0.3;
      c.position.x = baseX + Math.sin(phase) * 0.15;
      c.position.z = baseZ + Math.cos(phase * 0.7) * 0.1;
    }

    // ── Bush rustle ──
    for (const b of this.bushMeshes) {
      const phase = t * 1.8 + b.position.x * 0.9 + b.position.z * 0.7;
      const sway = Math.sin(phase) * 0.02;
      b.scale.setScalar(1 + Math.sin(phase * 1.3) * 0.04);
      b.rotation.y = sway;
    }

    // ── Grass shimmer (vertex color wave) ──
    if (this.groundMesh && this.baseColors && this.grassIndices.length > 0) {
      const geo = this.groundMesh.geometry;
      const colorAttr = geo.getAttribute("color") as THREE.BufferAttribute;
      const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
      const base = this.baseColors;

      for (const vi of this.grassIndices) {
        const px = posAttr.getX(vi);
        const pz = posAttr.getZ(vi);
        // Slow rolling wave of brightness
        const wave = Math.sin(t * 0.6 + px * 0.3 + pz * 0.2) * 0.04
                   + Math.sin(t * 1.1 + px * 0.15 - pz * 0.4) * 0.02;
        colorAttr.setXYZ(
          vi,
          base[vi * 3]     + wave,
          base[vi * 3 + 1] + wave * 1.3, // green shifts more
          base[vi * 3 + 2] + wave * 0.5,
        );
      }
      colorAttr.needsUpdate = true;
    }

    // ── Portals: spin + pulse ──
    for (const p of this.portalMeshes) {
      p.rotation.z += dt * 0.8;
      (p.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(t * 2) * 0.2;
    }
  }

  dispose() {
    // Remove all children but keep the group itself
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }
    this.waterMeshes = [];
    this.portalMeshes = [];
    this.canopyMeshes = [];
    this.bushMeshes = [];
    this.groundMesh = null;
    this.baseColors = null;
    this.grassIndices = [];
    this.elevationData = [];
    this.built = false;
  }
}
