/**
 * Loads and caches optimized environment GLB models for use by TerrainRenderer.
 * Models are loaded once and cloned per placement via InstancedMesh or clone().
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { getGradientMap } from "./ToonPipeline.js";

const MODEL_BASE = new URL(
  "models/environment/optimized/",
  new URL(import.meta.env.BASE_URL, window.location.href),
).href;

/** All environment asset names and their default scale in the world */
const ASSET_DEFS: Record<string, { file: string; scale: number; yOffset: number }> = {
  // Trees — old primitives were ~3.5 units tall, models are ~1 unit, so scale ~6x
  oak_tree:     { file: "oak_tree.glb",     scale: 6.0, yOffset: 0 },
  pine_tree:    { file: "pine_tree.glb",    scale: 7.0, yOffset: 0 },
  dead_tree:    { file: "dead_tree.glb",    scale: 5.0, yOffset: 0 },
  tree_stump:   { file: "tree_stump.glb",   scale: 1.2, yOffset: 0 },
  // Rocks
  boulder:      { file: "boulder.glb",      scale: 2.5, yOffset: 0 },
  rock_cluster: { file: "rock_cluster.glb", scale: 1.5, yOffset: 0 },
  // Vegetation
  bush:         { file: "bush.glb",         scale: 1.4, yOffset: 0 },
  // Structures
  stone_wall:   { file: "stone_wall.glb",   scale: 2.5, yOffset: 0 },
  wooden_fence: { file: "wooden_fence.glb", scale: 2.0, yOffset: 0 },
  portal_frame: { file: "portal_frame.glb", scale: 3.5, yOffset: 0 },
  // Resources
  rare_ore:     { file: "rare_ore.glb",     scale: 1.5, yOffset: 0 },
  flower_patch: { file: "flower_patch.glb", scale: 1.2, yOffset: 0 },
  // Mobs
  shadow_wolf:      { file: "shadow_wolf.glb",      scale: 2.0, yOffset: 0 },
  dark_cultist:     { file: "dark_cultist.glb",      scale: 2.2, yOffset: 0 },
  undead_knight:    { file: "undead_knight.glb",     scale: 2.4, yOffset: 0 },
  forest_troll:     { file: "forest_troll.glb",      scale: 2.8, yOffset: 0 },
  ancient_golem:    { file: "ancient_golem.glb",     scale: 3.0, yOffset: 0 },
  necromancer_boss: { file: "necromancer_boss.glb",  scale: 3.5, yOffset: 0 },
};

/** Map from overlay tile index → asset name */
const TILE_TO_ASSET: Record<number, string> = {
  // Trees: 40-44 = light canopy (oak), 45-49 = dark canopy (pine)
  40: "oak_tree", 41: "oak_tree", 42: "oak_tree", 43: "oak_tree", 44: "oak_tree",
  45: "pine_tree", 46: "pine_tree", 47: "pine_tree", 48: "pine_tree", 49: "pine_tree",
  // Rocks: 50 = small, 51 = large boulder
  50: "rock_cluster", 51: "boulder",
  // Bushes
  52: "bush", 53: "bush",
  // Fences
  58: "wooden_fence", 59: "wooden_fence",
  // Portals
  56: "portal_frame", 57: "portal_frame",
  // Walls
  24: "stone_wall", 25: "stone_wall", 26: "stone_wall", 27: "stone_wall", 28: "stone_wall",
  30: "stone_wall", 31: "stone_wall", 32: "stone_wall", 33: "stone_wall",
};

/** Map from mob name substring → asset name */
const MOB_NAME_TO_ASSET: [string, string][] = [
  ["wolf", "shadow_wolf"],
  ["cultist", "dark_cultist"],
  ["undead", "undead_knight"],
  ["skeleton", "undead_knight"],
  ["troll", "forest_troll"],
  ["golem", "ancient_golem"],
  ["necromancer", "necromancer_boss"],
];

export { TILE_TO_ASSET, MOB_NAME_TO_ASSET };

export class EnvironmentAssets {
  private cache = new Map<string, THREE.Object3D>();
  /** Stores the Y offset needed to place each model's bottom on the ground */
  private groundOffsets = new Map<string, number>();
  private loading = new Map<string, Promise<THREE.Object3D>>();
  private loader: GLTFLoader;
  private ready = false;

  constructor() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
    this.loader = new GLTFLoader();
    this.loader.setDRACOLoader(dracoLoader);
  }

  /** Preload all environment assets. Call once at startup. */
  async preload(): Promise<void> {
    console.log(`[EnvAssets] Preloading ${Object.keys(ASSET_DEFS).length} models from ${MODEL_BASE}`);
    const promises = Object.entries(ASSET_DEFS).map(([name, def]) =>
      this.loadAsset(name, def.file).catch((err) => {
        console.warn(`[EnvAssets] Failed to load ${name}: ${err}`);
      }),
    );
    await Promise.allSettled(promises);
    this.ready = true;
    console.log(`[EnvAssets] Loaded ${this.cache.size}/${Object.keys(ASSET_DEFS).length} assets`);
  }

  /** Check if assets have been loaded */
  isReady(): boolean {
    return this.ready;
  }

  /** Number of cached models (for debugging) */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Get a clone of a named asset, positioned and scaled for the world.
   * Returns null if the asset hasn't loaded yet.
   */
  place(assetName: string, x: number, y: number, z: number, extraScale = 1): THREE.Object3D | null {
    const template = this.cache.get(assetName);
    if (!template) return null;

    const def = ASSET_DEFS[assetName];
    if (!def) return null;

    // Deep clone: create a wrapper group and clone each child mesh individually
    const wrapper = new THREE.Group();
    wrapper.name = `env_${assetName}`;
    template.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const m = new THREE.Mesh(child.geometry, child.material);
        m.position.copy(child.position);
        m.rotation.copy(child.rotation);
        m.scale.copy(child.scale);
        m.castShadow = true;
        m.receiveShadow = true;
        wrapper.add(m);
      }
    });

    const s = def.scale * extraScale;
    wrapper.scale.set(s, s, s);
    // Lift model so its bottom sits on the ground (groundOffset is in model space, multiply by scale)
    const groundLift = (this.groundOffsets.get(assetName) ?? 0) * s;
    wrapper.position.set(x, y + groundLift, z);
    // Add slight random rotation for variety (except walls/fences)
    if (!assetName.includes("wall") && !assetName.includes("fence")) {
      wrapper.rotation.y = Math.random() * Math.PI * 2;
    }
    return wrapper;
  }

  /**
   * Get the asset name for an overlay tile index.
   * Returns undefined if the tile doesn't map to a GLB asset.
   */
  getAssetForTile(tileIdx: number): string | undefined {
    return TILE_TO_ASSET[tileIdx];
  }

  /** Match a mob entity name to a GLB asset. Returns undefined if no match. */
  getAssetForMob(entityName: string): string | undefined {
    const lower = entityName.toLowerCase();
    for (const [keyword, asset] of MOB_NAME_TO_ASSET) {
      if (lower.includes(keyword)) return asset;
    }
    return undefined;
  }

  private async loadAsset(name: string, file: string): Promise<THREE.Object3D> {
    // Dedup concurrent loads
    const existing = this.loading.get(name);
    if (existing) return existing;

    const url = MODEL_BASE + file;
    const promise = new Promise<THREE.Object3D>((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          const root = gltf.scene;
          root.name = `env_${name}`;
          // Compute bounding box to find the bottom of the model
          const box = new THREE.Box3().setFromObject(root);
          const bottomY = box.min.y; // negative = model extends below origin
          this.groundOffsets.set(name, -bottomY); // lift by this amount
          // Convert GLB materials to MeshToonMaterial for cel-shading
          const gradMap = getGradientMap();
          let meshCount = 0;
          root.traverse((c) => {
            if (c instanceof THREE.Mesh) {
              meshCount++;
              const mats = Array.isArray(c.material) ? c.material : [c.material];
              const toonMats = mats.map((mat: THREE.Material) => {
                const std = mat as THREE.MeshStandardMaterial;
                return new THREE.MeshToonMaterial({
                  color: std.color ?? 0xffffff,
                  map: std.map ?? undefined,
                  gradientMap: gradMap,
                  transparent: std.transparent,
                  opacity: std.opacity,
                  side: std.side,
                });
              });
              c.material = toonMats.length === 1 ? toonMats[0] : toonMats;
            }
          });
          console.log(`[EnvAssets] ${name}: ${meshCount} meshes (toon), bottomY=${bottomY.toFixed(3)}`);
          this.cache.set(name, root);
          this.loading.delete(name);
          resolve(root);
        },
        undefined,
        (err) => {
          console.error(`[EnvAssets] Load error for ${url}:`, err);
          this.loading.delete(name);
          reject(err);
        },
      );
    });

    this.loading.set(name, promise);
    return promise;
  }
}
