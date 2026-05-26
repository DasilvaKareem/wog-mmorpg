import * as THREE from "three";
import { getGradientMap } from "./ToonPipeline.js";

/**
 * Rolling foothills filling the ground between each zone-edge cliff and the
 * distant HorizonBackdrop silhouettes. Without these, looking past a zone
 * boundary shows pure fog. Purely decorative — no collision.
 *
 * Same cell-edge enumeration as HorizonBackdrop. Single shared MeshToonMaterial
 * across all tiles; per-tile noise-seeded geometry built once at layout time.
 */

/** Tile span along the edge tangent (3D units). 96 vs 64 cell-width gives ~16u corner overlap. */
const SKIRT_WIDTH = 96;
/** Outward reach from the cliff edge (3D units). Past BACKDROP_DISTANCE=35 so silhouettes sit on top. */
const SKIRT_DEPTH = 55;
/** Along-edge vertex resolution. */
const SKIRT_SEGS_W = 16;
/** Outward vertex resolution. */
const SKIRT_SEGS_D = 8;
/** Peak hill height (3D units). */
const HILL_AMP = 9;
/** Inner-row Y; matches cliff base. */
const HILL_BASE_Y = 0;

/** 2D folded-sine octaves — same recipe as HorizonBackdrop.buildRidgeProfile, extended to 2D. */
function ridgeNoise2D(u: number, v: number, seed: number): number {
  let h = 0;
  let freq = 1.6;
  let amp = 1;
  for (let o = 0; o < 4; o++) {
    const px = u * freq * Math.PI * 2 + seed * 0.73 + o * 1.31;
    const py = v * freq * Math.PI * 1.7 + seed * 0.41 + o * 0.97;
    const n = Math.abs(
      Math.sin(px + Math.sin(py * 1.3 + seed) * 0.5) *
      Math.sin(py + Math.sin(px * 1.1 + seed * 0.5) * 0.4),
    );
    h += n * amp;
    freq *= 1.85;
    amp *= 0.55;
  }
  return Math.min(1, h / 1.7);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Build a heightmap tile. Local axes: +X along the edge tangent, +Y up,
 * +Z outward from the zone. Caller rotates/places.
 */
function buildSkirtGeometry(seed: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const halfW = SKIRT_WIDTH / 2;

  for (let j = 0; j <= SKIRT_SEGS_D; j++) {
    const v = j / SKIRT_SEGS_D;
    for (let i = 0; i <= SKIRT_SEGS_W; i++) {
      const u = i / SKIRT_SEGS_W;
      const x = -halfW + u * SKIRT_WIDTH;
      const z = v * SKIRT_DEPTH;
      // Fade along edge tangent so adjacent tiles blend at zone corners.
      const edgeFade = Math.sin(Math.PI * u);
      // Stay flat for the first chunk outward — keeps cliff base clean.
      const depthRamp = smoothstep(0.0, 0.25, v);
      const n = ridgeNoise2D(u * 2.0, v * 1.5, seed);
      let y = HILL_BASE_Y + n * HILL_AMP * edgeFade * depthRamp;
      // Slight dip in the first 10% outward so the energy-wall foot reads
      // planted in the ground, not floating over a hairline seam.
      if (v < 0.1) {
        const t = v / 0.1;
        y = y * t - 0.5 * (1 - t);
      }
      positions.push(x, y, z);

      // Aerial-perspective vertex color: darker near base, lighter near peaks.
      const heightT = Math.max(0, Math.min(1, y / HILL_AMP));
      const r = 0.12 + 0.10 * heightT;
      const g = 0.20 + 0.16 * heightT;
      const b = 0.13 + 0.08 * heightT;
      colors.push(r, g, b);
    }
  }

  const stride = SKIRT_SEGS_W + 1;
  for (let j = 0; j < SKIRT_SEGS_D; j++) {
    for (let i = 0; i < SKIRT_SEGS_W; i++) {
      const a = j * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export class TerrainSkirt {
  readonly group = new THREE.Group();
  private mat: THREE.MeshToonMaterial;
  private baseColor = new THREE.Color(0x2d4a2a);
  private targetColor = new THREE.Color(0x2d4a2a);

  constructor() {
    this.group.name = "terrain-skirt";
    this.mat = new THREE.MeshToonMaterial({
      color: this.baseColor,
      gradientMap: getGradientMap(),
      vertexColors: true,
      side: THREE.FrontSide,
      fog: true,
    });
  }

  /**
   * Build foothill tiles at every cell edge that has no neighbor.
   * Pass the same cell grid `buildBorders` and `HorizonBackdrop.build` use.
   */
  build(cells: { gx: number; gz: number; ox: number; oz: number }[], cellSize: number) {
    this.dispose();

    const occupied = new Set<string>();
    for (const c of cells) occupied.add(`${c.gx},${c.gz}`);

    const dirs: { dx: number; dz: number; axis: "x" | "z"; dir: 1 | -1 }[] = [
      { dx: 1, dz: 0, axis: "x", dir: 1 },   // east
      { dx: -1, dz: 0, axis: "x", dir: -1 }, // west
      { dx: 0, dz: 1, axis: "z", dir: 1 },   // south
      { dx: 0, dz: -1, axis: "z", dir: -1 }, // north
    ];

    for (const cell of cells) {
      for (const d of dirs) {
        const nKey = `${cell.gx + d.dx},${cell.gz + d.dz}`;
        if (occupied.has(nKey)) continue;

        const cellCx = cell.ox + cellSize / 2;
        const cellCz = cell.oz + cellSize / 2;
        const edgeCx = cellCx + (d.axis === "x" ? d.dir * cellSize / 2 : 0);
        const edgeCz = cellCz + (d.axis === "z" ? d.dir * cellSize / 2 : 0);

        // Different salt constants from HorizonBackdrop so skirt noise differs from silhouette noise.
        const seed = ((cell.gx * 73856093) ^ (cell.gz * 19349663) ^ (d.dx * 12289027) ^ (d.dz * 7068923)) >>> 0;
        const geo = buildSkirtGeometry(seed);

        const mesh = new THREE.Mesh(geo, this.mat);
        mesh.position.set(edgeCx, 0, edgeCz);
        // Rotate so geometry's local +Z (outward) aligns with the edge's outward world normal.
        // World rotation about Y by θ sends local (0,0,1) → (sinθ, 0, cosθ).
        if (d.axis === "x" && d.dir > 0) mesh.rotation.y = Math.PI / 2;        // east: outward +X
        else if (d.axis === "x" && d.dir < 0) mesh.rotation.y = -Math.PI / 2;  // west: outward -X
        else if (d.axis === "z" && d.dir > 0) mesh.rotation.y = 0;             // south: outward +Z
        else mesh.rotation.y = Math.PI;                                        // north: outward -Z

        mesh.frustumCulled = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.group.add(mesh);
      }
    }
  }

  /**
   * Lerp toward 65% blend of the current fog color (vs HorizonBackdrop's 40%).
   * Keeps the hills readable as mid-ground rather than fading them fully into
   * the horizon tint.
   */
  update(_dt: number, fogColor: THREE.Color) {
    this.targetColor.copy(fogColor).lerp(this.baseColor, 0.65);
    this.mat.color.lerp(this.targetColor, 0.05);
  }

  dispose() {
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    }
  }
}
