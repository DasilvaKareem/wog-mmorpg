/**
 * Loads and caches optimized environment GLB models for use by TerrainRenderer.
 * Models are loaded once and cloned per placement via InstancedMesh or clone().
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

const MODEL_BASE = new URL(
  "models/environment/optimized/",
  new URL(import.meta.env.BASE_URL, window.location.href),
).href;

/** All environment asset names and their default scale in the world */
const ASSET_DEFS: Record<string, { file: string; scale: number; yOffset: number }> = {
  // Trees
  oak_tree:     { file: "oak_tree.glb",     scale: 1.8, yOffset: 0 },
  pine_tree:    { file: "pine_tree.glb",    scale: 1.8, yOffset: 0 },
  dead_tree:    { file: "dead_tree.glb",    scale: 1.6, yOffset: 0 },
  tree_stump:   { file: "tree_stump.glb",   scale: 0.6, yOffset: 0 },
  // Rocks
  boulder:      { file: "boulder.glb",      scale: 1.2, yOffset: 0 },
  rock_cluster: { file: "rock_cluster.glb", scale: 0.8, yOffset: 0 },
  // Vegetation
  bush:         { file: "bush.glb",         scale: 0.7, yOffset: 0 },
  // Structures
  stone_wall:   { file: "stone_wall.glb",   scale: 1.0, yOffset: 0 },
  wooden_fence: { file: "wooden_fence.glb", scale: 0.9, yOffset: 0 },
  portal_frame: { file: "portal_frame.glb", scale: 1.4, yOffset: 0 },
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

export { TILE_TO_ASSET };

export class EnvironmentAssets {
  private cache = new Map<string, THREE.Object3D>();
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

  /**
   * Get a clone of a named asset, positioned and scaled for the world.
   * Returns null if the asset hasn't loaded yet.
   */
  place(assetName: string, x: number, y: number, z: number, extraScale = 1): THREE.Object3D | null {
    const template = this.cache.get(assetName);
    if (!template) return null;

    const def = ASSET_DEFS[assetName];
    if (!def) return null;

    const clone = template.clone();
    const s = def.scale * extraScale;
    clone.scale.set(s, s, s);
    clone.position.set(x, y + def.yOffset, z);
    // Add slight random rotation for variety (except walls/fences)
    if (!assetName.includes("wall") && !assetName.includes("fence")) {
      clone.rotation.y = Math.random() * Math.PI * 2;
    }
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return clone;
  }

  /**
   * Get the asset name for an overlay tile index.
   * Returns undefined if the tile doesn't map to a GLB asset.
   */
  getAssetForTile(tileIdx: number): string | undefined {
    return TILE_TO_ASSET[tileIdx];
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
          this.cache.set(name, root);
          this.loading.delete(name);
          resolve(root);
        },
        undefined,
        (err) => {
          this.loading.delete(name);
          reject(err);
        },
      );
    });

    this.loading.set(name, promise);
    return promise;
  }
}
