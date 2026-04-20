import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useEditorStore } from "../store/editorStore";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { propColor } from "../tiles/propModels";

const TILE_UNIT = 1;
const ELEV_SCALE = 0.12;
const GAME_UNITS_PER_TILE = 10;

const TREE_TRUNKS = new Set([40, 45]);
const TREE_CANOPY_TL = new Set([41, 46]);
const ROCK_TILES = new Set([50, 51]);
const BUSH_TILES = new Set([52, 53]);
const WATER_TILES = new Set([16, 17, 18, 19, 20, 21, 22, 23]);
const WALL_TILES = new Set([24, 25, 26, 27, 28, 30, 31, 32, 33]);
const DIRT_TILES = new Set([6, 7, 8, 9, 10, 11, 12, 13]);
const SAND_TILES = new Set([10, 11, 12]);
const STONE_TILES = new Set([14, 15]);

function tileColor(idx: number): THREE.Color {
  if (idx <= 0) return new THREE.Color("#2f6a28");
  if (idx === 1) return new THREE.Color("#264f23");
  if (idx === 2) return new THREE.Color("#4a8a38");
  if (idx >= 3 && idx <= 5) return new THREE.Color("#3d7a32");
  if (DIRT_TILES.has(idx)) return new THREE.Color("#8a6033");
  if (SAND_TILES.has(idx)) return new THREE.Color("#d7c290");
  if (STONE_TILES.has(idx)) return new THREE.Color("#8a8a8a");
  if (WATER_TILES.has(idx)) return new THREE.Color("#2b7fb0");
  if (WALL_TILES.has(idx)) return new THREE.Color("#7a5a34");
  if (idx === 29) return new THREE.Color("#a68758");
  if (idx === 34 || idx === 35) return new THREE.Color("#a58855");
  if (idx === 56 || idx === 57) return new THREE.Color("#7a3fbf");
  return new THREE.Color("#2f6a28");
}

function npcColorHex(type: string): string {
  if (type === "mob" || type === "boss") return "#ef4444";
  if (type === "merchant") return "#22c55e";
  if (type === "auctioneer") return "#eab308";
  if (type === "quest-giver") return "#f59e0b";
  if (type === "lore-npc") return "#3b82f6";
  if (type === "trainer" || type === "profession-trainer") return "#a855f7";
  if (type === "guild-registrar") return "#ec4899";
  if (type === "arena-master") return "#f97316";
  return "#94a3b8";
}

export function MapCanvas3D() {
  const mountRef = useRef<HTMLDivElement>(null);
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    worldRoot: THREE.Group;
    entitiesRoot: THREE.Group;
    raycaster: THREE.Raycaster;
    groundMesh: THREE.Mesh | null;
    disposeMeshes: () => void;
  } | null>(null);

  const [hover, setHover] = useState<{ x: number; z: number } | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0c0c0e");
    scene.fog = new THREE.Fog("#0c0c0e", 80, 300);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    camera.position.set(40, 55, 80);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = false;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 5;
    controls.maxDistance = 400;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    const hemi = new THREE.HemisphereLight(0xffffff, 0x2a3a20, 0.9);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(60, 120, 40);
    scene.add(sun);

    const worldRoot = new THREE.Group();
    const entitiesRoot = new THREE.Group();
    scene.add(worldRoot);
    scene.add(entitiesRoot);

    const raycaster = new THREE.Raycaster();

    threeRef.current = {
      renderer,
      scene,
      camera,
      controls,
      worldRoot,
      entitiesRoot,
      raycaster,
      groundMesh: null,
      disposeMeshes: () => {},
    };

    let rafId = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width < 2 || height < 2) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
      threeRef.current?.disposeMeshes();
      threeRef.current = null;
    };
  }, []);

  const zoneId = useEditorStore((s) => s.zoneId);
  const width = useEditorStore((s) => s.width);
  const height = useEditorStore((s) => s.height);
  const ground = useEditorStore((s) => s.ground);
  const overlay = useEditorStore((s) => s.overlay);
  const elevation = useEditorStore((s) => s.elevation);
  const npcs = useEditorStore((s) => s.npcs);
  const props = useEditorStore((s) => s.props);

  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;

    // Dispose previous
    t.disposeMeshes();
    while (t.worldRoot.children.length) t.worldRoot.remove(t.worldRoot.children[0]);
    while (t.entitiesRoot.children.length) t.entitiesRoot.remove(t.entitiesRoot.children[0]);

    const disposables: { dispose: () => void }[] = [];

    // Ground: PlaneGeometry with per-vertex colors and elevation displacement.
    // One vertex per tile corner, so we need (width+1) x (height+1) verts.
    const groundGeo = new THREE.PlaneGeometry(width * TILE_UNIT, height * TILE_UNIT, width, height);
    groundGeo.rotateX(-Math.PI / 2);
    groundGeo.translate((width * TILE_UNIT) / 2, 0, (height * TILE_UNIT) / 2);

    const colorAttr = new Float32Array((width + 1) * (height + 1) * 3);
    const posAttr = groundGeo.attributes.position as THREE.BufferAttribute;

    // Average adjacent tile data to corners for smooth coloring/elevation.
    for (let vy = 0; vy <= height; vy++) {
      for (let vx = 0; vx <= width; vx++) {
        const vi = vy * (width + 1) + vx;
        let r = 0, g = 0, b = 0, elev = 0, n = 0;
        for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
          const tx = vx + dx;
          const ty = vy + dy;
          if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
          const idx = ty * width + tx;
          const groundTile = ground[idx] ?? 0;
          const overlayTile = overlay[idx] ?? -1;
          // Water overlay bleeds into corner color
          const colorSource =
            WATER_TILES.has(overlayTile) ? overlayTile :
            groundTile;
          const c = tileColor(colorSource);
          r += c.r; g += c.g; b += c.b;
          elev += elevation[idx] ?? 0;
          n++;
        }
        if (n > 0) { r /= n; g /= n; b /= n; elev /= n; }
        colorAttr[vi * 3 + 0] = r;
        colorAttr[vi * 3 + 1] = g;
        colorAttr[vi * 3 + 2] = b;
        posAttr.setY(vi, elev * ELEV_SCALE);
      }
    }
    posAttr.needsUpdate = true;
    groundGeo.setAttribute("color", new THREE.BufferAttribute(colorAttr, 3));
    groundGeo.computeVertexNormals();

    const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.name = "ground";
    t.worldRoot.add(groundMesh);
    t.groundMesh = groundMesh;
    disposables.push(groundGeo, groundMat);

    // Helper to evaluate elevation at arbitrary tile coord (for prop/NPC Y).
    const elevAt = (tx: number, ty: number) => {
      const cx = Math.max(0, Math.min(width - 1, Math.floor(tx)));
      const cy = Math.max(0, Math.min(height - 1, Math.floor(ty)));
      return (elevation[cy * width + cx] ?? 0) * ELEV_SCALE;
    };

    // Trees: instanced trunk cylinder + canopy cone per TREE_TRUNK tile.
    const treePositions: { x: number; z: number; dark: boolean }[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const g = ground[idx];
        const o = overlay[idx];
        if (TREE_TRUNKS.has(g) || TREE_TRUNKS.has(o)) {
          treePositions.push({ x: x + 0.5, z: y + 0.5, dark: g === 45 || o === 45 });
        }
      }
    }
    // Also stub "canopy-only" quadrants as small trees so orphans show
    const orphanCanopies: { x: number; z: number; dark: boolean }[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = overlay[y * width + x];
        if (!TREE_CANOPY_TL.has(o) && !(o >= 41 && o <= 49)) continue;
        let nearTrunk = false;
        for (let dy = -1; dy <= 1 && !nearTrunk; dy++) {
          for (let dx = -1; dx <= 1 && !nearTrunk; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const gg = ground[ny * width + nx];
            const oo = overlay[ny * width + nx];
            if (TREE_TRUNKS.has(gg) || TREE_TRUNKS.has(oo)) nearTrunk = true;
          }
        }
        if (!nearTrunk && (o === 41 || o === 46)) {
          // Only spawn one tree per 2x2 canopy group (anchored at the TL)
          orphanCanopies.push({ x: x + 1, z: y + 1, dark: o >= 46 });
        }
      }
    }
    const allTrees = [...treePositions, ...orphanCanopies];
    if (allTrees.length > 0) {
      const trunkGeo = new THREE.CylinderGeometry(0.18, 0.22, 1.6, 6);
      trunkGeo.translate(0, 0.8, 0);
      const canopyGeo = new THREE.ConeGeometry(1.1, 2.2, 10);
      canopyGeo.translate(0, 2.4, 0);
      const lightTrunkMat = new THREE.MeshLambertMaterial({ color: 0x7a4a1e });
      const darkTrunkMat = new THREE.MeshLambertMaterial({ color: 0x4a2a14 });
      const lightCanopyMat = new THREE.MeshLambertMaterial({ color: 0x3f8a32 });
      const darkCanopyMat = new THREE.MeshLambertMaterial({ color: 0x1f4a1c });

      const lightCount = allTrees.filter(t => !t.dark).length;
      const darkCount = allTrees.length - lightCount;

      const makeInst = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number) =>
        n > 0 ? new THREE.InstancedMesh(geo, mat, n) : null;

      const lt = makeInst(trunkGeo, lightTrunkMat, lightCount);
      const dt = makeInst(trunkGeo, darkTrunkMat, darkCount);
      const lc = makeInst(canopyGeo, lightCanopyMat, lightCount);
      const dc = makeInst(canopyGeo, darkCanopyMat, darkCount);

      let li = 0, di = 0;
      const m = new THREE.Matrix4();
      for (const tr of allTrees) {
        const y = elevAt(tr.x, tr.z);
        m.makeTranslation(tr.x, y, tr.z);
        if (tr.dark) {
          dt?.setMatrixAt(di, m);
          dc?.setMatrixAt(di, m);
          di++;
        } else {
          lt?.setMatrixAt(li, m);
          lc?.setMatrixAt(li, m);
          li++;
        }
      }
      for (const im of [lt, dt, lc, dc]) if (im) { im.instanceMatrix.needsUpdate = true; t.worldRoot.add(im); }
      disposables.push(trunkGeo, canopyGeo, lightTrunkMat, darkTrunkMat, lightCanopyMat, darkCanopyMat);
    }

    // Rocks — grey boxes at ROCK_* tiles
    const rockPositions: { x: number; z: number; large: boolean }[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = overlay[y * width + x];
        if (ROCK_TILES.has(o)) rockPositions.push({ x: x + 0.5, z: y + 0.5, large: o === 51 });
      }
    }
    if (rockPositions.length > 0) {
      const smallGeo = new THREE.DodecahedronGeometry(0.35, 0);
      const largeGeo = new THREE.DodecahedronGeometry(0.7, 0);
      const mat = new THREE.MeshLambertMaterial({ color: 0x888888, flatShading: true });
      const sm = new THREE.InstancedMesh(smallGeo, mat, rockPositions.length);
      const lm = new THREE.InstancedMesh(largeGeo, mat, rockPositions.length);
      let si = 0, bi = 0;
      const m = new THREE.Matrix4();
      for (const r of rockPositions) {
        const y = elevAt(r.x, r.z);
        m.makeTranslation(r.x, y + 0.2, r.z);
        if (r.large) lm.setMatrixAt(bi++, m);
        else sm.setMatrixAt(si++, m);
      }
      sm.count = si; lm.count = bi;
      sm.instanceMatrix.needsUpdate = true;
      lm.instanceMatrix.needsUpdate = true;
      t.worldRoot.add(sm); t.worldRoot.add(lm);
      disposables.push(smallGeo, largeGeo, mat);
    }

    // Bushes — small green domes
    const bushPositions: { x: number; z: number }[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = overlay[y * width + x];
        if (BUSH_TILES.has(o)) bushPositions.push({ x: x + 0.5, z: y + 0.5 });
      }
    }
    if (bushPositions.length > 0) {
      const geo = new THREE.SphereGeometry(0.35, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      const mat = new THREE.MeshLambertMaterial({ color: 0x4a7a2e });
      const im = new THREE.InstancedMesh(geo, mat, bushPositions.length);
      const m = new THREE.Matrix4();
      bushPositions.forEach((b, i) => {
        m.makeTranslation(b.x, elevAt(b.x, b.z) + 0.05, b.z);
        im.setMatrixAt(i, m);
      });
      im.instanceMatrix.needsUpdate = true;
      t.worldRoot.add(im);
      disposables.push(geo, mat);
    }

    // Walls — brown boxes spanning one tile, 1 unit tall
    const wallPositions: { x: number; z: number; kind: number }[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const candidate = overlay[idx] >= 0 ? overlay[idx] : ground[idx];
        if (WALL_TILES.has(candidate)) {
          wallPositions.push({ x: x + 0.5, z: y + 0.5, kind: candidate });
        }
      }
    }
    if (wallPositions.length > 0) {
      const geo = new THREE.BoxGeometry(1, 1.5, 1);
      const mat = new THREE.MeshLambertMaterial({ color: 0x8a6a3a });
      const im = new THREE.InstancedMesh(geo, mat, wallPositions.length);
      const m = new THREE.Matrix4();
      wallPositions.forEach((w, i) => {
        m.makeTranslation(w.x, elevAt(w.x, w.z) + 0.75, w.z);
        im.setMatrixAt(i, m);
      });
      im.instanceMatrix.needsUpdate = true;
      t.worldRoot.add(im);
      disposables.push(geo, mat);
    }

    // Water — translucent plane at tiles where water is the overlay
    const waterTiles: { x: number; z: number }[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = overlay[y * width + x];
        const g = ground[y * width + x];
        if (WATER_TILES.has(o) || WATER_TILES.has(g)) waterTiles.push({ x: x + 0.5, z: y + 0.5 });
      }
    }
    if (waterTiles.length > 0) {
      const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const mat = new THREE.MeshLambertMaterial({ color: 0x3fa0d8, transparent: true, opacity: 0.75 });
      const im = new THREE.InstancedMesh(geo, mat, waterTiles.length);
      const m = new THREE.Matrix4();
      waterTiles.forEach((w, i) => {
        m.makeTranslation(w.x, elevAt(w.x, w.z) + 0.05, w.z);
        im.setMatrixAt(i, m);
      });
      im.instanceMatrix.needsUpdate = true;
      t.worldRoot.add(im);
      disposables.push(geo, mat);
    }

    // NPCs — tall colored pins (sphere on cylinder) in game units
    for (const npc of npcs) {
      const tx = npc.x / GAME_UNITS_PER_TILE;
      const tz = npc.y / GAME_UNITS_PER_TILE;
      const y = elevAt(tx, tz);
      const color = new THREE.Color(npcColorHex(npc.type));
      const pin = new THREE.Group();
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6),
        new THREE.MeshLambertMaterial({ color: 0x222222 }),
      );
      post.position.y = 0.6;
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 12, 8),
        new THREE.MeshLambertMaterial({ color }),
      );
      head.position.y = 1.35;
      pin.add(post);
      pin.add(head);
      pin.position.set(tx, y, tz);
      t.entitiesRoot.add(pin);
    }

    // Props — colored cubes in tile units
    for (const p of props) {
      const color = new THREE.Color(propColor(p.model));
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.5),
        new THREE.MeshLambertMaterial({ color }),
      );
      m.position.set(p.x, elevAt(p.x, p.z) + 0.3, p.z);
      m.rotation.y = p.rotY ?? 0;
      t.entitiesRoot.add(m);
    }

    // Zone boundary outline
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(width, 0.2, height)),
      new THREE.LineBasicMaterial({ color: 0xfacc15 }),
    );
    edges.position.set(width / 2, 0.1, height / 2);
    t.worldRoot.add(edges);

    // Center camera on zone on zoneId change
    if (zoneId) {
      const maxDim = Math.max(width, height);
      t.controls.target.set(width / 2, 0, height / 2);
      t.camera.position.set(width / 2 + maxDim * 0.7, maxDim * 0.9, height / 2 + maxDim * 0.9);
      t.controls.update();
    }

    t.disposeMeshes = () => {
      for (const d of disposables) d.dispose();
    };
  }, [zoneId, width, height, ground, overlay, elevation, npcs, props]);

  const onMouseMove = (e: React.MouseEvent) => {
    const t = threeRef.current;
    if (!t || !t.groundMesh) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    t.raycaster.setFromCamera(ndc, t.camera);
    const hit = t.raycaster.intersectObject(t.groundMesh, false)[0];
    if (!hit) { setHover(null); return; }
    const tx = Math.floor(hit.point.x);
    const tz = Math.floor(hit.point.z);
    if (tx < 0 || tz < 0 || tx >= width || tz >= height) { setHover(null); return; }
    setHover({ x: tx, z: tz });
  };

  const onClick = () => {
    if (!hover) return;
    const s = useEditorStore.getState();
    if (s.layer === "npcs" || s.layer === "props") return;
    s.pushUndo();
    if (s.tool === "brush") s.paintTile(hover.x, hover.z);
    else if (s.tool === "eraser") s.eraseTile(hover.x, hover.z);
    else if (s.tool === "fill") s.fillArea(hover.x, hover.z);
    else if (s.tool === "eyedropper") s.eyedrop(hover.x, hover.z);
  };

  return (
    <div
      ref={mountRef}
      className="relative flex-1 overflow-hidden"
      onMouseMove={onMouseMove}
      onClick={onClick}
    >
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex items-center gap-4 bg-zinc-900/90 px-3 py-1 text-xs">
        <span className="text-zinc-300">3D preview</span>
        <span className="text-zinc-500">|</span>
        {hover && <span className="font-mono text-zinc-300">({hover.x}, {hover.z})</span>}
        <span className="ml-auto text-zinc-500">LMB orbit · RMB pan · wheel zoom · click to paint</span>
      </div>
    </div>
  );
}
