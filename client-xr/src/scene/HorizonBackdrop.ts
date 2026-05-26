import * as THREE from "three";
import { getGradientMap } from "./ToonPipeline.js";

/**
 * Renders a low-poly silhouette mountain ridge along every world-edge cell
 * that has no neighbor — purely decorative, gives the world a sense of
 * continuing beyond the playable bounds. Sits just outside the existing
 * energy-wall borders.
 *
 * Geometry is shared across all backdrop instances; only material/transform
 * vary. Total cost is ~60 triangles per backdrop × ~30 edges ≈ trivial.
 */

/** Distance from the world edge (3D units) to the backdrop midline. */
const BACKDROP_DISTANCE = 35;
/** Width of each backdrop in 3D units. Slight overlap with neighbors at corners. */
const BACKDROP_WIDTH = 96;
/** Peak height of the ridge silhouette in 3D units. */
const BACKDROP_HEIGHT = 26;
/** Number of vertices along the top edge — controls silhouette resolution. */
const RIDGE_SEGMENTS = 36;

interface CellEdge {
  /** West edge of cell at world (ox, oz) — i.e., world boundary at x = ox in -X direction */
  ox: number;
  oz: number;
  /** Cell side length in 3D units (always 64 today). */
  size: number;
  /** Outward direction: +1 east, -1 west (X axis), or +1 south, -1 north (Z axis). */
  axis: "x" | "z";
  dir: 1 | -1;
}

/**
 * Build a ridge profile: array of y-heights along the top edge of the
 * silhouette. Multi-octave folded sine produces organic-looking peaks
 * without pulling in a real noise library.
 */
function buildRidgeProfile(seed: number): number[] {
  const heights: number[] = [];
  for (let i = 0; i <= RIDGE_SEGMENTS; i++) {
    const t = i / RIDGE_SEGMENTS;
    let h = 0;
    let freq = 1.6;
    let amp = 1;
    for (let o = 0; o < 4; o++) {
      const phase = t * freq * Math.PI * 2 + seed * 0.73 + o * 1.31;
      const n = Math.abs(Math.sin(phase + Math.sin(phase * 1.3 + seed) * 0.5));
      h += n * amp;
      freq *= 1.85;
      amp *= 0.55;
    }
    const normalized = Math.min(1, h / 1.7);
    // Pull the very edges down a touch so adjacent backdrops blend at corners.
    const edgeFade = Math.sin(Math.PI * t);
    heights.push(Math.max(0.15, normalized) * edgeFade * BACKDROP_HEIGHT);
  }
  return heights;
}

/**
 * Build the buffer geometry for a single backdrop. Local coords: X along the
 * ridge width (-W/2..+W/2), Y is height (0 = ground, +Y = ridgeline), Z = 0.
 * Caller positions + rotates the resulting mesh.
 */
function buildRidgeGeometry(seed: number): THREE.BufferGeometry {
  const heights = buildRidgeProfile(seed);
  const halfW = BACKDROP_WIDTH / 2;
  const baseY = -2; // dip the base slightly below ground so the seam hides
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= RIDGE_SEGMENTS; i++) {
    const x = -halfW + (i / RIDGE_SEGMENTS) * BACKDROP_WIDTH;
    positions.push(x, baseY, 0);            // bottom
    positions.push(x, heights[i], 0);       // top
  }
  for (let i = 0; i < RIDGE_SEGMENTS; i++) {
    const b0 = i * 2;
    const t0 = b0 + 1;
    const b1 = b0 + 2;
    const t1 = b0 + 3;
    indices.push(b0, b1, t0);
    indices.push(t0, b1, t1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export class HorizonBackdrop {
  readonly group = new THREE.Group();
  private mat: THREE.MeshToonMaterial;
  private baseColor = new THREE.Color(0x1a2030);
  private targetColor = new THREE.Color(0x1a2030);

  constructor() {
    this.group.name = "horizon-backdrop";
    // Single shared material — silhouettes can all be the same flat dark tone.
    // Fog is enabled, so Three.js fades each mesh toward the scene fog color
    // automatically (matches whatever time-of-day SkyRenderer is rendering).
    this.mat = new THREE.MeshToonMaterial({
      color: this.baseColor,
      gradientMap: getGradientMap(),
      side: THREE.DoubleSide,
      fog: true,
    });
  }

  /**
   * Build silhouette ridges at every cell edge that has no neighbor.
   * Pass the same cell grid `buildBorders` uses (cells in 3D-unit coords).
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

        // Cell-edge midpoint (3D world coords)
        const cellCx = cell.ox + cellSize / 2;
        const cellCz = cell.oz + cellSize / 2;
        const edgeCx = cellCx + (d.axis === "x" ? d.dir * cellSize / 2 : 0);
        const edgeCz = cellCz + (d.axis === "z" ? d.dir * cellSize / 2 : 0);

        // Backdrop center: push outward past the edge.
        const cx = edgeCx + (d.axis === "x" ? d.dir * BACKDROP_DISTANCE : 0);
        const cz = edgeCz + (d.axis === "z" ? d.dir * BACKDROP_DISTANCE : 0);

        // Unique seed per backdrop so neighbors don't get identical profiles.
        const seed = (cell.gx * 73856093) ^ (cell.gz * 19349663) ^ (d.dx * 83492791) ^ (d.dz * 50331653);
        const geo = buildRidgeGeometry(seed >>> 0);

        const mesh = new THREE.Mesh(geo, this.mat);
        mesh.position.set(cx, 0, cz);
        // Rotate so the geometry's local +X faces along the edge tangent and
        // its +Y is up. Geometry is defined in XY plane (Z=0) by default;
        // rotation depends on which axis the edge runs along.
        if (d.axis === "x") {
          // East/west edge — the ridge should run along Z. Rotate 90° about Y.
          mesh.rotation.y = Math.PI / 2;
        }
        // North/south edge — geometry's +X already runs along world X, no rotation needed.

        // Face the silhouette inward toward the playable side. With DoubleSide
        // it renders both ways, but flipping the normal direction here helps
        // toon lighting pick the front face based on the sun.
        if (d.axis === "x" && d.dir > 0) mesh.rotation.y += Math.PI;
        if (d.axis === "z" && d.dir > 0) mesh.rotation.y += Math.PI;

        this.group.add(mesh);
      }
    }
  }

  /**
   * Lerp the material color toward a darker version of the current fog color
   * so the silhouette tracks time of day (e.g. orange at sunset, deep blue
   * at night). Cheap — single material shared across all backdrops.
   */
  update(_dt: number, fogColor: THREE.Color) {
    // Target: 40% of the fog color (a darker tint of whatever the sky is
    // currently doing). This keeps the silhouette visible against the fog
    // without making it pure black at night.
    this.targetColor.copy(fogColor).multiplyScalar(0.4);
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
