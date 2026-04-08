/**
 * Loads Quaternius GLB character models, applies dynamic skin/hair/eye colors,
 * and provides equipment attachment points via skeleton bones.
 *
 * All 52 models share the same 23-joint skeleton so animations and equipment
 * are cross-compatible. BaseCharacter is the naked base; other models provide
 * armor/outfit overlays whose primitives can be extracted and re-attached.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { getGradientMap } from "./ToonPipeline.js";

const CHAR_BASE = new URL(
  "models/characters/",
  new URL(import.meta.env.BASE_URL, window.location.href),
).href;

/* ── WoG class → Quaternius model mapping ─────────────────────────── */

/** Which GLB to load for each WoG class — base clothed models with class-tinted outfit */
const CLASS_TO_MODEL: Record<string, string> = {
  warrior:  "Casual_Male",
  mage:     "Casual2_Male",
  ranger:   "Casual3_Male",
  cleric:   "Casual_Male",
  rogue:    "Casual3_Male",
  paladin:  "Casual_Male",
  warlock:  "Casual2_Male",
  monk:     "Casual3_Male",
};

/** Female overrides */
const CLASS_TO_MODEL_FEMALE: Record<string, string> = {
  warrior:  "Casual_Female",
  mage:     "Casual2_Female",
  ranger:   "Casual3_Female",
  cleric:   "Casual_Female",
  rogue:    "Casual3_Female",
  paladin:  "Casual_Female",
  warlock:  "Casual2_Female",
  monk:     "Casual3_Female",
};

/** NPC type → model */
const NPC_MODEL: Record<string, string> = {
  merchant:       "OldClassy_Male",
  "quest-giver":  "Cowboy_Male",
  "guild-registrar": "Suit_Male",
  "crafting-master": "Worker_Male",
  "profession-trainer": "Chef_Male",
  "arena-master":  "Viking_Male",
  "lore-npc":     "Wizard",
  "auctioneer":   "Pirate_Male",
};

/** Skeleton bone names in the Quaternius models */
const BONE_NAMES = {
  root: "Bone",
  body: "Body",
  hips: "Hips",
  abdomen: "Abdomen",
  torso: "Torso",
  neck: "Neck",
  head: "Head",
  shoulderL: "Shoulder.L",
  upperArmL: "UpperArm.L",
  lowerArmL: "LowerArm.L",
  fistL: "Fist.L",
  shoulderR: "Shoulder.R",
  upperArmR: "UpperArm.R",
  lowerArmR: "LowerArm.R",
  fistR: "Fist.R",
  upperLegL: "UpperLeg.L",
  lowerLegL: "LowerLeg.L",
  upperLegR: "UpperLeg.R",
  lowerLegR: "LowerLeg.R",
  footL: "Foot.L",
  footR: "Foot.R",
} as const;

/** Materials that map to customizable character colors */
const SKIN_MATERIALS = new Set(["Skin"]);
const HAIR_MATERIALS = new Set(["Hair", "Moustache"]);
const FACE_MATERIALS = new Set(["Face"]);
const OUTFIT_MATERIALS = new Set(["Shirt", "Clothes", "Main", "Armor", "Top", "Jacket"]);
const PANTS_MATERIALS = new Set(["Pants"]);

/** Class → outfit color */
const CLASS_OUTFIT_COLOR: Record<string, number> = {
  warrior: 0xcc3333,
  paladin: 0xe6c830,
  mage:    0x3366dd,
  cleric:  0xeeeeff,
  ranger:  0x33aa44,
  rogue:   0x8833bb,
  warlock: 0x33bb66,
  monk:    0xe69628,
};

/** Result of building a character — everything needed by EntityManager */
export interface CharacterInstance {
  /** Root THREE.Group containing the skinned mesh and skeleton */
  group: THREE.Group;
  /** AnimationMixer for playing clips */
  mixer: THREE.AnimationMixer;
  /** Available animation clips by name */
  clips: Map<string, THREE.AnimationClip>;
  /** Named bones for equipment attachment */
  bones: Record<string, THREE.Bone>;
  /** The skinned mesh (for raycasting, highlight, etc.) */
  skinnedMesh: THREE.SkinnedMesh | null;
}

/* ── Cache ─────────────────────────────────────────────────────────── */

interface CachedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

export class CharacterAssets {
  private cache = new Map<string, CachedModel>();
  private loading = new Map<string, Promise<CachedModel>>();
  private loader = new GLTFLoader();
  private baseReady = false;

  /** Preload BaseCharacter + all class models so first spawn is instant */
  async preload(): Promise<void> {
    const models = new Set<string>(["BaseCharacter"]);
    for (const m of Object.values(CLASS_TO_MODEL)) models.add(m);
    for (const m of Object.values(CLASS_TO_MODEL_FEMALE)) models.add(m);
    for (const m of Object.values(NPC_MODEL)) models.add(m);

    console.log(`[CharAssets] Preloading ${models.size} character models`);
    const promises = [...models].map((name) =>
      this.loadModel(name).catch((err) => {
        console.warn(`[CharAssets] Failed to load ${name}: ${err}`);
      }),
    );
    await Promise.allSettled(promises);
    this.baseReady = true;
    console.log(`[CharAssets] Loaded ${this.cache.size}/${models.size} characters`);
  }

  isReady(): boolean {
    return this.baseReady;
  }

  /**
   * Build a fully rigged character instance with custom colors.
   * Returns a group with SkinnedMesh, AnimationMixer, and bone references.
   */
  buildCharacter(opts: {
    modelName?: string;
    wogClass?: string;
    isFemale?: boolean;
    npcType?: string;
    skinColor?: number;
    hairColor?: number;
    eyeColor?: number;
    outfitColor?: number;
    scale?: number;
  }): CharacterInstance | null {
    // Resolve which model to use
    let modelName = opts.modelName;
    if (!modelName) {
      if (opts.npcType && NPC_MODEL[opts.npcType]) {
        modelName = NPC_MODEL[opts.npcType];
      } else if (opts.wogClass) {
        const cls = opts.wogClass.toLowerCase();
        modelName = (opts.isFemale && CLASS_TO_MODEL_FEMALE[cls])
          ? CLASS_TO_MODEL_FEMALE[cls]
          : (CLASS_TO_MODEL[cls] ?? (opts.isFemale ? "Casual_Female" : "Casual_Male"));
      } else {
        modelName = opts.isFemale ? "Casual_Female" : "Casual_Male";
      }
    }

    const cached = this.cache.get(modelName);
    if (!cached) {
      console.warn(`[CharAssets] Model "${modelName}" not in cache (cache has: ${[...this.cache.keys()].join(", ")})`);
      return null;
    }

    const gradMap = getGradientMap();
    const group = new THREE.Group();
    group.name = `char_${modelName}`;

    // Clone the scene — must use SkeletonUtils to preserve skeleton bindings
    const clone = SkeletonUtils.clone(cached.scene);

    // Find the SkinnedMesh and bones
    let skinnedMesh: THREE.SkinnedMesh | null = null;
    const bones: Record<string, THREE.Bone> = {};

    clone.traverse((node) => {
      if (node instanceof THREE.SkinnedMesh && !skinnedMesh) {
        skinnedMesh = node;
      }
      if (node instanceof THREE.Bone) {
        bones[node.name] = node;
      }
    });

    if (!skinnedMesh) {
      console.warn(`[CharAssets] No SkinnedMesh in ${modelName}`);
      return null;
    }

    // Remap materials with custom colors and toon shading
    const sm = skinnedMesh as THREE.SkinnedMesh;
    const srcMats = Array.isArray(sm.material) ? sm.material : [sm.material];
    const toonMats = srcMats.map((mat: THREE.Material) => {
      const std = mat as THREE.MeshStandardMaterial;
      const name = std.name ?? "";
      let color = std.color?.clone() ?? new THREE.Color(0xffffff);

      // Apply custom colors based on material name
      if (SKIN_MATERIALS.has(name) && opts.skinColor != null) {
        color = new THREE.Color(opts.skinColor);
      } else if (HAIR_MATERIALS.has(name) && opts.hairColor != null) {
        color = new THREE.Color(opts.hairColor);
      } else if (FACE_MATERIALS.has(name)) {
        // Face is skin-toned
        color = new THREE.Color(opts.skinColor ?? 0xffe0bd);
      } else if (OUTFIT_MATERIALS.has(name)) {
        // Shirt/outfit tinted by class or explicit override
        const cls = opts.wogClass?.toLowerCase() ?? "";
        color = new THREE.Color(opts.outfitColor ?? CLASS_OUTFIT_COLOR[cls] ?? 0x666688);
      } else if (PANTS_MATERIALS.has(name)) {
        // Pants get a neutral tone
        color = new THREE.Color(0x444455);
      }

      return new THREE.MeshToonMaterial({
        color,
        gradientMap: gradMap,
        side: std.side,
      });
    });
    sm.material = toonMats.length === 1 ? toonMats[0] : toonMats;
    sm.castShadow = true;
    sm.frustumCulled = false; // skinned meshes can pop out of frustum easily

    // Apply scale
    const s = opts.scale ?? 1.0;
    clone.scale.setScalar(s);

    group.add(clone);

    // Set up animation mixer with cloned clips
    const mixer = new THREE.AnimationMixer(clone);
    const clips = new Map<string, THREE.AnimationClip>();
    for (const clip of cached.animations) {
      clips.set(clip.name, clip);
    }

    return { group, mixer, clips, bones, skinnedMesh: sm };
  }

  /**
   * Attach an object (weapon, shield, etc.) to a character's bone.
   */
  attachToBone(
    character: CharacterInstance,
    boneName: keyof typeof BONE_NAMES | string,
    object: THREE.Object3D,
  ): boolean {
    const resolvedName = (BONE_NAMES as Record<string, string>)[boneName] ?? boneName;
    const bone = character.bones[resolvedName];
    if (!bone) {
      console.warn(`[CharAssets] Bone "${resolvedName}" not found`);
      return false;
    }
    bone.add(object);
    return true;
  }

  /**
   * Play a named animation clip on a character.
   * Returns the action for further control (crossfade, loop, etc.)
   */
  playAnimation(
    character: CharacterInstance,
    animName: string,
    opts?: { loop?: boolean; fadeIn?: number; timeScale?: number },
  ): THREE.AnimationAction | null {
    const clip = character.clips.get(animName);
    if (!clip) return null;

    const action = character.mixer.clipAction(clip);
    action.setLoop(
      opts?.loop !== false ? THREE.LoopRepeat : THREE.LoopOnce,
      opts?.loop !== false ? Infinity : 1,
    );
    if (opts?.loop === false) action.clampWhenFinished = true;
    if (opts?.fadeIn) action.fadeIn(opts.fadeIn);
    if (opts?.timeScale) action.timeScale = opts.timeScale;
    action.play();
    return action;
  }

  /** Get available animation names for a model */
  getAnimationNames(modelName: string): string[] {
    const cached = this.cache.get(modelName);
    return cached ? cached.animations.map((c) => c.name) : [];
  }

  /** Get the bone name constants for equipment attachment */
  getBoneNames() {
    return BONE_NAMES;
  }

  /* ── Internal ──────────────────────────────────────────────────── */

  private async loadModel(name: string): Promise<CachedModel> {
    const existing = this.loading.get(name);
    if (existing) return existing;

    const cached = this.cache.get(name);
    if (cached) return cached;

    const url = CHAR_BASE + name + ".glb";
    const promise = new Promise<CachedModel>((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          const model: CachedModel = {
            scene: gltf.scene,
            animations: gltf.animations,
          };
          this.cache.set(name, model);
          this.loading.delete(name);
          const animNames = gltf.animations.map((a) => a.name);
          console.log(`[CharAssets] ${name}: ${animNames.length} anims (${animNames.join(", ")})`);
          resolve(model);
        },
        undefined,
        (err) => {
          console.error(`[CharAssets] Failed to load ${url}:`, err);
          this.loading.delete(name);
          reject(err);
        },
      );
    });

    this.loading.set(name, promise);
    return promise;
  }
}

export { CLASS_TO_MODEL, CLASS_TO_MODEL_FEMALE, NPC_MODEL, BONE_NAMES };
