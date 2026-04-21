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
const CHARACTER_MODEL_VERSION = "2026-04-20a";

function appendCharacterVersion(url: string): string {
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) return url;
  if (/[?&]v=/.test(url)) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${CHARACTER_MODEL_VERSION}`;
}

function characterModelUrl(name: string, ext: "glb" | "gltf"): string {
  return appendCharacterVersion(`${CHAR_BASE}${name}.${ext}`);
}

function createCharacterLoader(): GLTFLoader {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (!url) return url;
    if (url.startsWith("data:") || url.startsWith("blob:")) return url;
    return appendCharacterVersion(url);
  });
  return new GLTFLoader(manager);
}

/* ── WoG class → Quaternius model mapping ─────────────────────────── */

/** Class → authored Quaternius RPG model. Paladin shares Warrior, warlock shares Wizard. */
const CLASS_MODELS: Record<string, string> = {
  warrior: "Warrior",
  paladin: "Warrior",
  cleric: "Cleric",
  ranger: "Ranger",
  rogue: "Rogue",
  monk: "Monk",
  mage: "Wizard",
  warlock: "Wizard",
};

/** NPC type → base Quaternius model (never a player class). */
const NPC_MODEL: Record<string, string> = {
  merchant:             "OldClassy_Male",
  "quest-giver":        "Cowboy_Male",
  "guild-registrar":    "Suit_Male",
  "crafting-master":    "Worker_Male",
  "profession-trainer": "Chef_Male",
  "arena-master":       "Viking_Male",
  "lore-npc":           "Witch",
  "auctioneer":         "Pirate_Male",
  trainer:              "Knight_Male",
};

/**
 * Class trainer (type=trainer, teachesClass=X) → themed base model.
 * Each class trainer reads as a distinct archetype — paladin is a gold knight,
 * rogue is a ninja, mage is a witch, monk is a kimono martial artist, etc.
 * Warrior and warlock share models with their class but get a dark atlas tint
 * (see `TRAINER_TINT`) so they don't look identical to the player class model.
 */
const TRAINER_BY_CLASS: Record<string, string> = {
  warrior:  "Knight_Male",
  paladin:  "Knight_Golden_Male",
  cleric:   "OldClassy_Male",
  mage:     "Witch",
  warlock:  "Zombie_Male",
  ranger:   "Cowboy_Hair",
  rogue:    "Ninja_Male_Hair",
  monk:     "Kimono_Male",
};

/** Profession trainer → themed base model (defaults to Chef_Male). */
const TRAINER_BY_PROFESSION: Record<string, string> = {
  mining:         "Worker_Male",
  blacksmithing:  "Viking_Male",
  herbalism:      "Chef_Female",
  alchemy:        "Witch",
  skinning:       "Cowboy_Male",
  cooking:        "Chef_Male",
  leatherworking: "Worker_Female",
  jewelcrafting:  "OldClassy_Female",
  enchanting:     "Kimono_Female",
};

/** Default base model for any unrecognized NPC type. */
const DEFAULT_NPC_MODEL = "BlueSoldier_Male";

/**
 * Atlas-color multipliers applied to baked-texture trainer materials so
 * trainers that share a body with a player class read as distinct. Keyed by
 * `teachesClass`. Classes with a unique themed model (paladin, mage, rogue,
 * monk) need no tint.
 */
const TRAINER_TINT: Record<string, number> = {
  warrior: 0x333333, // black-knight warrior trainer
  warlock: 0x663399, // dark-purple zombie warlock trainer
  ranger:  0x6a8a4a, // forest-green ranger trainer
  cleric:  0xffeebb, // warm holy cream cleric trainer
};

/** Skeleton bone names in the Quaternius models (dots stripped by SkeletonUtils.clone) */
const BONE_NAMES = {
  root: "Bone",
  body: "Body_1",
  hips: "Hips",
  abdomen: "Abdomen",
  torso: "Torso",
  neck: "Neck",
  head: "Head",
  shoulderL: "ShoulderL",
  upperArmL: "UpperArmL",
  lowerArmL: "LowerArmL",
  fistL: "FistL",
  shoulderR: "ShoulderR",
  upperArmR: "UpperArmR",
  lowerArmR: "LowerArmR",
  fistR: "FistR",
  upperLegL: "UpperLegL",
  lowerLegL: "LowerLegL",
  upperLegR: "UpperLegR",
  lowerLegR: "LowerLegR",
  footL: "FootL",
  footR: "FootR",
} as const;

/** Materials that map to customizable character colors */
const SKIN_MATERIALS = new Set(["Skin"]);
const HAIR_MATERIALS = new Set(["Hair", "Moustache"]);
const FACE_MATERIALS = new Set(["Face"]);
const OUTFIT_MATERIALS = new Set(["Shirt", "Clothes", "Main", "Armor", "Top", "Jacket"]);
const PANTS_MATERIALS = new Set(["Pants"]);

function isBakedAtlasMaterial(name: string): boolean {
  return /_texture$/i.test(name);
}

function normalizeMaterialName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s.-]+/g, "_");
}

function materialMatches(name: string, labels: Set<string>): boolean {
  const normalized = normalizeMaterialName(name);
  if (!normalized) return false;
  if (labels.has(normalized)) return true;
  for (const label of labels) {
    const token = normalizeMaterialName(label);
    if (normalized === token) return true;
    if (normalized.startsWith(`${token}_`)) return true;
    if (normalized.endsWith(`_${token}`)) return true;
    if (normalized.includes(`_${token}_`)) return true;
  }
  return false;
}

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
  private loader = createCharacterLoader();
  private baseReady = false;

  /** Preload all class + NPC + trainer variants so first spawn is instant */
  async preload(): Promise<void> {
    const models = new Set<string>();
    models.add(DEFAULT_NPC_MODEL);
    for (const m of Object.values(CLASS_MODELS)) models.add(m);
    for (const m of Object.values(NPC_MODEL)) models.add(m);
    for (const m of Object.values(TRAINER_BY_CLASS)) models.add(m);
    for (const m of Object.values(TRAINER_BY_PROFESSION)) models.add(m);

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
    teachesClass?: string;
    teachesProfession?: string;
    skinColor?: number;
    hairColor?: number;
    eyeColor?: number;
    outfitColor?: number;
    scale?: number;
  }): CharacterInstance | null {
    // Resolve which model to use. NPCs never fall through to class models
    // so a "warrior trainer" doesn't end up sharing the Warrior player mesh.
    // Class/profession trainers pick a themed base model per discipline.
    const trainerClass = opts.teachesClass?.toLowerCase();
    const trainerProf = opts.teachesProfession?.toLowerCase();
    let modelName = opts.modelName;
    if (!modelName) {
      if (opts.npcType === "trainer" && trainerClass && TRAINER_BY_CLASS[trainerClass]) {
        modelName = TRAINER_BY_CLASS[trainerClass];
      } else if (opts.npcType === "profession-trainer" && trainerProf && TRAINER_BY_PROFESSION[trainerProf]) {
        modelName = TRAINER_BY_PROFESSION[trainerProf];
      } else if (opts.npcType) {
        modelName = NPC_MODEL[opts.npcType] ?? DEFAULT_NPC_MODEL;
      } else if (opts.wogClass) {
        modelName = CLASS_MODELS[opts.wogClass.toLowerCase()] ?? "Warrior";
      } else {
        modelName = "Warrior";
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

    // Find all skinned meshes so Blender-split modular exports still work.
    let skinnedMesh: THREE.SkinnedMesh | null = null;
    const skinnedMeshes: THREE.SkinnedMesh[] = [];
    const bones: Record<string, THREE.Bone> = {};

    clone.traverse((node) => {
      if (node instanceof THREE.SkinnedMesh) {
        skinnedMeshes.push(node);
        if (!skinnedMesh) {
          skinnedMesh = node;
        }
      }
    });

    if (!skinnedMesh || skinnedMeshes.length === 0) {
      console.warn(`[CharAssets] No SkinnedMesh in ${modelName}`);
      return null;
    }

    // Get bones from the skeleton (traverse doesn't find them after SkeletonUtils.clone)
    const skeleton = (skinnedMesh as THREE.SkinnedMesh).skeleton;
    if (skeleton) {
      for (const bone of skeleton.bones) {
        if (bone.name) bones[bone.name] = bone;
      }
    }
    // Also scan scene hierarchy for any Object3D with bone-like names
    // (SkeletonUtils.clone may not preserve instanceof Bone)
    if (Object.keys(bones).length === 0) {
      clone.traverse((node) => {
        if (node.name && (node.name.includes("Fist") || node.name.includes("Head") ||
            node.name.includes("Torso") || node.name.includes("Shoulder") ||
            node.name.includes("Foot") || node.name.includes("Bone"))) {
          bones[node.name] = node as THREE.Bone;
        }
      });
    }
    console.log(`[CharAssets] ${modelName}: ${Object.keys(bones).length} bones found: ${Object.keys(bones).join(", ")}`);

    // Remap materials with custom colors and toon shading for every skinned mesh.
    const cls = opts.wogClass?.toLowerCase() ?? "";
    const npcTint = (opts.npcType === "trainer" && trainerClass)
      ? TRAINER_TINT[trainerClass]
      : undefined;
    const remapMaterial = (mat: THREE.Material) => {
      const std = mat as THREE.MeshStandardMaterial;
      const name = std.name ?? "";
      const bakedAtlas = isBakedAtlasMaterial(name);
      const map = std.map ?? null;
      let color = std.color?.clone() ?? new THREE.Color(0xffffff);

      // Apply custom colors based on material name
      if (!bakedAtlas && materialMatches(name, SKIN_MATERIALS) && opts.skinColor != null) {
        color = new THREE.Color(opts.skinColor);
      } else if (!bakedAtlas && materialMatches(name, HAIR_MATERIALS) && opts.hairColor != null) {
        color = new THREE.Color(opts.hairColor);
      } else if (!bakedAtlas && materialMatches(name, FACE_MATERIALS)) {
        // Face is skin-toned
        color = new THREE.Color(opts.skinColor ?? 0xffe0bd);
      } else if (!bakedAtlas && materialMatches(name, OUTFIT_MATERIALS)) {
        // Shirt/outfit tinted by class or explicit override
        color = new THREE.Color(opts.outfitColor ?? CLASS_OUTFIT_COLOR[cls] ?? 0x666688);
      } else if (!bakedAtlas && materialMatches(name, PANTS_MATERIALS)) {
        // Pants get a neutral tone
        color = new THREE.Color(0x444455);
      } else if (bakedAtlas && map) {
        // Baked atlas materials already encode skin/hair/clothes in the texture.
        // Keep the texture unmodified so unique authored looks survive the toon conversion.
        // Exception: warlock shares the Wizard mesh with mage — tint dark-purple.
        // Exception: NPCs with an atlas tint (e.g., trainer → black knight) also
        // multiply the atlas so they read as distinct from the matching class.
        if (npcTint != null) {
          color = new THREE.Color(npcTint);
        } else if (cls === "warlock") {
          color = new THREE.Color(0x8844cc);
        } else {
          color = new THREE.Color(0xffffff);
        }
      }

      // Self-light characters slightly so the toon shader doesn't clamp them
      // to pure black in night scenes. For mapped (atlas) materials we route
      // the emissive through the map itself so the baked colors glow, rather
      // than a flat grey emissive that washes out the texture.
      const toon = new THREE.MeshToonMaterial({
        color,
        gradientMap: gradMap,
        side: std.side,
        transparent: std.transparent,
        opacity: std.opacity,
        alphaTest: std.alphaTest,
        depthWrite: std.depthWrite,
        emissive: map ? new THREE.Color(0xffffff) : color.clone().multiplyScalar(0.25),
        emissiveIntensity: map ? 0.25 : 1.0,
        ...(map ? { map, emissiveMap: map } : {}),
      });
      toon.name = name;
      return toon;
    };

    for (const mesh of skinnedMeshes) {
      const srcMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const toonMats = srcMats.map(remapMaterial);
      mesh.material = toonMats.length === 1 ? toonMats[0] : toonMats;
      mesh.castShadow = true;
      mesh.frustumCulled = false; // skinned meshes can pop out of frustum easily
    }

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

    return { group, mixer, clips, bones, skinnedMesh };
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

    const promise = new Promise<CachedModel>((resolve, reject) => {
      const finalize = (model: CachedModel) => {
        this.cache.set(name, model);
        this.loading.delete(name);
        const animNames = model.animations.map((a) => a.name);
        console.log(`[CharAssets] ${name}: ${animNames.length} anims (${animNames.join(", ")})`);
        resolve(model);
      };

      const fail = (url: string, err: unknown, allowFallback: boolean) => {
        if (allowFallback) {
          console.warn(`[CharAssets] Failed to load ${url}, trying .gltf fallback`);
          load(characterModelUrl(name, "gltf"), false);
          return;
        }
        console.error(`[CharAssets] Failed to load ${url}:`, err);
        this.loading.delete(name);
        reject(err);
      };

      const load = (url: string, allowFallback: boolean) => {
        this.loader.load(
          url,
          (gltf) => finalize({
            scene: gltf.scene,
            animations: gltf.animations,
          }),
          undefined,
          (err) => fail(url, err, allowFallback),
        );
      };

      load(characterModelUrl(name, "glb"), true);
    });

    this.loading.set(name, promise);
    return promise;
  }
}

export { CLASS_MODELS, NPC_MODEL, BONE_NAMES };
